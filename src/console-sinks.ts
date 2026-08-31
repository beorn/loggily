/**
 * Console sinks — runtime-aware structured output to console.
 *
 * Two sinks, one contract: `(event: Event) => void`. They do NOT pre-format
 * events into a single ANSI string. Instead they spread structured arguments
 * to `console.*` so the platform can render rich output:
 *
 *   Terminal (Node / Bun):
 *     console.error(ansiPrefix, message, ...userArgs)
 *     — util.format keeps objects inspectable in devtools
 *     — every level goes to STDERR; stdout carries the command's answer
 *
 *   Browser (Chrome / Firefox / Safari DevTools):
 *     console.info("%c<level> %c<namespace>", levelCss, nsCss, message, ...userArgs)
 *     — DevTools renders colored prefix and keeps every user arg as an
 *       expandable, clickable object.
 *
 * Source-location preservation:
 * We call `console.<level>(...)` from arrow-function sinks. DevTools attribute
 * the log line to the caller's frame, not this file, as long as no wrapper
 * closes over a bound console reference. `Function.prototype.bind.call(console.info, ...)`
 * works too but defeats `vi.spyOn(console, 'info')` because bind captures
 * the function at bind time. Plain arrow functions re-read `console.info`
 * on each call — mockable AND location-preserving.
 *
 * The sinks consume `event.userArgs` (raw user-supplied data/errors) when
 * present, falling back to `event.props` so they still work with code paths
 * that have not yet been migrated.
 */

import { colors as pc } from "./colors.js"
import type { Event, LogFormat, OutputLogLevel } from "./pipeline.js"
import {
  formatConsoleEvent,
  formatConsoleTime,
  formatJSONEvent,
  safeStringify,
} from "./pipeline.js"

export type ConsoleSink = (event: Event) => void

// ---------------------------------------------------------------------------
// Runtime detection
// ---------------------------------------------------------------------------

/**
 * True when running inside a browser-like environment. We check for the
 * presence of a `window` with `document` — the Node DOM test env (jsdom)
 * also matches, but that is the correct behaviour for DevTools-style output.
 */
export function isBrowserRuntime(): boolean {
  return (
    typeof (globalThis as { window?: unknown })?.window !== "undefined" &&
    typeof (globalThis as { document?: unknown }).document !== "undefined"
  )
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function levelLabel(level: OutputLogLevel): string {
  switch (level) {
    case "trace":
      return "TRACE"
    case "debug":
      return "DEBUG"
    case "info":
      return "INFO"
    case "warn":
      return "WARN"
    case "error":
      return "ERROR"
  }
}

/**
 * Return the raw user-supplied data attached to the event, in call order.
 * Prefers the explicit `userArgs` field (new path). Falls back to `props`
 * (coerced to a single trailing object) for events emitted by older code or
 * by `writeSpan`. Filters out `undefined` entries.
 */
function userArgsOf(event: Event): unknown[] {
  if (
    "userArgs" in event &&
    Array.isArray((event as { userArgs?: unknown[] }).userArgs)
  ) {
    const ua = (event as { userArgs?: unknown[] }).userArgs!
    return ua.filter((v) => v !== undefined)
  }
  if (event.props && Object.keys(event.props).length > 0) {
    return [event.props]
  }
  return []
}

// ---------------------------------------------------------------------------
// Terminal sink
// ---------------------------------------------------------------------------

/**
 * Terminal (ANSI) sink. Emits `[ansiPrefix, message, ...userArgs]` so that:
 *   - stderr gets a colored prefix, leaving stdout to the command's answer
 *   - util.format leaves objects inspectable
 *   - vi.spyOn(console, 'error') intercepts calls (arrows re-read console)
 *
 * Spans and JSON format still go through the pre-formatted single-arg path —
 * their consumers are log aggregators, not humans.
 */
export function createTerminalConsoleSink(
  format: LogFormat = "console",
): ConsoleSink {
  if (format === "json") {
    // JSON format: one line, one arg — downstream log collectors expect that.
    return (event: Event) => routeSingleStderr(event, formatJSONEvent(event))
  }

  return (event: Event) => {
    // Spans bypass console and go straight to stderr — that's what Ink's
    // patchConsole relies on to keep span output outside the TUI surface.
    if (event.kind === "span") {
      writeStderrLine(formatConsoleEvent(event))
      return
    }

    const prefix = `${pc.dim(formatConsoleTime(event.time))} ${levelAnsi(event.level)} ${pc.cyan(event.namespace)}`
    const args = userArgsOf(event)
    // Arrow → console.<stderr method>: preserves caller frame + stays mockable.
    invokeForLevelStderr(event.level, prefix, event.message, ...args)
  }
}

/** Emit one line to process.stderr when available (no-op in browser). */
function writeStderrLine(text: string): void {
  const p = typeof process !== "undefined" ? process : undefined
  if (p?.stderr && typeof p.stderr.write === "function") {
    p.stderr.write(text + "\n")
    return
  }
  console.info(text)
}

function levelAnsi(level: OutputLogLevel): string {
  switch (level) {
    case "trace":
      return pc.dim("TRACE")
    case "debug":
      return pc.dim("DEBUG")
    case "info":
      return pc.blue("INFO")
    case "warn":
      return pc.yellow("WARN")
    case "error":
      return pc.red("ERROR")
  }
}

// ---------------------------------------------------------------------------
// Browser sink
// ---------------------------------------------------------------------------

/**
 * Browser (DevTools) sink. Uses `%c` CSS format specifiers so DevTools
 * renders a colored level + namespace prefix, then spreads user args raw so
 * DevTools keeps them as expandable object references (clickable source
 * locations for Error, drill-in for plain objects).
 *
 * For JSON format we still emit a single string — consumers that explicitly
 * asked for JSON want machine-readable output, not DevTools theatrics.
 */
export function createBrowserConsoleSink(
  format: LogFormat = "console",
): ConsoleSink {
  if (format === "json") {
    return (event: Event) => routeSingle(event, formatJSONEvent(event))
  }

  return (event: Event) => {
    if (event.kind === "span") {
      const spanTemplate = `%c%s %cSPAN %c%s %c(%sms)`
      const args = userArgsOf(event)
      const spanPropsString =
        args.length > 0
          ? ` ${safeStringify(Object.assign({}, ...args.filter(isPlainRecord)))}`
          : ""
      // Spans: compact format; include props inline because DevTools arg
      // ordering would otherwise separate the duration from its context.
      const { durationLabel } = { durationLabel: String(event.duration) }
      invokeForLevel(
        "info",
        spanTemplate + (spanPropsString ? "%s" : ""),
        cssDim(),
        formatConsoleTime(event.time),
        cssSpan(),
        cssNamespace(),
        event.namespace,
        cssDim(),
        durationLabel,
        ...(spanPropsString ? [cssDim(), spanPropsString] : []),
      )
      return
    }

    // Template: "<dimTime> <levelBadge> <namespace>" — 3 %c slots.
    const template = `%c%s %c%s %c%s`
    const args = userArgsOf(event)
    invokeForLevel(
      event.level,
      template,
      cssDim(),
      formatConsoleTime(event.time),
      cssLevel(event.level),
      levelLabel(event.level),
      cssNamespace(),
      event.namespace,
      // Message and user args follow — raw, in call order.
      event.message,
      ...args,
    )
  }
}

function isPlainRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v)
}

function cssDim(): string {
  return "color: #888"
}
function cssNamespace(): string {
  return "color: #0aa; font-weight: bold"
}
function cssSpan(): string {
  return "color: #a0a; font-weight: bold"
}
function cssLevel(level: OutputLogLevel): string {
  switch (level) {
    case "trace":
    case "debug":
      return "color: #888; font-weight: bold"
    case "info":
      return "color: #36f; font-weight: bold"
    case "warn":
      return "color: #b80; font-weight: bold"
    case "error":
      return "color: #c33; font-weight: bold"
  }
}

// ---------------------------------------------------------------------------
// Console routing
// ---------------------------------------------------------------------------

/**
 * Dispatch to the right console method for the event's level.
 * We intentionally use arrow-style invocation rather than
 * `Function.prototype.bind.call(console.info, console, ...)` so that:
 *   1. Tests can `vi.spyOn(console, 'info')` AFTER the sink is created.
 *   2. DevTools attribute the log line to the caller's source location
 *      (arrows don't appear in the stack between the call and `console.*`).
 */
function invokeForLevel(level: OutputLogLevel, ...args: unknown[]): void {
  switch (level) {
    case "trace":
    case "debug":
      console.debug(...args)
      return
    case "info":
      console.info(...args)
      return
    case "warn":
      console.warn(...args)
      return
    case "error":
      console.error(...args)
      return
  }
}

/**
 * Terminal counterpart to `invokeForLevel`: dispatch to a console method that
 * writes to STDERR.
 *
 * Node aliases `console.info`, `console.debug` and `console.log` onto stdout —
 * the same stream a command's answer travels on. One narration line there and
 * `cmd --json | jq` reads a SyntaxError instead of a result, which is why
 * consumers kept growing private workarounds (km and ag each wrote their own
 * `routeLogsToStderr()`). A log is not product output, so the terminal sink
 * never calls those three. `console.warn` and `console.error` are the only
 * Node console methods that reach stderr without decorating what they print —
 * `console.trace` appends a stack trace.
 *
 * Two deliberate consequences:
 *   - Levels below `warn` share `console.error`. The level is still carried by
 *     the rendered prefix (`INFO`, `DEBUG`), which is what humans read and
 *     what log parsers match; the console METHOD was never the level.
 *   - We route through the GLOBAL console rather than a private
 *     `new Console({ stdout: process.stderr })`, so `vi.spyOn(console, …)` and
 *     Ink/silvery's `patchConsole` still see these lines. A private Console
 *     would silently escape both.
 *
 * The browser sink keeps `invokeForLevel`: DevTools has no stdout/stderr
 * split, and `console.info`/`console.debug` are what drive its level filter.
 */
function invokeForLevelStderr(level: OutputLogLevel, ...args: unknown[]): void {
  if (level === "warn") {
    console.warn(...args)
    return
  }
  console.error(...args)
}

/**
 * Terminal counterpart to `routeSingle`: one pre-formatted string, on stderr.
 * Used for JSON format and spans, whose consumers are log collectors — and a
 * collector reading stdout would be reading the command's answer instead.
 */
function routeSingleStderr(event: Event, text: string): void {
  invokeForLevelStderr(event.kind === "span" ? "info" : event.level, text)
}

/**
 * Route an already-formatted single string to the correct console level.
 * Used for JSON format and for span events where we preserve the pre-formatted
 * shape.
 */
function routeSingle(event: Event, text: string): void {
  if (event.kind === "span") {
    // BROWSER path only. DevTools has no stdout/stderr split, so `console.info`
    // is the right call here — it is what puts spans in DevTools' info filter.
    //
    // This comment used to claim spans "go to stderr in Node", which was true
    // of the intent and false of the code: every terminal caller reached this
    // same function and landed on stdout. The terminal sink now has its own
    // `routeSingleStderr`, so the claim and the code agree by construction —
    // Node spans are asserted on stderr in console-stream-routing.test.ts.
    console.info(text)
    return
  }
  switch (event.level) {
    case "trace":
    case "debug":
      console.debug(text)
      return
    case "info":
      console.info(text)
      return
    case "warn":
      console.warn(text)
      return
    case "error":
      console.error(text)
      return
  }
}

// ---------------------------------------------------------------------------
// Runtime-selecting factory
// ---------------------------------------------------------------------------

/**
 * Pick the right sink for the current runtime. Browsers get `%c` CSS, Node
 * gets ANSI. Both emit multi-arg spreads so the platform can render objects
 * as expandable references.
 */
export function createConsoleSink(format: LogFormat = "console"): ConsoleSink {
  return isBrowserRuntime()
    ? createBrowserConsoleSink(format)
    : createTerminalConsoleSink(format)
}

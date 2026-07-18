import { colors as pc } from "./colors.js"
import { createFileWriter } from "./file-writer.js"
import { setIdFormat, setSampleRate } from "./tracing.js"
import type { IdFormat } from "./tracing.js"

// ============ Types ============

export type OutputLogLevel = "trace" | "debug" | "info" | "warn" | "error"
export type LogLevel = OutputLogLevel | "silent"
export type LogFormat = "console" | "json"

export type LogEvent = {
  kind: "log"
  time: number
  namespace: string
  level: OutputLogLevel
  message: string
  props?: Record<string, unknown>
  /**
   * Raw user-supplied arguments, in call order (after the message).
   *
   * Populated by the logger façade so that console sinks can spread them to
   * `console.*` and keep objects expandable in Node/browser DevTools. When
   * absent, sinks fall back to `props` (merged context + user data).
   *
   * Example: `log.info("greet", { user: "a" })` → userArgs = [{ user: "a" }]
   */
  userArgs?: unknown[]
}

export type SpanEvent = {
  kind: "span"
  time: number
  namespace: string
  name: string
  duration: number
  props?: Record<string, unknown>
  spanId: string
  traceId: string
  parentId: string | null
  /** Raw user-supplied span attributes (mirrors LogEvent.userArgs). */
  userArgs?: unknown[]
}

export type Event = LogEvent | SpanEvent
export type Stage = (event: Event) => Event | null | void

// ============ Level Priority ============

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
}

// ============ Runtime Detection ============

const _process = typeof process !== "undefined" ? process : undefined

function getEnv(key: string): string | undefined {
  return _process?.env?.[key]
}

function writeStderr(text: string): void {
  if (_process?.stderr?.write) {
    _process.stderr.write(text + "\n")
  } else {
    console.error(text)
  }
}

// ============ Formatting ============

/** Serialize Error.cause chains up to a max depth */
export function serializeCause(cause: unknown, maxDepth: number = 3): unknown {
  if (maxDepth <= 0 || cause === undefined || cause === null) return undefined
  if (cause instanceof Error) {
    const result: Record<string, unknown> = {
      name: cause.name,
      message: cause.message,
      stack: cause.stack,
    }
    if ((cause as { code?: string }).code)
      result.code = (cause as { code?: string }).code
    if (cause.cause !== undefined) {
      result.cause = serializeCause(cause.cause, maxDepth - 1)
    }
    return result
  }
  // Non-Error cause (spec allows any value)
  return cause
}

export function safeStringify(value: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString()
    if (typeof val === "symbol") return val.toString()
    if (val instanceof Error) {
      const result: Record<string, unknown> = {
        message: val.message,
        stack: val.stack,
        name: val.name,
      }
      if ((val as { code?: string }).code)
        result.code = (val as { code?: string }).code
      if (val.cause !== undefined) result.cause = serializeCause(val.cause)
      return result
    }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]"
      seen.add(val)
    }
    return val
  })
}

/** Human-facing console timestamps follow the host's local wall clock. */
export function formatConsoleTime(time: number): string {
  const date = new Date(time)
  return [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((part) => String(part).padStart(2, "0"))
    .join(":")
}

export function formatConsoleEvent(event: Event): string {
  const time = pc.dim(formatConsoleTime(event.time))
  const ns = pc.cyan(event.namespace)

  if (event.kind === "span") {
    const message = `(${event.duration}ms)`
    let output = `${time} ${pc.magenta("SPAN")} ${ns} ${message}`
    if (event.props && Object.keys(event.props).length > 0) {
      output += ` ${pc.dim(safeStringify(event.props))}`
    }
    return output
  }

  let levelStr: string
  switch (event.level) {
    case "trace":
      levelStr = pc.dim("TRACE")
      break
    case "debug":
      levelStr = pc.dim("DEBUG")
      break
    case "info":
      levelStr = pc.blue("INFO")
      break
    case "warn":
      levelStr = pc.yellow("WARN")
      break
    case "error":
      levelStr = pc.red("ERROR")
      break
  }

  let output = `${time} ${levelStr} ${ns} ${event.message}`
  if (event.props && Object.keys(event.props).length > 0) {
    output += ` ${pc.dim(safeStringify(event.props))}`
  }
  return output
}

export function formatJSONEvent(event: Event): string {
  if (event.kind === "span") {
    return safeStringify({
      time: new Date(event.time).toISOString(),
      level: "span",
      name: event.namespace,
      msg: `(${event.duration}ms)`,
      duration: event.duration,
      span_id: event.spanId,
      trace_id: event.traceId,
      parent_id: event.parentId,
      ...event.props,
    })
  }

  return safeStringify({
    time: new Date(event.time).toISOString(),
    level: event.level,
    name: event.namespace,
    msg: event.message,
    ...event.props,
  })
}

// ============ Namespace Filter ============

export type NsFilter = (namespace: string) => boolean

function matchesPattern(namespace: string, pattern: string): boolean {
  if (pattern === "*") return true
  if (pattern.endsWith(":*")) {
    const prefix = pattern.slice(0, -2)
    return namespace === prefix || namespace.startsWith(prefix + ":")
  }
  return namespace === pattern || namespace.startsWith(pattern + ":")
}

export function parseNsFilter(ns: string | string[]): NsFilter {
  const patterns =
    typeof ns === "string" ? ns.split(",").map((s) => s.trim()) : ns
  const includes: string[] = []
  const excludes: string[] = []

  for (const p of patterns) {
    if (p.startsWith("-")) {
      excludes.push(p.slice(1))
    } else {
      includes.push(p)
    }
  }

  return (namespace: string): boolean => {
    for (const exc of excludes) {
      if (matchesPattern(namespace, exc)) return false
    }
    if (includes.length > 0) {
      for (const inc of includes) {
        if (matchesPattern(namespace, inc)) return true
      }
      return false
    }
    return true
  }
}

// ============ Console Output ============

// Lazy-imported structured console sink (browser %c / terminal multi-arg).
// Pipeline-level imports avoid a cycle: console-sinks.ts imports format
// helpers from this file; we want the pipeline to reuse them too.
import { createConsoleSink as _createConsoleSink } from "./console-sinks.js"

/**
 * Legacy text-based console writer. Retained so older code paths (the
 * env-dynamic pipeline in core.ts, writeSpan) still work, but the modern
 * pipeline now routes through `createConsoleSink` which spreads structured
 * args to `console.*` — that's what preserves expandable objects in browser
 * DevTools and makes `vi.spyOn(console, 'info')` interception work.
 *
 * For spans we still write to stderr in Node because the pipeline-level
 * spanEnabled gate handles human-readable span output; JSON/console sinks
 * route spans through their normal formatters when invoked directly.
 */
export function writeToConsole(text: string, event: Event): void {
  if (event.kind === "span") {
    writeStderr(text)
    return
  }
  // Arrow dispatch — no .bind() — so vi.spyOn(console, …) installed AFTER
  // this module loaded still intercepts. DevTools frame attribution is
  // determined by the caller of writeToConsole, not by this switch.
  switch (event.level) {
    case "trace":
    case "debug":
      console.debug(text)
      break
    case "info":
      console.info(text)
      break
    case "warn":
      console.warn(text)
      break
    case "error":
      console.error(text)
      break
  }
}

// ============ Sinks ============

/**
 * Console sink used inside the pipeline builder. Delegates to the structured
 * console sink (browser %c or terminal multi-arg) so the pipeline preserves
 * expandable user args end-to-end.
 */
function createConsoleSink(format: LogFormat): (event: Event) => void {
  return _createConsoleSink(format)
}

function createFileSink(
  path: string,
  format: LogFormat,
): { write: (event: Event) => void; dispose: () => void } {
  const writer = createFileWriter(path)
  const formatter = format === "json" ? formatJSONEvent : formatConsoleEvent
  return {
    write: (event: Event) => writer.write(formatter(event)),
    dispose: () => writer.close(),
  }
}

function isNodeStream(obj: unknown): boolean {
  return (
    typeof obj === "object" &&
    obj !== null &&
    ("_write" in obj || "writable" in obj || "fd" in obj)
  )
}

function createWritableSink(
  writable: Writable,
  format: LogFormat,
): (event: Event) => void {
  // Node.js streams (process.stderr, fs streams) default to string mode
  // Plain { write } objects default to object mode (raw Events)
  const useObjectMode = writable.objectMode ?? !isNodeStream(writable)
  if (!useObjectMode) {
    const formatter = format === "json" ? formatJSONEvent : formatConsoleEvent
    return (event: Event) => writable.write(formatter(event) + "\n")
  }
  return (event: Event) => writable.write(event)
}

// ============ Pipeline ============

export interface Pipeline {
  dispatch: (event: Event) => void
  spanEnabled: (namespace: string) => boolean
  level: LogLevel
  dispose: () => void
}

interface Output {
  levelPriority: number
  nsFilter: NsFilter | null
  write: (event: Event) => void
  dispose?: () => void
  /** Consecutive write failures (guarded dispatch); reset on success. */
  failures?: number
  /** Set after OUTPUT_MAX_STRIKES consecutive failures — sink is skipped. */
  disabled?: boolean
}

/** Consecutive failures before a throwing output sink is disabled. */
const OUTPUT_MAX_STRIKES = 3

/**
 * Report a dispatch-guard failure WITHOUT going through any pipeline —
 * the error channel for the logger itself must not recurse into the logger.
 * Routes through writeStderr (the `_process` guard) for browser safety.
 */
function reportGuard(what: string, err: unknown): void {
  const detail = err instanceof Error ? (err.stack ?? err.message) : String(err)
  try {
    writeStderr(`loggily: ${what}: ${detail}`)
  } catch {
    // The terminal fallback of the error channel itself: if stderr is gone
    // there is nowhere left to report, and throwing here would defeat the
    // guard's entire purpose (logger must never throw into the host).
  }
}

// ============ Discrimination ============

const VALID_CONFIG_KEYS = new Set([
  "level",
  "ns",
  "format",
  "spans",
  "metrics",
  "idFormat",
  "sampleRate",
])
const SINK_KEYS = new Set(["file", "otel"])

function isPojo(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return false
  const proto = Object.getPrototypeOf(obj)
  return proto === Object.prototype || proto === null
}

function isWritable(obj: unknown): obj is Writable {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "write" in obj &&
    typeof (obj as Record<string, unknown>).write === "function"
  )
}

function isValidLogLevel(val: unknown): val is LogLevel {
  return typeof val === "string" && val in LOG_LEVEL_PRIORITY
}

// ============ Config Types ============

/** A writable sink — any object with a write method. Receives raw Event objects by default. */
export interface Writable {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  write: (data: any) => any
  /** Set to false to receive formatted strings instead of raw Event objects (default: true) */
  objectMode?: boolean
}

/** Config keys that set scope for subsequent siblings */
export interface ConfigObject {
  level?: LogLevel
  ns?: string | string[]
  format?: LogFormat
  spans?: boolean
  /** Enable per-logger metrics collection. Creates a MetricsCollector accessible via `log.metrics`. */
  metrics?: boolean
  /** ID format for trace/span IDs: "simple" (default) or "w3c" (W3C Trace Context) */
  idFormat?: "simple" | "w3c"
  /** Head-based sampling rate for new traces: 0.0 (none) to 1.0 (all, default) */
  sampleRate?: number
}

/** File output descriptor */
export interface FileDescriptor extends ConfigObject {
  file: string
}

/** OTEL output descriptor (Phase 4) */
export interface OtelDescriptor extends ConfigObject {
  otel: Record<string, unknown>
}

/** A single element in a createLogger config array */
export type ConfigElement =
  | ConfigObject
  | FileDescriptor
  | OtelDescriptor
  | Console
  | "console"
  | "stderr"
  | Stage
  | Writable
  | ConfigElement[]

// ============ Build Pipeline ============

interface ScopeConfig {
  level: LogLevel
  ns: NsFilter | null
  format: LogFormat
}

export function buildPipeline(
  elements: ConfigElement[],
  parentConfig?: Partial<ScopeConfig>,
): Pipeline {
  const config: ScopeConfig = {
    level: parentConfig?.level ?? readEnvLevel(),
    ns: parentConfig?.ns ?? readEnvNs(),
    format: parentConfig?.format ?? readEnvFormat(),
  }
  // Spans always pass through explicit pipelines. { spans: false } to opt out.
  // The defaultPipeline handles TRACE env var gating separately.
  let spansEnabled = true

  const stages: Stage[] = []
  const outputs: Output[] = []
  const branches: Pipeline[] = []
  const disposables: (() => void)[] = []

  for (const element of elements) {
    // 1. Array → branch
    if (Array.isArray(element)) {
      const branch = buildPipeline(element as ConfigElement[], { ...config })
      branches.push(branch)
      disposables.push(() => branch.dispose())
      continue
    }

    // 2. console (literal or "console" string) → console sink (check before function — console is function-like)
    if (element === console || element === "console") {
      outputs.push({
        levelPriority: LOG_LEVEL_PRIORITY[config.level],
        nsFilter: config.ns,
        write: createConsoleSink(config.format),
      })
      continue
    }

    // 3. Function → stage
    if (typeof element === "function") {
      stages.push(element as Stage)
      continue
    }

    // 4. Writable ({ write }) → writable sink (checked BEFORE POJO so { write: fn } works)
    if (isWritable(element)) {
      outputs.push({
        levelPriority: LOG_LEVEL_PRIORITY[config.level],
        nsFilter: config.ns,
        write: createWritableSink(element, config.format),
      })
      continue
    }

    // 5. POJO → scope config or output descriptor
    if (isPojo(element)) {
      const obj = element
      const keys = Object.keys(obj)

      const hasSinkKey = keys.some((k) => SINK_KEYS.has(k))
      const hasUnknownKey = keys.some(
        (k) => !VALID_CONFIG_KEYS.has(k) && !SINK_KEYS.has(k),
      )

      if (hasUnknownKey) {
        const unknown = keys.find(
          (k) => !VALID_CONFIG_KEYS.has(k) && !SINK_KEYS.has(k),
        )
        throw new Error(
          `loggily: unknown config key "${unknown}" in config object. Valid keys: ${[...VALID_CONFIG_KEYS, ...SINK_KEYS].join(", ")}`,
        )
      }

      if (hasSinkKey) {
        if (typeof obj.file === "string") {
          const outputLevel = isValidLogLevel(obj.level)
            ? obj.level
            : config.level
          const outputNs = obj.ns
            ? parseNsFilter(obj.ns as string | string[])
            : config.ns
          const outputFormat = (obj.format as LogFormat) ?? config.format
          const sink = createFileSink(obj.file, outputFormat)
          disposables.push(sink.dispose)
          outputs.push({
            levelPriority: LOG_LEVEL_PRIORITY[outputLevel],
            nsFilter: outputNs,
            write: sink.write,
            dispose: sink.dispose,
          })
        }
        if (obj.otel !== undefined) {
          throw new Error(
            "loggily: OTEL sink is not yet implemented. See loggily/otel for the planned bridge.",
          )
        }
        continue
      }

      // Scope config — update inherited config
      if (isValidLogLevel(obj.level)) config.level = obj.level
      if (obj.ns !== undefined)
        config.ns = parseNsFilter(obj.ns as string | string[])
      if (obj.format === "console" || obj.format === "json")
        config.format = obj.format
      if (obj.spans === true) spansEnabled = true
      if (obj.spans === false) spansEnabled = false
      if (obj.idFormat === "simple" || obj.idFormat === "w3c")
        setIdFormat(obj.idFormat)
      if (typeof obj.sampleRate === "number") setSampleRate(obj.sampleRate)
      continue
    }

    // 6. String "stderr" → stderr sink
    if (element === "stderr" && typeof process !== "undefined") {
      outputs.push({
        levelPriority: LOG_LEVEL_PRIORITY[config.level],
        nsFilter: config.ns,
        write: createWritableSink(
          process.stderr as unknown as Writable,
          config.format,
        ),
      })
      continue
    }

    throw new Error(
      `loggily: unsupported config element of type "${typeof element}". ` +
        'Config arrays accept: objects (config), arrays (branches), functions (stages), console, "console", or writables ({ write }).',
    )
  }

  // Guarded dispatch: a logger must never throw into its host app. Stage
  // throws drop the event (fail-closed — a broken redaction stage must not
  // leak unprocessed events); output throws are isolated per-sink with a
  // strike counter; branch throws are isolated. All failures are reported
  // once via reportGuard (direct stderr — never through the pipeline).
  const stageReported: boolean[] = []
  const branchReported: boolean[] = []
  const dispatch = (event: Event): void => {
    // Span gate: { spans: false } disables span output for this pipeline
    if (event.kind === "span" && !spansEnabled) return

    let e: Event = event
    for (let i = 0; i < stages.length; i++) {
      let result: Event | null | void
      try {
        result = stages[i]!(e)
      } catch (err) {
        if (!stageReported[i]) {
          stageReported[i] = true
          reportGuard(
            `stage #${i} threw — dropping event, fail-closed (reported once)`,
            err,
          )
        }
        return
      }
      if (result === null) return
      if (result !== undefined) e = result
    }
    for (const output of outputs) {
      if (output.disabled) continue
      if (
        e.kind === "log" &&
        LOG_LEVEL_PRIORITY[e.level] < output.levelPriority
      )
        continue
      if (output.nsFilter && !output.nsFilter(e.namespace)) continue
      try {
        output.write(e)
        if (output.failures) output.failures = 0
      } catch (err) {
        output.failures = (output.failures ?? 0) + 1
        if (output.failures === 1) {
          reportGuard("output write threw — event lost for this sink", err)
        }
        if (output.failures >= OUTPUT_MAX_STRIKES) {
          output.disabled = true
          reportGuard(
            `output disabled after ${output.failures} consecutive failures`,
            err,
          )
        }
      }
    }
    for (let i = 0; i < branches.length; i++) {
      try {
        branches[i]!.dispatch(e)
      } catch (err) {
        // Branch pipelines guard themselves; this catch is the backstop for
        // anything that escapes (e.g. a foreign Pipeline implementation).
        if (!branchReported[i]) {
          branchReported[i] = true
          reportGuard(`branch #${i} dispatch threw (reported once)`, err)
        }
      }
    }
  }

  const spanEnabledForNamespace = (namespace: string): boolean => {
    if (!spansEnabled) return false
    if (
      outputs.some((output) => !output.nsFilter || output.nsFilter(namespace))
    )
      return true
    if (branches.some((branch) => branch.spanEnabled(namespace))) return true
    // Stages may consume or forward spans themselves, so keep `.span` available
    // for stage-only explicit pipelines.
    return stages.length > 0
  }

  return {
    dispatch,
    spanEnabled: spanEnabledForNamespace,
    level: config.level,
    dispose: () => {
      for (const d of disposables) d()
    },
  }
}

// ============ Env Var Readers (exported for withEnvDefaults plugin) ============

export function readEnvLevel(): LogLevel {
  const env = getEnv("LOG_LEVEL")?.toLowerCase()
  let level: LogLevel =
    env === "trace" ||
    env === "debug" ||
    env === "info" ||
    env === "warn" ||
    env === "error" ||
    env === "silent"
      ? env
      : "info"

  const debugEnv = getEnv("DEBUG")
  if (debugEnv && LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY.debug) {
    level = "debug"
  }

  return level
}

/**
 * Namespace-aware level: only bumps to debug if the namespace matches the DEBUG filter.
 * This enables zero-overhead conditional gating — `log.debug?.()` returns undefined
 * for namespaces outside the DEBUG filter, skipping argument evaluation entirely.
 */
export function readEnvLevelForNamespace(namespace: string): LogLevel {
  const env = getEnv("LOG_LEVEL")?.toLowerCase()
  const baseLevel: LogLevel =
    env === "trace" ||
    env === "debug" ||
    env === "info" ||
    env === "warn" ||
    env === "error" ||
    env === "silent"
      ? env
      : "info"

  const debugEnv = getEnv("DEBUG")
  if (debugEnv && LOG_LEVEL_PRIORITY[baseLevel] > LOG_LEVEL_PRIORITY.debug) {
    // DEBUG is set and would bump level — check if this namespace matches
    const nsFilter = readEnvNs()
    if (nsFilter && nsFilter(namespace)) {
      return "debug" // namespace matches DEBUG filter — bump to debug
    }
    // Namespace doesn't match — keep the configured level
    return baseLevel
  }

  return baseLevel
}

export function readEnvNs(): NsFilter | null {
  const debugEnv = getEnv("DEBUG")
  if (!debugEnv) return null

  const parts = debugEnv.split(",").map((s) => s.trim())
  return parseNsFilter(parts)
}

export function readEnvFormat(): LogFormat {
  const envFormat = getEnv("LOG_FORMAT")?.toLowerCase()
  if (envFormat === "json") return "json"
  if (envFormat === "console") return "console"
  if (getEnv("TRACE_FORMAT") === "json") return "json"
  if (getEnv("NODE_ENV") === "production") return "json"
  return "console"
}

export function readEnvTrace(): { enabled: boolean; filter: NsFilter | null } {
  const traceEnv = getEnv("TRACE")
  if (!traceEnv) return { enabled: false, filter: null }
  if (traceEnv === "1" || traceEnv === "true")
    return { enabled: true, filter: null }
  const prefixes = traceEnv.split(",").map((s) => s.trim())
  return {
    enabled: true,
    filter: (namespace: string) => {
      for (const prefix of prefixes) {
        if (matchesPattern(namespace, prefix)) return true
      }
      return false
    },
  }
}

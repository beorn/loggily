/**
 * Console stream routing — diagnostics never share the stream that carries a
 * command's answer.
 *
 * Node aliases `console.info` and `console.debug` to `console.log`, which
 * writes to STDOUT. The terminal sink called them directly, so any tool on the
 * default sink narrated onto the same stream its answer came out of: one INFO
 * line and `cmd --json | jq` reads a SyntaxError instead of a result.
 * Consumers papered over it privately — km and ag each grew their own
 * `routeLogsToStderr()`, and wire's stdio-adapter logged onto the very stdout
 * it was serving MCP JSON-RPC on.
 *
 * The terminal sink now routes EVERY level through a stderr-writing console
 * method. `warn` and `error` are unchanged; `trace`, `debug` and `info` move.
 *
 * The BROWSER sink is deliberately untouched — DevTools has no stdout/stderr
 * split, and `console.info`/`console.debug` are what drive its level filter
 * and `%c` rendering. Those assertions live in browser-console.test.ts.
 *
 * WHY A SUBPROCESS: vitest replaces `console` above `process.stdout`/
 * `process.stderr`, so an in-process spy on the streams observes nothing at
 * all — every "did not reach stdout" assertion would pass vacuously, on an
 * empty string, whichever sink was installed. Only a real child process has
 * two genuinely separate streams to tell apart. The `control-stdout` marker
 * below proves the stdout pipe is live, so an empty stdout is a fact about the
 * sink rather than a fact about the harness.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { spawnSync } from "node:child_process"
import { fileURLToPath } from "node:url"
import { createTerminalConsoleSink } from "../src/console-sinks.ts"
import type { Event, OutputLogLevel } from "../src/pipeline.ts"

const LEVELS: OutputLogLevel[] = ["trace", "debug", "info", "warn", "error"]

function logEvent(level: OutputLogLevel, message: string): Event {
  return {
    kind: "log",
    time: 0,
    namespace: "myapp",
    level,
    message,
    userArgs: [],
  }
}

describe("terminal sink writes diagnostics to stderr, never stdout", () => {
  const sinkModule = fileURLToPath(
    new URL("../src/console-sinks.ts", import.meta.url),
  )
  const bunBin = process.execPath.endsWith("bun") ? process.execPath : "bun"

  function runInChild(format: "console" | "json") {
    const script = `
      import { createTerminalConsoleSink } from ${JSON.stringify(sinkModule)}
      // Proves the stdout pipe is live: an empty stdout below is then a fact
      // about the sink, not a broken harness.
      console.log("control-stdout")
      const sink = createTerminalConsoleSink(${JSON.stringify(format)})
      for (const level of ${JSON.stringify(LEVELS)}) {
        sink({
          kind: "log",
          time: 0,
          namespace: "myapp",
          level,
          message: "payload-" + level,
          userArgs: [],
        })
      }
      // Spans are diagnostics too. They reach the terminal by a different route
      // in each format — writeStderrLine for console, routeSingleStderr for
      // json — so both need asserting or one of them regresses unseen.
      sink({
        kind: "span",
        time: 0,
        namespace: "payload-spanmarker",
        name: "op",
        duration: 7,
        spanId: "sp_1",
        traceId: "tr_1",
        parentId: null,
        userArgs: [],
      })
    `
    const res = spawnSync(bunBin, ["-e", script], { encoding: "utf8" })
    expect(res.error).toBeUndefined()
    expect(res.status, `child failed:\n${res.stderr}`).toBe(0)
    expect(res.stdout, "stdout pipe is not live").toContain("control-stdout")
    return res
  }

  test.each(["console", "json"] as const)(
    "%s format: every level lands on stderr and none on stdout",
    (format) => {
      const { stdout, stderr } = runInChild(format)
      for (const marker of [...LEVELS, "spanmarker"]) {
        expect(stderr, `${marker} must reach stderr`).toContain(
          `payload-${marker}`,
        )
        expect(stdout, `${marker} must not reach stdout`).not.toContain(
          `payload-${marker}`,
        )
      }
    },
  )
})

describe("terminal sink avoids the stdout console methods", () => {
  // The mechanism behind the stream contract above, asserted in-process so a
  // regression is caught without paying for a subprocess: Node routes
  // console.info/debug/log to stdout, and only console.warn/error to stderr.
  let stdoutMethods: string[]

  beforeEach(() => {
    stdoutMethods = []
    for (const name of ["log", "info", "debug"] as const) {
      vi.spyOn(console, name).mockImplementation(() => {
        stdoutMethods.push(name)
      })
    }
    for (const name of ["warn", "error"] as const) {
      vi.spyOn(console, name).mockImplementation(() => {})
    }
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test.each(LEVELS)("%s never calls a stdout console method", (level) => {
    createTerminalConsoleSink()(logEvent(level, "payload"))
    expect(stdoutMethods).toEqual([])
  })
})

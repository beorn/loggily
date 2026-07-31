/**
 * Tests for logger features (v2 pipeline API):
 * 1. Lazy string interpolation
 * 2. Child loggers with context
 * 3. Structured logging (format: "json" in config)
 * 4. Async file writer
 * 5. Pipeline-based configuration
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, readFileSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  createLogger,
  baseCreateLogger,
  pipe,
  withConfigMetrics,
  withEnvDefaults,
  withRedaction,
  withSpans,
  resetIds,
  createFileWriter,
  setLogLevel,
  getLogLevel,
  enableSpans,
  disableSpans,
  spansAreEnabled,
  setDebugFilter,
  getDebugFilter,
  setLogFormat,
  getLogFormat,
  addWriter,
  setSuppressConsole,
  type FileWriter,
  type LoggerPlugin,
  type Event,
} from "../src/index.ts"
import { createConsoleMock } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseJSON = (s: string): Record<string, any> =>
  JSON.parse(s) as Record<string, any>

/** A writable that captures formatted output strings.
 *  Uses a class so the pipeline recognizes it as a writable (not a config POJO). */
class CaptureWriter {
  lines: string[] = []
  objectMode = false as const
  write(s: string): void {
    this.lines.push(s)
  }
}

function createCapture() {
  const w = new CaptureWriter()
  return { lines: w.lines, writer: w }
}

let consoleMock: ReturnType<typeof createConsoleMock>

beforeEach(() => {
  resetIds()
  consoleMock = createConsoleMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// 1. Lazy String Interpolation
// ─────────────────────────────────────────────────────────────────────────────

describe("lazy string interpolation", () => {
  test("accepts a function that returns a string", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info?.(() => "lazy message")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("lazy message")
  })

  test("function is called when level is enabled", () => {
    const fn = vi.fn(() => "computed value")
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info?.(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(consoleMock.output[0]!.message).toContain("computed value")
  })

  test("function is NOT called when level is disabled", () => {
    const fn = vi.fn(() => "expensive computation")
    const log = createLogger("test", [{ level: "error" }, console])

    // debug is disabled at error level, so fn should never be called
    log.debug?.(fn)

    expect(fn).not.toHaveBeenCalled()
    expect(consoleMock.output).toHaveLength(0)
  })

  test("function is NOT called when level is disabled via optional chaining", () => {
    const fn = vi.fn(() => "expensive computation")
    // At "error" level, info is disabled — log.info is undefined, so ?.() skips entirely
    const log = createLogger("test", [{ level: "error" }, console])

    log.info?.(fn)

    expect(fn).not.toHaveBeenCalled()
    expect(consoleMock.output).toHaveLength(0)
  })

  test("string messages still work unchanged", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info?.("plain string")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("plain string")
  })

  test("lazy messages work with data parameter", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info?.(() => "lazy with data", { key: "value" })

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("lazy with data")
    expect(consoleMock.output[0]!.message).toContain("key")
  })

  test("lazy messages work with all log levels", () => {
    const log = createLogger("test", [{ level: "trace" }, console])

    log.trace?.(() => "trace lazy")
    log.debug?.(() => "debug lazy")
    log.info?.(() => "info lazy")
    log.warn?.(() => "warn lazy")
    log.error?.(() => "error lazy")

    expect(consoleMock.output).toHaveLength(5)
    expect(consoleMock.output[0]!.message).toContain("trace lazy")
    expect(consoleMock.output[4]!.message).toContain("error lazy")
  })

  test("lazy messages work in JSON format", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    log.info?.(() => "json lazy")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.msg).toBe("json lazy")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 2. Child Loggers with Context
// ─────────────────────────────────────────────────────────────────────────────

describe("child loggers with context", () => {
  test("child({...}) creates logger with context fields", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const child = log.child({ requestId: "abc-123" })

    child.info?.("handling request")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("requestId")
    expect(consoleMock.output[0]!.message).toContain("abc-123")
  })

  test("child keeps parent namespace", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const child = log.child({ requestId: "abc" })

    expect(child.name).toBe("app")
  })

  test("child inherits parent props", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const parent = log.child({ version: "1.0" })
    const child = parent.child({ requestId: "abc" })

    expect(child.props).toEqual({ version: "1.0", requestId: "abc" })
  })

  test("child context is included in every log message", () => {
    const log = createLogger("app", [
      { level: "trace", format: "json" },
      console,
    ])
    const child = log.child({ requestId: "abc" })

    child.info?.("first")
    child.warn?.("second")

    const first = parseJSON(consoleMock.output[0]!.message)
    const second = parseJSON(consoleMock.output[1]!.message)
    expect(first.requestId).toBe("abc")
    expect(second.requestId).toBe("abc")
  })

  test("child context merges with per-call data", () => {
    const log = createLogger("app", [
      { level: "trace", format: "json" },
      console,
    ])
    const child = log.child({ requestId: "abc" })

    child.info?.("msg", { extra: "data" })

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.requestId).toBe("abc")
    expect(parsed.extra).toBe("data")
  })

  test("nested children accumulate context", () => {
    const log = createLogger("app", [
      { level: "trace", format: "json" },
      console,
    ])
    const child1 = log.child({ requestId: "abc" })
    const child2 = child1.child({ userId: "user-1" })

    child2.info?.("nested context")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.requestId).toBe("abc")
    expect(parsed.userId).toBe("user-1")
  })

  test("child context overrides parent props on conflict", () => {
    const log = createLogger("app", [
      { level: "trace", format: "json" },
      console,
    ])
    const parent = log.child({ env: "prod" })
    const child = parent.child({ env: "test" })

    child.info?.("override")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.env).toBe("test")
  })

  test("deprecated string child still works", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const child = log.child("import")

    expect(child.name).toBe("app:import")
  })

  test("child can create spans", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("app", [{ level: "trace" }, writer])
    const child = log.child({ requestId: "abc" })

    {
      using span = child.span!("work")
      span.info?.("working")
    }

    // Check span output includes the context
    const spanOutput = lines.find((line) => line.includes("SPAN"))
    expect(spanOutput).toBeDefined()
    expect(spanOutput!).toContain("requestId")
  })

  test("child can create further children via .logger()", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const child = log.child({ requestId: "abc" })
    const subLogger = child.logger("db")

    expect(subLogger.name).toBe("app:db")
    expect(subLogger.props).toEqual({ requestId: "abc" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Structured Logging (format: "json")
// ─────────────────────────────────────────────────────────────────────────────

describe("JSON format configuration", () => {
  test("format: 'json' in config produces JSON output", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

    log.info?.("json message", { key: "value" })

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.level).toBe("info")
    expect(parsed.name).toBe("test")
    expect(parsed.msg).toBe("json message")
    expect(parsed.key).toBe("value")
    expect(parsed.time).toBeDefined()
  })

  test("console format produces human-readable output", () => {
    const log = createLogger("test", [
      { level: "trace", format: "console" },
      console,
    ])

    log.info?.("console message")

    const output = consoleMock.output[0]!.message
    expect(output).toContain("INFO")
    expect(output).toContain("test")
    expect(output).toContain("console message")
    // Should not be valid JSON
    expect(() => parseJSON(output)).toThrow()
  })

  test("JSON format includes child props", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const child = log.child({ app: "myapp", version: "1.0" })

    child.info?.("message")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.app).toBe("myapp")
    expect(parsed.version).toBe("1.0")
  })

  test("JSON format handles errors", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const err = new Error("json error")

    log.error?.(err)

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.msg).toBe("json error")
    expect(parsed.error_type).toBe("Error")
  })

  test("JSON format works with spans", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

    {
      using span = log.span!("work")
      span.spanData.items = 5
    }

    const spanOutput = consoleMock.output.find((o) => {
      try {
        const parsed = parseJSON(o.message)
        return parsed.level === "span"
      } catch {
        return false
      }
    })
    expect(spanOutput).toBeDefined()

    const parsed = parseJSON(spanOutput!.message)
    expect(parsed.level).toBe("span")
    expect(parsed.items).toBe(5)
  })

  test("JSON output has standard fields: time, level, name, msg", () => {
    const log = createLogger("myapp", [
      { level: "trace", format: "json" },
      console,
    ])

    log.info?.("request handled")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed).toHaveProperty("time")
    expect(parsed).toHaveProperty("level", "info")
    expect(parsed).toHaveProperty("name", "myapp")
    expect(parsed).toHaveProperty("msg", "request handled")
    // time should be ISO format
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Async File Writer
// ─────────────────────────────────────────────────────────────────────────────

describe("createFileWriter", () => {
  let testFile: string
  let writer: FileWriter | null = null

  beforeEach(() => {
    testFile = join(
      tmpdir(),
      `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    )
  })

  afterEach(() => {
    writer?.close()
    writer = null
    if (existsSync(testFile)) {
      unlinkSync(testFile)
    }
  })

  test("writes lines to file", () => {
    writer = createFileWriter(testFile, { bufferSize: 1 }) // tiny buffer = immediate flush
    writer.write("line one")
    writer.write("line two")
    writer.flush()

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("line one\n")
    expect(content).toContain("line two\n")
  })

  test("flushes on buffer size threshold", () => {
    writer = createFileWriter(testFile, {
      bufferSize: 10,
      flushInterval: 60000,
    })

    // Write enough to exceed 10 bytes
    writer.write("hello world this is a long line")

    // Should have flushed automatically
    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("hello world")
  })

  test("flush() writes buffer to disk", () => {
    writer = createFileWriter(testFile, {
      bufferSize: 999999,
      flushInterval: 60000,
    })

    writer.write("buffered line")
    // Not yet flushed (buffer is large, interval is long)

    writer.flush()
    const after = readFileSync(testFile, "utf-8")
    expect(after).toContain("buffered line\n")
  })

  test("close() flushes remaining buffer and closes fd", () => {
    writer = createFileWriter(testFile, {
      bufferSize: 999999,
      flushInterval: 60000,
    })

    writer.write("final line")
    writer.close()
    writer = null // prevent double close in afterEach

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("final line\n")
  })

  test("writes are ignored after close", () => {
    writer = createFileWriter(testFile, { bufferSize: 1 })
    writer.write("before close")
    writer.close()

    // This should not throw or write
    writer.write("after close")
    writer = null

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("before close")
    expect(content).not.toContain("after close")
  })

  test("integrates with pipeline config via CaptureWriter", () => {
    // In v2, writable objects (non-POJO with .write method) go in the config array
    const capture = new CaptureWriter()

    const log = createLogger("test", [{ level: "trace" }, capture])
    log.info?.("writer integration")

    expect(capture.lines).toHaveLength(1)
    expect(capture.lines[0]).toContain("writer integration")
  })

  test("flushes on interval", async () => {
    writer = createFileWriter(testFile, {
      bufferSize: 999999,
      flushInterval: 50,
    })

    writer.write("interval line")

    // Wait for the flush interval to fire
    await new Promise((resolve) => setTimeout(resolve, 100))

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("interval line\n")
  })

  test("multiple close calls are safe", () => {
    writer = createFileWriter(testFile, { bufferSize: 1 })
    writer.write("data")
    writer.close()
    // Should not throw
    writer.close()
    writer = null
  })

  test("creates file if it does not exist", () => {
    expect(existsSync(testFile)).toBe(false)
    writer = createFileWriter(testFile)
    writer.write("new file")
    writer.flush()

    expect(existsSync(testFile)).toBe(true)
    expect(readFileSync(testFile, "utf-8")).toContain("new file")
  })

  test("appends to existing file", () => {
    // Create file with initial content
    const w1 = createFileWriter(testFile, { bufferSize: 1 })
    w1.write("first")
    w1.close()

    // Open again and append
    writer = createFileWriter(testFile, { bufferSize: 1 })
    writer.write("second")
    writer.flush()

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("first\n")
    expect(content).toContain("second\n")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 5. Pipeline-based Configuration
// ─────────────────────────────────────────────────────────────────────────────

describe("pipeline-based configuration", () => {
  test("writer receives formatted output", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("test", [{ level: "trace" }, writer])

    log.info?.("hello pipeline")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("hello pipeline")
  })

  test("level filtering works in config", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("test", [{ level: "warn" }, writer])

    log.debug?.("should be filtered")
    log.info?.("should be filtered")
    log.warn?.("should pass")
    log.error?.("should pass")

    expect(lines).toHaveLength(2)
    expect(lines[0]).toContain("should pass")
  })

  test("namespace filtering works in config", () => {
    const { lines, writer } = createCapture()

    const log1 = createLogger("myapp", [
      { level: "trace", ns: "myapp" },
      writer,
    ])
    const log2 = createLogger("other", [
      { level: "trace", ns: "myapp" },
      writer,
    ])

    log1.info?.("included")
    log2.info?.("excluded")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("included")
  })

  test("namespace exclusion pattern works", () => {
    const { lines, writer } = createCapture()

    const log = createLogger("myapp", [
      { level: "trace", ns: ["*", "-myapp:sql"] },
      writer,
    ])
    const sqlChild = log.logger("sql")

    log.info?.("app message")
    sqlChild.info?.("sql message")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("app message")
  })

  test("omitting console suppresses console output", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("test", [{ level: "trace" }, writer])

    log.info?.("only to writer")

    // Writer gets output
    expect(lines).toHaveLength(1)
    // Console does not (consoleMock captures console.* calls)
    expect(consoleMock.output).toHaveLength(0)
  })

  test("multiple outputs receive events", () => {
    const { lines: lines1, writer: writer1 } = createCapture()
    const { lines: lines2, writer: writer2 } = createCapture()
    const log = createLogger("test", [{ level: "trace" }, writer1, writer2])

    log.info?.("broadcast")

    expect(lines1).toHaveLength(1)
    expect(lines2).toHaveLength(1)
    expect(lines1[0]).toContain("broadcast")
    expect(lines2[0]).toContain("broadcast")
  })

  test("JSON format works with writer", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      writer,
    ])

    log.info?.("json via writer", { key: "value" })

    const parsed = parseJSON(lines[0]!)
    expect(parsed.msg).toBe("json via writer")
    expect(parsed.key).toBe("value")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 6. DEBUG Wildcard Patterns
// ─────────────────────────────────────────────────────────────────────────────

describe("DEBUG wildcard patterns", () => {
  test("myapp:* matches myapp and children", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("myapp", [
      { level: "debug", ns: "myapp:*" },
      writer,
    ])

    log.info?.("root msg")
    const db = log.child("db")
    db.info?.("db msg")
    const deep = db.child("query")
    deep.info?.("deep msg")

    expect(lines).toHaveLength(3)
  })

  test("specific:* doesn't match unrelated namespaces", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("other", [
      { level: "debug", ns: "myapp:*" },
      writer,
    ])

    log.info?.("should not match")
    expect(lines).toHaveLength(0)
  })

  test("wildcard with exclusion", () => {
    const { lines, writer } = createCapture()
    const log = createLogger("myapp", [
      { level: "debug", ns: "myapp:*,-myapp:sql" },
      writer,
    ])

    const db = log.child("db")
    db.info?.("db msg")
    const sql = log.child("sql")
    sql.info?.("sql msg")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("db msg")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7. baseCreateLogger Standalone Usage
// ─────────────────────────────────────────────────────────────────────────────

describe("baseCreateLogger", () => {
  test("creates logger without env defaults", () => {
    const { lines, writer } = createCapture()
    const log = baseCreateLogger("test", [{ level: "debug" }, writer])

    log.info?.("hello")
    expect(lines).toHaveLength(1)
  })

  test("can be composed with pipe", () => {
    const customPlugin: LoggerPlugin = (factory) => (name, config?) => {
      const logger = factory(name, config)
      return logger
    }

    const myCreateLogger = pipe(baseCreateLogger, customPlugin)
    const { lines, writer } = createCapture()
    const log = myCreateLogger("test", [{ level: "debug" }, writer])
    log.info?.("piped")

    expect(lines).toHaveLength(1)
    expect(lines[0]).toContain("piped")
  })

  test("does not have span capability without withSpans", () => {
    const log = baseCreateLogger("test", [{ level: "trace" }, console])

    // baseCreateLogger without withSpans: span is undefined on the conditional logger
    expect(log.span).toBeUndefined()
  })

  test("gains span capability via pipe with withSpans", () => {
    const myCreateLogger = pipe(baseCreateLogger, withSpans())
    const log = myCreateLogger("test", [{ level: "trace" }, console])

    expect(log.span).toBeDefined()
    const span = log.span!("work")
    expect(span.spanData).toBeDefined()
    span.end()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7a. Zero-overhead span gating
// ─────────────────────────────────────────────────────────────────────────────

describe("zero-overhead span gating", () => {
  test("default logger has no span method when TRACE is disabled", () => {
    const log = createLogger("test:span-off")
    let propsEvaluated = false

    expect(log.span).toBeUndefined()

    using span = log.span?.("op", () => {
      propsEvaluated = true
      return { expensive: true }
    })

    expect(span).toBeUndefined()
    expect(propsEvaluated).toBe(false)
  })

  test("TRACE filter enables span only for matching logger namespaces", () => {
    const prev = process.env.TRACE
    process.env.TRACE = "test:enabled"
    try {
      const enabled = createLogger("test:enabled")
      const disabled = createLogger("test:disabled")

      expect(enabled.span).toBeDefined()
      expect(disabled.span).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.TRACE
      else process.env.TRACE = prev
    }
  })

  test("TRACE filter is evaluated for child logger namespaces", () => {
    const prev = process.env.TRACE
    process.env.TRACE = "test:parent:child"
    try {
      const parent = createLogger("test:parent")
      const child = parent.child("child")

      expect(parent.span).toBeUndefined()
      expect(child.span).toBeDefined()
    } finally {
      if (prev === undefined) delete process.env.TRACE
      else process.env.TRACE = prev
    }
  })

  test("explicit config keeps span creation available without TRACE", () => {
    const log = createLogger("test:explicit", [{ level: "trace" }, console])

    expect(log.span).toBeDefined()
    using span = log.span?.("op")

    expect(span?.spanData).toBeDefined()
  })

  test("{ spans: false } config removes span creation", () => {
    const log = createLogger("test:spans-false", [
      { level: "trace", spans: false },
      console,
    ])
    let propsEvaluated = false

    expect(log.span).toBeUndefined()
    using span = log.span?.("op", () => {
      propsEvaluated = true
      return { expensive: true }
    })

    expect(span).toBeUndefined()
    expect(propsEvaluated).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 7b. Span Laps (stopwatch checkpoints within a span)
// ─────────────────────────────────────────────────────────────────────────────

describe("span laps (stopwatch checkpoints)", () => {
  test("lap() records phase deltas; emitted in span event props", async () => {
    const prev = process.env.TRACE
    process.env.TRACE = "1"
    try {
      const writer = new CaptureWriter()
      const log = createLogger("laptest", [
        { format: "json" },
        {
          write: (event: unknown) => writer.write(JSON.stringify(event) + "\n"),
        },
      ])
      {
        using span = log.span?.("op")
        expect(span).toBeDefined()
        await new Promise((r) => setTimeout(r, 5))
        span?.lap("phase-a")
        await new Promise((r) => setTimeout(r, 5))
        span?.lap("phase-b")
      }

      const spanLine = writer.lines.find((l) => l.includes('"kind":"span"'))
      expect(spanLine, "span event was emitted").toBeDefined()
      const event = parseJSON(spanLine!)
      expect(event.props).toBeDefined()
      expect(event.props.laps).toBeDefined()
      expect(typeof event.props.laps["phase-a"]).toBe("number")
      expect(typeof event.props.laps["phase-b"]).toBe("number")
      // Both deltas should be ≥0 (they may be very small under fast clocks).
      expect(event.props.laps["phase-a"]).toBeGreaterThanOrEqual(0)
      expect(event.props.laps["phase-b"]).toBeGreaterThanOrEqual(0)
    } finally {
      if (prev === undefined) delete process.env.TRACE
      else process.env.TRACE = prev
    }
  })

  test("no laps → laps prop omitted from span event", () => {
    const prev = process.env.TRACE
    process.env.TRACE = "1"
    try {
      const writer = new CaptureWriter()
      const log = createLogger("laptest", [
        { format: "json" },
        {
          write: (event: unknown) => writer.write(JSON.stringify(event) + "\n"),
        },
      ])
      {
        using _span = log.span?.("nolaps")
        expect(_span).toBeDefined()
      }

      const spanLine = writer.lines.find((l) => l.includes('"kind":"span"'))
      expect(spanLine).toBeDefined()
      const event = parseJSON(spanLine!)
      expect(event.props.laps).toBeUndefined()
    } finally {
      if (prev === undefined) delete process.env.TRACE
      else process.env.TRACE = prev
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 8. Full Composition Chain
// ─────────────────────────────────────────────────────────────────────────────

describe("full composition chain", () => {
  test("pipe(base, withSpans, withEnvDefaults) creates working logger", () => {
    const prev = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = "info"
    try {
      const myCreateLogger = pipe(
        baseCreateLogger,
        withSpans(),
        withEnvDefaults(),
      )
      const log = myCreateLogger("test")

      expect(log.info).toBeDefined()
      log.info?.("works")
    } finally {
      if (prev !== undefined) process.env.LOG_LEVEL = prev
      else delete process.env.LOG_LEVEL
    }
  })

  test("pipe with custom plugin", () => {
    const prev = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = "info"
    try {
      const calls: string[] = []
      const trackPlugin: LoggerPlugin = (factory, _ctx) => (name, config?) => {
        calls.push(`creating: ${name}`)
        return factory(name, config)
      }

      const myCreateLogger = pipe(
        baseCreateLogger,
        trackPlugin,
        withSpans(),
        withEnvDefaults(),
      )
      const log = myCreateLogger("test")

      expect(calls).toEqual(["creating: test"])
      expect(log.info).toBeDefined()
    } finally {
      if (prev !== undefined) process.env.LOG_LEVEL = prev
      else delete process.env.LOG_LEVEL
    }
  })

  test("custom plugin can wrap factory and intercept logger creation", () => {
    let factoryCallCount = 0
    const countPlugin: LoggerPlugin = (factory) => (name, config?) => {
      factoryCallCount++
      return factory(name, config)
    }

    const myCreateLogger = pipe(baseCreateLogger, countPlugin)
    myCreateLogger("a")
    myCreateLogger("b")

    expect(factoryCallCount).toBe(2)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Redaction Plugin
// ─────────────────────────────────────────────────────────────────────────────

describe("withRedaction", () => {
  const replacement = "[REDACTED]"

  test("prepends redaction before explicit stages, outputs, and branches without mutating inputs", () => {
    const stageSeen: Event[] = []
    const branchSeen: Event[] = []
    const circular: Record<string, unknown> = { secret: "sk-circular-secret" }
    circular.self = circular
    const original = {
      password: "plain-password",
      nested: { authorization: "Bearer abc.def.ghi", circular },
      trace_id: "0123456789abcdef0123456789abcdef",
    }
    const factory = pipe(baseCreateLogger, withRedaction(), withSpans())
    const log = factory("redaction", [
      { level: "trace" },
      (event) => {
        stageSeen.push(event)
        return event
      },
      [
        (event) => {
          branchSeen.push(event)
          return event
        },
      ],
    ])

    log.info?.("credential sk-message-secret", original)

    expect(stageSeen).toHaveLength(1)
    expect(branchSeen).toHaveLength(1)
    const event = stageSeen[0]!
    expect(event).toBe(branchSeen[0])
    expect(event.props).not.toBe(original)
    expect(event.props).toMatchObject({
      password: replacement,
      nested: { authorization: replacement },
      trace_id: original.trace_id,
    })
    const redactedCircular = (
      event.props?.nested as { circular: Record<string, unknown> }
    ).circular
    expect(redactedCircular.secret).toBe(replacement)
    expect(redactedCircular.self).toBe(redactedCircular)
    expect(event.kind === "log" ? event.message : "").toBe(
      `credential ${replacement}`,
    )
    expect(original.password).toBe("plain-password")
    expect(original.nested.authorization).toBe("Bearer abc.def.ghi")
    expect(circular.secret).toBe("sk-circular-secret")
  })

  test("covers undefined and props configuration through the approved full composition order", () => {
    const previousLogLevel = process.env.LOG_LEVEL
    process.env.LOG_LEVEL = "info"
    const factory = pipe(
      baseCreateLogger,
      withRedaction(),
      withEnvDefaults(),
      withSpans(),
      withConfigMetrics(),
    )
    try {
      const plain = factory("plain")
      const contextual = factory("contextual", { apiKey: "sk-context-secret" })

      plain.info?.("Bearer plain-secret")
      contextual.info?.("safe")

      expect(JSON.stringify(consoleMock.output)).not.toMatch(
        /plain-secret|context-secret/u,
      )
      expect(JSON.stringify(consoleMock.output)).toContain(replacement)
    } finally {
      if (previousLogLevel === undefined) delete process.env.LOG_LEVEL
      else process.env.LOG_LEVEL = previousLogLevel
    }
  })

  test("covers the documented key and value policy without globally exempting hex secrets", () => {
    const seen: Event[] = []
    const correlation = "0123456789abcdef0123456789abcdef0123456789abcdef"
    const hexSecret = "fedcba9876543210fedcba9876543210fedcba9876543210"
    const longToken =
      "abcdefghijklmnopqrstuvwxyz_ABCDEFGHIJKLMNOPQRSTUVWXYZ-0123456789"
    const log = pipe(
      baseCreateLogger,
      withRedaction({ replacement: "<hidden>" }),
    )("policy", [
      { level: "trace" },
      (event) => {
        seen.push(event)
        return event
      },
    ])

    log.info?.(`hex credential ${hexSecret}`, {
      secret: "plain-secret",
      signingKey: "plain-key",
      refresh_token: "plain-token",
      "Set-Cookie": "session=plain-cookie",
      opaque: longToken,
      trace_id: correlation,
      spanId: correlation,
      requestID: correlation,
    })

    expect(seen).toHaveLength(1)
    expect(JSON.stringify(seen[0])).not.toMatch(
      /plain-secret|plain-key|plain-token|plain-cookie|fedcba|abcdefghijklmnopqrstuvwxyz_/u,
    )
    expect(seen[0]?.props).toMatchObject({
      secret: "<hidden>",
      signingKey: "<hidden>",
      refresh_token: "<hidden>",
      "Set-Cookie": "<hidden>",
      opaque: "<hidden>",
      trace_id: correlation,
      spanId: correlation,
      requestID: correlation,
    })
    expect(seen[0]?.kind === "log" ? seen[0].message : "").toBe(
      "hex credential <hidden>",
    )
  })

  test("redacts enumerable function properties and preserves Error subclasses", () => {
    class RequestError extends Error {}
    const seen: Event[] = []
    const callback = Object.assign(() => "safe", {
      token: "sk-function-secret",
    })
    const error = Object.assign(new RequestError("Bearer subclass-secret"), {
      apiKey: "sk-error-key",
    })
    const log = pipe(baseCreateLogger, withRedaction())("shapes", [
      { level: "trace" },
      (event) => {
        seen.push(event)
        return event
      },
    ])

    log.error?.(error, { callback })

    const event = seen[0]
    const redactedError =
      event?.kind === "log" ? event.userArgs?.[0] : undefined
    const redactedProps =
      event?.kind === "log" ? event.userArgs?.[1] : undefined
    const redactedCallback = (
      redactedProps as { callback?: { token?: unknown } }
    ).callback
    expect(redactedError).toBeInstanceOf(RequestError)
    expect(JSON.stringify(redactedError)).not.toMatch(/error-key/u)
    expect((redactedError as Error).message).toContain(replacement)
    expect(redactedCallback?.token).toBe(replacement)
    expect(callback.token).toBe("sk-function-secret")
  })

  test("redacts logs, spans, raw user arguments, and Error message/stack/cause", () => {
    const seen: Event[] = []
    const factory = pipe(baseCreateLogger, withRedaction(), withSpans())
    const log = factory("errors", [
      { level: "trace" },
      (event) => {
        seen.push(event)
        return event
      },
    ])
    const cause = new Error("cause sk-cause-secret")
    const error = new Error("request Bearer error-secret", { cause })

    log.error?.(error, "failed", { token: "sk-prop-secret" })
    const span = log.span?.("work", { cookie: "session-secret" })
    expect(span).toBeDefined()
    span!.spanData.password = "span-secret"
    span!.end()

    expect(seen).toHaveLength(2)
    const serialized = JSON.stringify(seen)
    expect(serialized).not.toMatch(
      /cause-secret|error-secret|prop-secret|session-secret|span-secret/u,
    )
    expect(serialized).toContain(replacement)
    const logEvent = seen.find((event) => event.kind === "log")
    const rawError =
      logEvent?.kind === "log" ? logEvent.userArgs?.[0] : undefined
    expect(rawError).toBeInstanceOf(Error)
    expect((rawError as Error).message).toContain(replacement)
    expect(String((rawError as Error).stack)).not.toContain("error-secret")
    expect(String((rawError as Error).cause)).not.toContain("cause-secret")
  })

  test("redacts before both env console and LOG_FILE sinks", async () => {
    const previous = {
      LOG_FILE: process.env.LOG_FILE,
      LOG_FORMAT: process.env.LOG_FORMAT,
      LOG_LEVEL: process.env.LOG_LEVEL,
    }
    const file = join(
      tmpdir(),
      `loggily-redaction-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
    )
    process.env.LOG_FILE = file
    process.env.LOG_FORMAT = "json"
    process.env.LOG_LEVEL = "info"
    const writerEvents: Event[] = []
    const unsubscribe = addWriter((_formatted, _level, _namespace, event) => {
      writerEvents.push(event)
    })
    try {
      const factory = pipe(
        baseCreateLogger,
        withRedaction(),
        withEnvDefaults(),
        withSpans(),
        withConfigMetrics(),
      )
      const log = factory("sinks")
      log.info?.(`sk-sink-secret ${"x.".repeat(3_000)}`, {
        password: "file-secret",
      })

      const fileText = readFileSync(file, "utf8")
      expect(fileText).not.toMatch(/sink-secret|file-secret/u)
      expect(fileText).toContain(replacement)
      expect(JSON.stringify(consoleMock.output)).not.toMatch(
        /sink-secret|file-secret/u,
      )
      expect(JSON.stringify(consoleMock.output)).toContain(replacement)
      expect(JSON.stringify(writerEvents)).not.toMatch(
        /sink-secret|file-secret/u,
      )
      expect(JSON.stringify(writerEvents)).toContain(replacement)
    } finally {
      unsubscribe()
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      if (existsSync(file)) unlinkSync(file)
    }
  })

  test("preserves bare-factory props while redacting them", () => {
    const log = pipe(baseCreateLogger, withRedaction())("bare", {
      password: "bare-password",
    })

    log.error?.("safe")

    expect(JSON.stringify(consoleMock.output)).not.toContain("bare-password")
    expect(JSON.stringify(consoleMock.output)).toContain(replacement)
  })

  test("treats a custom replacement as literal text", () => {
    const seen: Event[] = []
    const log = pipe(baseCreateLogger, withRedaction({ replacement: "$&" }))(
      "literal",
      [
        { level: "trace" },
        (event) => {
          seen.push(event)
          return event
        },
      ],
    )

    log.info?.("Bearer must-not-return")

    expect(seen[0]?.kind === "log" ? seen[0].message : "").toBe("$&")
  })

  test("a throwing deep getter drops the event fail-closed", () => {
    const seen: Event[] = []
    const stderr = vi
      .spyOn(process.stderr, "write")
      .mockImplementation(() => true)
    const log = pipe(baseCreateLogger, withRedaction())("throwing", [
      { level: "trace" },
      (event) => {
        seen.push(event)
        return event
      },
    ])
    const props: Record<string, unknown> = {}
    Object.defineProperty(props, "value", {
      enumerable: true,
      get() {
        throw new Error("redactor getter failed")
      },
    })

    expect(() =>
      log.dispatch({
        kind: "log",
        time: Date.now(),
        namespace: "throwing",
        level: "info",
        message: "must drop",
        props,
      }),
    ).not.toThrow()
    expect(seen).toEqual([])
    expect(stderr).toHaveBeenCalledWith(expect.stringContaining("fail-closed"))
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Namespace-Aware Conditional Gating
// ─────────────────────────────────────────────────────────────────────────────

describe("namespace-aware conditional gating", () => {
  let prevLogLevel: string | undefined
  let prevDebug: string | undefined

  beforeEach(() => {
    prevLogLevel = process.env.LOG_LEVEL
    prevDebug = process.env.DEBUG
  })

  afterEach(() => {
    if (prevLogLevel !== undefined) process.env.LOG_LEVEL = prevLogLevel
    else delete process.env.LOG_LEVEL
    if (prevDebug !== undefined) process.env.DEBUG = prevDebug
    else delete process.env.DEBUG
  })

  test("DEBUG=myapp:db enables debug only for matching namespace", () => {
    delete process.env.LOG_LEVEL
    process.env.DEBUG = "myapp:db"

    const dbLog = createLogger("myapp:db")
    const authLog = createLogger("myapp:auth")

    // myapp:db should have debug enabled (matches DEBUG filter)
    expect(dbLog.debug).toBeDefined()

    // myapp:auth should NOT have debug enabled (doesn't match)
    expect(authLog.debug).toBeUndefined()

    // Both should have info enabled (default level)
    expect(dbLog.info).toBeDefined()
    expect(authLog.info).toBeDefined()
  })

  test("DEBUG=myapp:* enables debug for all children", () => {
    delete process.env.LOG_LEVEL
    process.env.DEBUG = "myapp:*"

    const dbLog = createLogger("myapp:db")
    const authLog = createLogger("myapp:auth")
    const otherLog = createLogger("other")

    expect(dbLog.debug).toBeDefined()
    expect(authLog.debug).toBeDefined()
    expect(otherLog.debug).toBeUndefined()
  })

  test("without DEBUG, level is determined by LOG_LEVEL only", () => {
    process.env.LOG_LEVEL = "info"
    delete process.env.DEBUG

    const log = createLogger("myapp")

    expect(log.info).toBeDefined()
    expect(log.debug).toBeUndefined()
  })

  test("DEBUG does not enable debug when LOG_LEVEL is already debug", () => {
    process.env.LOG_LEVEL = "debug"
    process.env.DEBUG = "myapp:db"

    // LOG_LEVEL=debug means debug is already enabled for all — DEBUG filter doesn't matter
    const authLog = createLogger("myapp:auth")
    expect(authLog.debug).toBeDefined() // debug enabled by LOG_LEVEL, not DEBUG
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 9. Deprecated v1 API throws
// ─────────────────────────────────────────────────────────────────────────────

describe("deprecated v1 global setters still work", () => {
  test("setLogLevel sets LOG_LEVEL env var", () => {
    setLogLevel("debug")
    expect(getLogLevel()).toBe("debug")
    setLogLevel("info")
  })

  test("enableSpans/disableSpans toggle TRACE env var", () => {
    enableSpans()
    expect(spansAreEnabled()).toBe(true)
    disableSpans()
    expect(spansAreEnabled()).toBe(false)
  })

  test("setDebugFilter sets DEBUG env var", () => {
    setDebugFilter(["myapp", "-myapp:sql"])
    expect(getDebugFilter()).toEqual(["myapp", "-myapp:sql"])
    setDebugFilter(null)
    expect(getDebugFilter()).toBeNull()
  })

  test("setLogFormat sets LOG_FORMAT env var", () => {
    setLogFormat("json")
    expect(getLogFormat()).toBe("json")
    setLogFormat("console")
  })

  test("addWriter registers and unregisters", () => {
    const calls: string[] = []
    const unsub = addWriter((formatted) => calls.push(formatted))
    expect(typeof unsub).toBe("function")
    unsub()
  })

  test("setSuppressConsole toggles runtime state", () => {
    setSuppressConsole(true)
    setSuppressConsole(false)
  })
})

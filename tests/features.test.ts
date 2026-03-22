/**
 * Tests for new logger features:
 * 1. Lazy string interpolation
 * 2. Child loggers with context
 * 3. Structured logging (LOG_FORMAT=json)
 * 4. Async file writer
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { existsSync, readFileSync, unlinkSync } from "fs"
import { join } from "path"
import { tmpdir } from "os"
import {
  createLogger,
  setLogLevel,
  setLogFormat,
  getLogFormat,
  setOutputMode,
  resetIds,
  disableSpans,
  enableSpans,
  setTraceFilter,
  setDebugFilter,
  createFileWriter,
  addWriter,
  type FileWriter,
} from "../src/index.ts"
import { createConsoleMock } from "./helpers.ts"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parseJSON = (s: string): Record<string, any> => JSON.parse(s) as Record<string, any>

let consoleMock: ReturnType<typeof createConsoleMock>

beforeEach(() => {
  resetIds()
  setLogLevel("trace")
  disableSpans()
  setTraceFilter(null)
  setDebugFilter(null)
  setOutputMode("console")
  setLogFormat("console")
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
    const log = createLogger("test")
    log.info?.(() => "lazy message")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("lazy message")
  })

  test("function is called when level is enabled", () => {
    const fn = vi.fn(() => "computed value")
    const log = createLogger("test")
    log.info?.(fn)

    expect(fn).toHaveBeenCalledTimes(1)
    expect(consoleMock.output[0]!.message).toContain("computed value")
  })

  test("function is NOT called when level is disabled", () => {
    setLogLevel("error")
    const fn = vi.fn(() => "expensive computation")
    const log = createLogger("test")

    // debug is disabled at error level, so fn should never be called
    log.debug?.(fn)

    expect(fn).not.toHaveBeenCalled()
    expect(consoleMock.output).toHaveLength(0)
  })

  test("function is NOT called when namespace is filtered out", () => {
    setDebugFilter(["allowed"])
    const fn = vi.fn(() => "expensive computation")
    const log = createLogger("blocked")

    log.info?.(fn)

    expect(fn).not.toHaveBeenCalled()
    expect(consoleMock.output).toHaveLength(0)
  })

  test("string messages still work unchanged", () => {
    const log = createLogger("test")
    log.info?.("plain string")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("plain string")
  })

  test("lazy messages work with data parameter", () => {
    const log = createLogger("test")
    log.info?.(() => "lazy with data", { key: "value" })

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("lazy with data")
    expect(consoleMock.output[0]!.message).toContain("key")
  })

  test("lazy messages work with all log levels", () => {
    const log = createLogger("test")

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
    setLogFormat("json")
    const log = createLogger("test")
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
    const log = createLogger("app")
    const child = log.child({ requestId: "abc-123" })

    child.info?.("handling request")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("requestId")
    expect(consoleMock.output[0]!.message).toContain("abc-123")
  })

  test("child keeps parent namespace", () => {
    const log = createLogger("app")
    const child = log.child({ requestId: "abc" })

    expect(child.name).toBe("app")
  })

  test("child inherits parent props", () => {
    const log = createLogger("app", { version: "1.0" })
    const child = log.child({ requestId: "abc" })

    expect(child.props).toEqual({ version: "1.0", requestId: "abc" })
  })

  test("child context is included in every log message", () => {
    setLogFormat("json")
    const log = createLogger("app")
    const child = log.child({ requestId: "abc" })

    child.info?.("first")
    child.warn?.("second")

    const first = parseJSON(consoleMock.output[0]!.message)
    const second = parseJSON(consoleMock.output[1]!.message)
    expect(first.requestId).toBe("abc")
    expect(second.requestId).toBe("abc")
  })

  test("child context merges with per-call data", () => {
    setLogFormat("json")
    const log = createLogger("app")
    const child = log.child({ requestId: "abc" })

    child.info?.("msg", { extra: "data" })

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.requestId).toBe("abc")
    expect(parsed.extra).toBe("data")
  })

  test("nested children accumulate context", () => {
    setLogFormat("json")
    const log = createLogger("app")
    const child1 = log.child({ requestId: "abc" })
    const child2 = child1.child({ userId: "user-1" })

    child2.info?.("nested context")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.requestId).toBe("abc")
    expect(parsed.userId).toBe("user-1")
  })

  test("child context overrides parent props on conflict", () => {
    setLogFormat("json")
    const log = createLogger("app", { env: "prod" })
    const child = log.child({ env: "test" })

    child.info?.("override")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.env).toBe("test")
  })

  test("deprecated string child still works", () => {
    const log = createLogger("app")
    const child = log.child("import")

    expect(child.name).toBe("app:import")
  })

  test("child can create spans", () => {
    enableSpans()
    const log = createLogger("app")
    const child = log.child({ requestId: "abc" })

    {
      using span = child.span("work")
      span.info?.("working")
    }

    // Check span output includes the context
    const spanOutput = consoleMock.output.find((o) => o.message.includes("SPAN"))
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("requestId")
  })

  test("child can create further children via .logger()", () => {
    const log = createLogger("app")
    const child = log.child({ requestId: "abc" })
    const subLogger = child.logger("db")

    expect(subLogger.name).toBe("app:db")
    expect(subLogger.props).toEqual({ requestId: "abc" })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 3. Structured Logging (LOG_FORMAT=json)
// ─────────────────────────────────────────────────────────────────────────────

describe("LOG_FORMAT configuration", () => {
  test("setLogFormat('json') produces JSON output", () => {
    setLogFormat("json")
    const log = createLogger("test")

    log.info?.("json message", { key: "value" })

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.level).toBe("info")
    expect(parsed.name).toBe("test")
    expect(parsed.msg).toBe("json message")
    expect(parsed.key).toBe("value")
    expect(parsed.time).toBeDefined()
  })

  test("setLogFormat('console') produces human-readable output", () => {
    setLogFormat("console")
    const log = createLogger("test")

    log.info?.("console message")

    const output = consoleMock.output[0]!.message
    expect(output).toContain("INFO")
    expect(output).toContain("test")
    expect(output).toContain("console message")
    // Should not be valid JSON
    expect(() => parseJSON(output)).toThrow()
  })

  test("getLogFormat returns current format", () => {
    expect(getLogFormat()).toBe("console")

    setLogFormat("json")
    expect(getLogFormat()).toBe("json")

    setLogFormat("console")
    expect(getLogFormat()).toBe("console")
  })

  test("JSON format includes all props", () => {
    setLogFormat("json")
    const log = createLogger("test", { app: "myapp", version: "1.0" })

    log.info?.("message")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.app).toBe("myapp")
    expect(parsed.version).toBe("1.0")
  })

  test("JSON format handles errors", () => {
    setLogFormat("json")
    const log = createLogger("test")
    const err = new Error("json error")

    log.error?.(err)

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed.msg).toBe("json error")
    expect(parsed.error_type).toBe("Error")
  })

  test("JSON format works with spans", () => {
    setLogFormat("json")
    enableSpans()
    const log = createLogger("test")

    {
      using span = log.span("work")
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
    setLogFormat("json")
    const log = createLogger("myapp")

    log.info?.("request handled")

    const parsed = parseJSON(consoleMock.output[0]!.message)
    expect(parsed).toHaveProperty("time")
    expect(parsed).toHaveProperty("level", "info")
    expect(parsed).toHaveProperty("name", "myapp")
    expect(parsed).toHaveProperty("msg", "request handled")
    // time should be ISO format
    expect(new Date(parsed.time).toISOString()).toBe(parsed.time)
  })

  describe("LOG_FORMAT env var", () => {
    let originalLogFormat: string | undefined

    beforeEach(() => {
      originalLogFormat = process.env.LOG_FORMAT
    })

    afterEach(() => {
      if (originalLogFormat === undefined) {
        delete process.env.LOG_FORMAT
      } else {
        process.env.LOG_FORMAT = originalLogFormat
      }
    })

    test("LOG_FORMAT=json is respected at init time (tested via setLogFormat)", () => {
      // The env var is read at module load time, so we test the API directly
      setLogFormat("json")
      const log = createLogger("test")

      log.info?.("env json")

      const parsed = parseJSON(consoleMock.output[0]!.message)
      expect(parsed.msg).toBe("env json")
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// 4. Async File Writer
// ─────────────────────────────────────────────────────────────────────────────

describe("createFileWriter", () => {
  let testFile: string
  let writer: FileWriter | null = null

  beforeEach(() => {
    testFile = join(tmpdir(), `logger-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`)
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
    writer = createFileWriter(testFile, { bufferSize: 10, flushInterval: 60000 })

    // Write enough to exceed 10 bytes
    writer.write("hello world this is a long line")

    // Should have flushed automatically
    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("hello world")
  })

  test("flush() writes buffer to disk", () => {
    writer = createFileWriter(testFile, { bufferSize: 999999, flushInterval: 60000 })

    writer.write("buffered line")
    // Not yet flushed (buffer is large, interval is long)
    const before = existsSync(testFile) ? readFileSync(testFile, "utf-8") : ""

    writer.flush()
    const after = readFileSync(testFile, "utf-8")
    expect(after).toContain("buffered line\n")
  })

  test("close() flushes remaining buffer and closes fd", () => {
    writer = createFileWriter(testFile, { bufferSize: 999999, flushInterval: 60000 })

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

  test("integrates with addWriter", () => {
    writer = createFileWriter(testFile, { bufferSize: 1 })
    const unsubscribe = addWriter((formatted) => writer!.write(formatted))

    const log = createLogger("test")
    log.info?.("writer integration")

    writer.flush()
    unsubscribe()

    const content = readFileSync(testFile, "utf-8")
    expect(content).toContain("writer integration")
  })

  test("flushes on interval", async () => {
    writer = createFileWriter(testFile, { bufferSize: 999999, flushInterval: 50 })

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

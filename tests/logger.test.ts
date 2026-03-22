/**
 * loggily Test Suite
 *
 * Tests for the logger-first observability system.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  createLogger,
  enableSpans,
  disableSpans,
  setLogLevel,
  getLogLevel,
  spansAreEnabled,
  setTraceFilter,
  getTraceFilter,
  setDebugFilter,
  getDebugFilter,
  setOutputMode,
  resetIds,
  type Logger,
  type SpanLogger,
  type ConditionalLogger,
} from "../src/index.ts"
import { createConsoleMock } from "./helpers.ts"

// Console mock instance for all tests
let consoleMock: ReturnType<typeof createConsoleMock>

beforeEach(() => {
  resetIds()
  setLogLevel("trace") // Enable all levels
  disableSpans() // Start with spans disabled
  setTraceFilter(null) // Clear any trace filter
  setDebugFilter(null) // Clear any debug filter
  setOutputMode("console") // Reset output mode
  consoleMock = createConsoleMock()
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe("createLogger", () => {
  test("creates logger with name", () => {
    const log = createLogger("myapp")
    expect(log.name).toBe("myapp")
  })

  test("creates logger with props", () => {
    const log = createLogger("myapp", { version: "1.0" })
    expect(log.props).toEqual({ version: "1.0" })
  })

  test("props are frozen", () => {
    const log = createLogger("myapp", { version: "1.0" })
    expect(() => {
      // @ts-expect-error - testing immutability
      log.props.version = "2.0"
    }).toThrow()
  })

  test("spanData is null for regular logger", () => {
    const log = createLogger("myapp")
    expect(log.spanData).toBeNull()
  })
})

describe("logging methods", () => {
  // Test all log levels with their expected console method
  test.each([
    ["trace", "debug"], // trace uses console.debug
    ["debug", "debug"],
    ["info", "info"],
    ["warn", "warn"],
    ["error", "error"],
  ] as const)("%s level uses console.%s", (logLevel, consoleMethod) => {
    const log = createLogger("test")
    log[logLevel]!(`${logLevel} message`)

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.level).toBe(consoleMethod)
  })

  test("includes data in output", () => {
    const log = createLogger("test")
    log.info!("message", { key: "value" })

    expect(consoleMock.output[0]!.message).toContain("key")
    expect(consoleMock.output[0]!.message).toContain("value")
  })

  test("inherits props in output", () => {
    const log = createLogger("test", { app: "myapp" })
    log.info!("message")

    expect(consoleMock.output[0]!.message).toContain("app")
    expect(consoleMock.output[0]!.message).toContain("myapp")
  })

  // Test log level filtering - levels below threshold are filtered out
  // Note: createLogger returns ConditionalLogger where disabled levels are undefined
  test.each([
    ["warn", ["warn", "error"], 2],
    ["error", ["error"], 1],
    ["info", ["info", "warn", "error"], 3],
  ] as const)("setLogLevel(%s) filters to %j", (threshold, expectedLevels, expectedCount) => {
    setLogLevel(threshold)
    const log = createLogger("test")

    log.debug?.("d")
    log.info?.("i")
    log.warn?.("w")
    log.error?.("e")

    expect(consoleMock.output).toHaveLength(expectedCount)
  })

  test("error accepts Error object", () => {
    const log = createLogger("test")
    const err = new Error("Something went wrong")

    log.error!(err)

    expect(consoleMock.output[0]!.message).toContain("Something went wrong")
    expect(consoleMock.output[0]!.message).toContain("error_type")
  })
})

describe("logger hierarchy", () => {
  test(".logger() creates child with extended namespace", () => {
    const parent = createLogger("app")
    const child = parent.logger("import")

    expect(child.name).toBe("app:import")
  })

  test(".logger() inherits parent props", () => {
    const parent = createLogger("app", { version: "1.0" })
    const child = parent.logger("import")

    expect(child.props).toEqual({ version: "1.0" })
  })

  test(".logger() merges additional props", () => {
    const parent = createLogger("app", { version: "1.0" })
    const child = parent.logger("import", { file: "data.csv" })

    expect(child.props).toEqual({ version: "1.0", file: "data.csv" })
  })

  test(".logger() without namespace keeps same name", () => {
    const parent = createLogger("app")
    const child = parent.logger(undefined, { extra: true })

    expect(child.name).toBe("app")
  })

  test(".child() is deprecated alias for .logger()", () => {
    const parent = createLogger("app")
    const child = parent.child("import")

    expect(child.name).toBe("app:import")
  })
})

describe("spans", () => {
  test(".span() creates logger with spanData", () => {
    const log = createLogger("app")
    const span = log.span("import")

    expect(span.spanData).not.toBeNull()
    expect(span.spanData!.id).toBe("sp_1")
    expect(span.spanData!.traceId).toBe("tr_1")
  })

  test("span extends namespace", () => {
    const log = createLogger("app")
    const span = log.span("import")

    expect(span.name).toBe("app:import")
  })

  test("span inherits props", () => {
    const log = createLogger("app", { version: "1.0" })
    const span = log.span("import", { file: "data.csv" })

    expect(span.props).toEqual({ version: "1.0", file: "data.csv" })
  })

  test("span has live duration", () => {
    const log = createLogger("app")
    const span = log.span("import")

    const d1 = span.spanData!.duration
    expect(d1).toBeGreaterThanOrEqual(0)

    // Wait a bit
    const start = Date.now()
    while (Date.now() - start < 10) {}

    const d2 = span.spanData!.duration
    expect(d2).toBeGreaterThan(d1!)

    span.end()
  })

  test("span attributes can be set", () => {
    const log = createLogger("app")
    const span = log.span("import")

    span.spanData.count = 42
    span.spanData.name = "test"

    expect(span.spanData.count).toBe(42)
    expect(span.spanData.name).toBe("test")

    span.end()
  })

  test("using keyword auto-disposes span", () => {
    enableSpans()
    const log = createLogger("app")

    {
      using span = log.span("import")
      span.spanData.count = 42
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("app:import")
  })

  test("nested spans have parent-child relationship", () => {
    const log = createLogger("app")

    const parent = log.span("import")
    const child = parent.span("parse")

    expect(child.spanData!.parentId).toBe(parent.spanData!.id)
    expect(child.spanData!.traceId).toBe(parent.spanData!.traceId)

    child.end()
    parent.end()
  })

  test("nested spans share trace ID", () => {
    const log = createLogger("app")

    const span1 = log.span("import")
    const span2 = span1.span("parse")
    const span3 = span2.span("validate")

    expect(span1.spanData!.traceId).toBe("tr_1")
    expect(span2.spanData!.traceId).toBe("tr_1")
    expect(span3.spanData!.traceId).toBe("tr_1")

    span3.end()
    span2.end()
    span1.end()
  })

  test(".end() can be called manually", () => {
    enableSpans()
    const log = createLogger("app")
    const span = log.span("import")

    span.end()

    expect(span.spanData!.endTime).not.toBeNull()
    expect(span.spanData!.duration).toBeGreaterThanOrEqual(0)
  })

  test("span output includes attributes", () => {
    enableSpans()
    const log = createLogger("app")

    {
      using span = log.span("import", { file: "data.csv" })
      span.spanData.count = 42
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput!.message).toContain("file")
    expect(spanOutput!.message).toContain("count")
    expect(spanOutput!.message).toContain("42")
  })
})

describe("span output control", () => {
  test("spans disabled by default", () => {
    const log = createLogger("app")

    {
      using span = log.span("import")
      span.info("working")
    }

    // Only the info log, no span
    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).not.toContain("SPAN")
  })

  test("enableSpans() enables span output", () => {
    enableSpans()
    const log = createLogger("app")

    {
      using span = log.span("import")
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("disableSpans() disables span output", () => {
    enableSpans()
    disableSpans()
    const log = createLogger("app")

    {
      using span = log.span("import")
    }

    expect(consoleMock.findSpan()).toBeUndefined()
  })
})

describe("console method usage (patchConsole compatibility)", () => {
  // Consolidated: log level -> console method mapping (covered above in logging methods)
  // This describe block focuses on patchConsole-specific behavior

  test("span output uses process.stderr.write (bypasses Ink patchConsole)", () => {
    enableSpans()
    const log = createLogger("test")

    {
      using span = log.span("work")
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput!.level).toBe("stderr") // Spans bypass console, go directly to stderr
  })
})

describe("createLogger", () => {
  // Test enabled/disabled levels with parameterized tests
  test.each([
    ["trace", { trace: true, debug: true, info: true, warn: true, error: true }],
    ["debug", { trace: false, debug: true, info: true, warn: true, error: true }],
    ["warn", { trace: false, debug: false, info: false, warn: true, error: true }],
    ["error", { trace: false, debug: false, info: false, warn: false, error: true }],
  ] as const)("at level %s, methods defined: %o", (level, expected) => {
    setLogLevel(level)
    const log = createLogger("test")

    expect(log.trace !== undefined).toBe(expected.trace)
    expect(log.debug !== undefined).toBe(expected.debug)
    expect(log.info !== undefined).toBe(expected.info)
    expect(log.warn !== undefined).toBe(expected.warn)
    expect(log.error !== undefined).toBe(expected.error)
  })

  test("optional chaining skips call when disabled", () => {
    setLogLevel("error")
    const log = createLogger("test")

    log.debug?.("should not log")
    log.info?.("should not log")
    log.warn?.("should not log")

    expect(consoleMock.output).toHaveLength(0)
  })

  test("optional chaining calls method when enabled", () => {
    setLogLevel("debug")
    const log = createLogger("test")

    log.debug?.("should log")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("should log")
  })

  test("inherits props from base logger", () => {
    setLogLevel("info")
    const log = createLogger("test", { version: "1.0" })

    expect(log.props).toEqual({ version: "1.0" })
  })

  test("can create child loggers and spans", () => {
    setLogLevel("info")
    const log = createLogger("test")

    const child = log.logger("child")
    expect(child.name).toBe("test:child")

    const span = log.span("work")
    expect(span.spanData).not.toBeNull()
    span.end()
  })

  test("responds to log level changes", () => {
    const log = createLogger("test")

    setLogLevel("error")
    expect(log.debug).toBeUndefined()
    expect(log.info).toBeUndefined()

    setLogLevel("debug")
    expect(log.debug).toBeDefined()
    expect(log.info).toBeDefined()
  })
})

describe("configuration functions", () => {
  test("getLogLevel returns current level", () => {
    setLogLevel("warn")
    expect(getLogLevel()).toBe("warn")

    setLogLevel("debug")
    expect(getLogLevel()).toBe("debug")
  })

  test("spansAreEnabled tracks span state", () => {
    disableSpans()
    expect(spansAreEnabled()).toBe(false)

    enableSpans()
    expect(spansAreEnabled()).toBe(true)

    disableSpans()
    expect(spansAreEnabled()).toBe(false)
  })
})

describe("JSON format output", () => {
  let originalNodeEnv: string | undefined
  let originalTraceFormat: string | undefined

  beforeEach(() => {
    originalNodeEnv = process.env.NODE_ENV
    originalTraceFormat = process.env.TRACE_FORMAT
  })

  afterEach(() => {
    if (originalNodeEnv === undefined) {
      delete process.env.NODE_ENV
    } else {
      process.env.NODE_ENV = originalNodeEnv
    }
    if (originalTraceFormat === undefined) {
      delete process.env.TRACE_FORMAT
    } else {
      process.env.TRACE_FORMAT = originalTraceFormat
    }
  })

  test("TRACE_FORMAT=json produces JSON output", () => {
    process.env.TRACE_FORMAT = "json"
    const log = createLogger("test")

    log.info!("test message", { key: "value" })

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.level).toBe("info")
    expect(parsed.name).toBe("test")
    expect(parsed.msg).toBe("test message")
    expect(parsed.key).toBe("value")
    expect(parsed.time).toBeDefined()
  })

  test("NODE_ENV=production produces JSON output", () => {
    process.env.NODE_ENV = "production"
    delete process.env.TRACE_FORMAT
    const log = createLogger("test")

    log.info!("prod message")

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("prod message")
  })

  test("JSON output includes all props", () => {
    process.env.TRACE_FORMAT = "json"
    const log = createLogger("test", { app: "myapp", version: "1.0" })

    log.info!("message")

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.app).toBe("myapp")
    expect(parsed.version).toBe("1.0")
  })

  test("JSON output handles errors", () => {
    process.env.TRACE_FORMAT = "json"
    const log = createLogger("test")
    const err = new Error("test error")

    log.error!(err)

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.msg).toBe("test error")
    expect(parsed.error_type).toBe("Error")
    expect(parsed.error_stack).toContain("Error: test error")
  })

  test("JSON span output includes duration", () => {
    process.env.TRACE_FORMAT = "json"
    enableSpans()
    const log = createLogger("test")

    {
      using span = log.span("work")
      span.spanData.count = 42
    }

    const spanOutput = consoleMock.output.find((o) => {
      try {
        const parsed = JSON.parse(o.message) as Record<string, unknown>
        return parsed.level === "span"
      } catch {
        return false
      }
    })
    expect(spanOutput).toBeDefined()

    const parsed = JSON.parse(spanOutput!.message) as Record<string, unknown>
    expect(parsed.level).toBe("span")
    expect(parsed.name).toBe("test:work")
    expect(parsed.duration).toBeGreaterThanOrEqual(0)
    expect(parsed.count).toBe(42)
  })

  test("JSON handles circular references", () => {
    process.env.TRACE_FORMAT = "json"
    const log = createLogger("test")

    const circular: Record<string, unknown> = { name: "test" }
    circular.self = circular

    log.info!("circular", circular)

    const output = consoleMock.output[0]!.message
    // Should not throw, should contain [Circular]
    expect(output).toContain("[Circular]")
  })
})

describe("console format output", () => {
  test("includes timestamp", () => {
    const log = createLogger("test")
    log.info!("message")

    // Format: HH:MM:SS
    expect(consoleMock.output[0]!.message).toMatch(/\d{2}:\d{2}:\d{2}/)
  })

  // Test level labels in console output
  test.each([
    ["trace", "TRACE"],
    ["debug", "DEBUG"],
    ["info", "INFO"],
    ["warn", "WARN"],
    ["error", "ERROR"],
  ] as const)("%s level outputs %s label", (method, label) => {
    const log = createLogger("test")
    log[method]!("msg")

    expect(consoleMock.output[0]!.message).toContain(label)
  })

  test("includes namespace", () => {
    const log = createLogger("myapp")
    log.info!("message")

    expect(consoleMock.output[0]!.message).toContain("myapp")
  })

  test("span format includes SPAN label and duration", () => {
    enableSpans()
    const log = createLogger("test")

    {
      using span = log.span("work")
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toMatch(/\(\d+ms\)/)
  })
})

describe("TRACE namespace filtering", () => {
  test("setTraceFilter with namespaces enables spans and filtering", () => {
    setTraceFilter(["myapp"])

    expect(spansAreEnabled()).toBe(true)
    expect(getTraceFilter()).toEqual(["myapp"])
  })

  // Test that setTraceFilter clears filter (but doesn't disable spans)
  test.each([[null], [[]]])("setTraceFilter(%j) clears filter", (filter) => {
    setTraceFilter(["myapp"])
    setTraceFilter(filter)

    expect(getTraceFilter()).toBeNull()
  })

  test("filter allows exact namespace match", () => {
    setTraceFilter(["myapp"])
    const log = createLogger("myapp")

    {
      using span = log.span("work")
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("filter allows child namespace match", () => {
    setTraceFilter(["myapp"])
    const log = createLogger("myapp")

    {
      using span = log.span("import") // myapp:import
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("filter blocks non-matching namespace", () => {
    setTraceFilter(["myapp"])
    const log = createLogger("other")

    {
      using span = log.span("work")
    }

    expect(consoleMock.findSpan()).toBeUndefined()
  })

  test("filter supports multiple namespaces", () => {
    setTraceFilter(["myapp", "other"])

    const log1 = createLogger("myapp")
    const log2 = createLogger("other")
    const log3 = createLogger("blocked")

    {
      using span = log1.span("work")
    }
    {
      using span = log2.span("work")
    }
    {
      using span = log3.span("work")
    }

    const spanOutputs = consoleMock.findSpans()
    expect(spanOutputs).toHaveLength(2)
    expect(spanOutputs[0]!.message).toContain("myapp")
    expect(spanOutputs[1]!.message).toContain("other")
  })

  test("filter does not affect regular log messages", () => {
    setTraceFilter(["myapp"])
    const log = createLogger("other") // Not in filter

    log.info!("regular log")

    // Regular logs still appear
    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("regular log")
  })

  test("no filter when spans enabled without setTraceFilter", () => {
    enableSpans()

    const log1 = createLogger("any")
    const log2 = createLogger("namespace")

    {
      using span = log1.span("work")
    }
    {
      using span = log2.span("work")
    }

    // Both should appear
    expect(consoleMock.findSpans()).toHaveLength(2)
  })
})

describe("DEBUG namespace filtering", () => {
  test("setDebugFilter enables namespace filtering", () => {
    setDebugFilter(["myapp"])
    expect(getDebugFilter()).toEqual(["myapp"])
  })

  test("setDebugFilter(null) clears filter", () => {
    setDebugFilter(["myapp"])
    setDebugFilter(null)
    expect(getDebugFilter()).toBeNull()
  })

  test("setDebugFilter([]) clears filter", () => {
    setDebugFilter(["myapp"])
    setDebugFilter([])
    expect(getDebugFilter()).toBeNull()
  })

  test("filter allows exact namespace match", () => {
    setDebugFilter(["myapp"])
    const log = createLogger("myapp")
    log.info!("visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("visible")
  })

  test("filter allows child namespace match", () => {
    setDebugFilter(["myapp"])
    const log = createLogger("myapp")
    const child = log.logger("db")
    child.info("visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("visible")
  })

  test("filter blocks non-matching namespace", () => {
    setDebugFilter(["myapp"])
    const log = createLogger("other")
    log.info!("hidden")

    expect(consoleMock.output).toHaveLength(0)
  })

  test("filter supports multiple namespaces", () => {
    setDebugFilter(["myapp", "other"])

    const log1 = createLogger("myapp")
    const log2 = createLogger("other")
    const log3 = createLogger("blocked")

    log1.info!("msg1")
    log2.info!("msg2")
    log3.info!("msg3")

    expect(consoleMock.output).toHaveLength(2)
    expect(consoleMock.output[0]!.message).toContain("myapp")
    expect(consoleMock.output[1]!.message).toContain("other")
  })

  test("wildcard '*' allows all namespaces", () => {
    setDebugFilter(["*"])

    const log1 = createLogger("any")
    const log2 = createLogger("namespace")

    log1.info!("msg1")
    log2.info!("msg2")

    expect(consoleMock.output).toHaveLength(2)
  })

  test("negative pattern excludes matching namespace", () => {
    setDebugFilter(["myapp", "-myapp:noisy"])

    const log = createLogger("myapp")
    const quiet = log.logger("db")
    const noisy = log.logger("noisy")

    log.info!("root")
    quiet.info("db msg")
    noisy.info("noisy msg")

    expect(consoleMock.output).toHaveLength(2)
    expect(consoleMock.output[0]!.message).toContain("root")
    expect(consoleMock.output[1]!.message).toContain("db msg")
  })

  test("negative pattern excludes children of excluded namespace", () => {
    setDebugFilter(["*", "-km:storage:sql"])

    const log = createLogger("km")
    const storage = log.logger("storage")
    const sql = storage.logger("sql")
    const sqlChild = sql.logger("detail")

    log.info!("visible")
    storage.info("visible")
    sql.info("hidden")
    sqlChild.info("also hidden")

    expect(consoleMock.output).toHaveLength(2)
  })

  test("exclude-only pattern (no includes) blocks only excluded", () => {
    setDebugFilter(["-km:noisy"])

    const log1 = createLogger("km")
    const log2 = createLogger("km").logger("noisy")
    const log3 = createLogger("other")

    log1.info!("visible")
    log2.info("hidden")
    log3.info!("visible")

    expect(consoleMock.output).toHaveLength(2)
    expect(consoleMock.output[0]!.message).toContain("km")
    expect(consoleMock.output[1]!.message).toContain("other")
  })

  test("setDebugFilter auto-lowers log level to debug", () => {
    setLogLevel("warn")
    setDebugFilter(["myapp"])

    expect(getLogLevel()).toBe("debug")
  })

  test("setDebugFilter preserves trace log level", () => {
    setLogLevel("trace")
    setDebugFilter(["myapp"])

    expect(getLogLevel()).toBe("trace")
  })

  test("debug messages visible when filter matches", () => {
    setLogLevel("warn") // Would normally hide debug
    setDebugFilter(["myapp"]) // Auto-lowers to debug

    const log = createLogger("myapp")
    log.debug?.("debug visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("debug visible")
  })

  test("getDebugFilter returns includes and excludes", () => {
    setDebugFilter(["myapp", "-noisy"])

    const filter = getDebugFilter()!
    expect(filter).toContain("myapp")
    expect(filter).toContain("-noisy")
  })

  test("filter also applies to spans", () => {
    enableSpans()
    setDebugFilter(["myapp"])

    const log1 = createLogger("myapp")
    const log2 = createLogger("other")

    {
      using span = log1.span("work")
    }
    {
      using span = log2.span("work")
    }

    const spans = consoleMock.findSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.message).toContain("myapp")
  })
})

describe("setOutputMode", () => {
  test("stderr mode routes writeLog to stderr", () => {
    setOutputMode("stderr")
    const log = createLogger("test")
    log.info?.("hello")

    const stderrOutput = consoleMock.output.filter((o) => o.level === "stderr")
    expect(stderrOutput).toHaveLength(1)
    expect(stderrOutput[0]!.message).toContain("hello")

    // Should NOT appear in console output
    const consoleOutput = consoleMock.output.filter((o) => o.level === "info")
    expect(consoleOutput).toHaveLength(0)
  })

  test("writers-only mode suppresses all direct output", () => {
    setOutputMode("writers-only")
    const log = createLogger("test")
    log.info?.("hello")

    // No console or stderr output
    expect(consoleMock.output).toHaveLength(0)
  })

  test("console mode (default) uses console methods", () => {
    setOutputMode("console")
    const log = createLogger("test")
    log.info?.("hello")

    const consoleOutput = consoleMock.output.filter((o) => o.level === "info")
    expect(consoleOutput).toHaveLength(1)
  })
})

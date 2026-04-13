/**
 * loggily v2 Test Suite
 *
 * Tests for the pipeline-based observability system.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  createLogger,
  resetIds,
  type Logger,
  type SpanLogger,
  type ConditionalLogger,
} from "../src/index.ts"
import { createConsoleMock } from "./helpers.ts"

// Console mock instance for all tests
let consoleMock: ReturnType<typeof createConsoleMock>

// Save/restore env vars
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  resetIds()
  consoleMock = createConsoleMock()
  savedEnv = {
    TRACE: process.env.TRACE,
    DEBUG: process.env.DEBUG,
    LOG_LEVEL: process.env.LOG_LEVEL,
    LOG_FORMAT: process.env.LOG_FORMAT,
    TRACE_FORMAT: process.env.TRACE_FORMAT,
    NODE_ENV: process.env.NODE_ENV,
  }
  // Clean env so tests start from a known state
  delete process.env.TRACE
  delete process.env.DEBUG
  delete process.env.LOG_LEVEL
  delete process.env.LOG_FORMAT
  delete process.env.TRACE_FORMAT
  delete process.env.NODE_ENV
})

afterEach(() => {
  vi.restoreAllMocks()
  // Restore env
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

describe("createLogger", () => {
  test("creates logger with name", () => {
    const log = createLogger("myapp", [{ level: "trace" }, console])
    expect(log.name).toBe("myapp")
  })

  test("creates logger with props via child", () => {
    const log = createLogger("myapp", [{ level: "trace" }, console])
    const child = log.child({ version: "1.0" })
    expect(child.props).toEqual({ version: "1.0" })
  })

  test("props are frozen", () => {
    const log = createLogger("myapp", [{ level: "trace" }, console])
    const child = log.child({ version: "1.0" })
    expect(() => {
      // @ts-expect-error - testing immutability
      child.props.version = "2.0"
    }).toThrow()
  })

  test("spanData is undefined for regular logger", () => {
    const log = createLogger("myapp", [{ level: "trace" }, console])
    expect((log as unknown as Record<string, unknown>).spanData).toBeUndefined()
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
    const log = createLogger("test", [{ level: "trace" }, console])
    log[logLevel]!(`${logLevel} message`)

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.level).toBe(consoleMethod)
  })

  test("includes data in output", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info!("message", { key: "value" })

    expect(consoleMock.output[0]!.message).toContain("key")
    expect(consoleMock.output[0]!.message).toContain("value")
  })

  test("inherits props in output", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    const child = log.child({ app: "myapp" })
    child.info!("message")

    expect(consoleMock.output[0]!.message).toContain("app")
    expect(consoleMock.output[0]!.message).toContain("myapp")
  })

  // Test log level filtering - levels below threshold are filtered out
  // Note: createLogger returns ConditionalLogger where disabled levels are undefined
  test.each([
    ["warn", ["warn", "error"], 2],
    ["error", ["error"], 1],
    ["info", ["info", "warn", "error"], 3],
  ] as const)(
    "level %s filters to %j",
    (threshold, expectedLevels, expectedCount) => {
      const log = createLogger("test", [{ level: threshold }, console])

      log.debug?.("d")
      log.info?.("i")
      log.warn?.("w")
      log.error?.("e")

      expect(consoleMock.output).toHaveLength(expectedCount)
    },
  )

  test("error accepts Error object", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    const err = new Error("Something went wrong")

    log.error!(err)

    expect(consoleMock.output[0]!.message).toContain("Something went wrong")
    expect(consoleMock.output[0]!.message).toContain("error_type")
  })
})

describe("logger hierarchy", () => {
  test(".logger() creates child with extended namespace", () => {
    const parent = createLogger("app", [{ level: "trace" }, console])
    const child = parent.logger("import")

    expect(child.name).toBe("app:import")
  })

  test(".logger() inherits parent props", () => {
    const parent = createLogger("app", [{ level: "trace" }, console])
    const withProps = parent.child({ version: "1.0" })
    const child = withProps.logger("import")

    expect(child.props).toEqual({ version: "1.0" })
  })

  test(".logger() merges additional props", () => {
    const parent = createLogger("app", [{ level: "trace" }, console])
    const withProps = parent.child({ version: "1.0" })
    const child = withProps.logger("import", { file: "data.csv" })

    expect(child.props).toEqual({ version: "1.0", file: "data.csv" })
  })

  test(".logger() without namespace keeps same name", () => {
    const parent = createLogger("app", [{ level: "trace" }, console])
    const child = parent.logger(undefined, { extra: true })

    expect(child.name).toBe("app")
  })

  test(".child() is deprecated alias for .logger()", () => {
    const parent = createLogger("app", [{ level: "trace" }, console])
    const child = parent.child("import")

    expect(child.name).toBe("app:import")
  })
})

describe("spans", () => {
  test(".span() creates logger with spanData", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const span = log.span!("import")

    expect(span.spanData).not.toBeNull()
    expect(span.spanData!.id).toBe("sp_1")
    expect(span.spanData!.traceId).toBe("tr_1")
  })

  test("span extends namespace", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const span = log.span!("import")

    expect(span.name).toBe("app:import")
  })

  test("span inherits props", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const withProps = log.child({ version: "1.0" })
    const span = withProps.span!("import", { file: "data.csv" })

    expect(span.props).toEqual({ version: "1.0", file: "data.csv" })
  })

  test("span has live duration", () => {
    const log = createLogger("app", [{ level: "trace" }, console])
    const span = log.span!("import")

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
    const log = createLogger("app", [{ level: "trace" }, console])
    const span = log.span!("import")

    span.spanData.count = 42
    span.spanData.name = "test"

    expect(span.spanData.count).toBe(42)
    expect(span.spanData.name).toBe("test")

    span.end()
  })

  test("using keyword auto-disposes span", () => {
    process.env.TRACE = "1"
    const log = createLogger("app", [{ level: "trace" }, console])

    {
      using span = log.span!("import")
      span.spanData.count = 42
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("app:import")
  })

  test("nested spans have parent-child relationship", () => {
    const log = createLogger("app", [{ level: "trace" }, console])

    const parent = log.span!("import")
    const child = parent.span!("parse")

    expect(child.spanData!.parentId).toBe(parent.spanData!.id)
    expect(child.spanData!.traceId).toBe(parent.spanData!.traceId)

    child.end()
    parent.end()
  })

  test("nested spans share trace ID", () => {
    const log = createLogger("app", [{ level: "trace" }, console])

    const span1 = log.span!("import")
    const span2 = span1.span!("parse")
    const span3 = span2.span!("validate")

    expect(span1.spanData!.traceId).toBe("tr_1")
    expect(span2.spanData!.traceId).toBe("tr_1")
    expect(span3.spanData!.traceId).toBe("tr_1")

    span3.end()
    span2.end()
    span1.end()
  })

  test(".end() can be called manually", () => {
    process.env.TRACE = "1"
    const log = createLogger("app", [{ level: "trace" }, console])
    const span = log.span!("import")

    span.end()

    expect(span.spanData!.endTime).not.toBeNull()
    expect(span.spanData!.duration).toBeGreaterThanOrEqual(0)
  })

  test("span output includes attributes", () => {
    process.env.TRACE = "1"
    const log = createLogger("app", [{ level: "trace" }, console])

    {
      using span = log.span!("import", { file: "data.csv" })
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
    // Default pipeline reads TRACE env — unset means spans disabled
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("app")

    {
      using span = log.span!("import")
      span.info!("working")
    }

    // Only the info log, no span
    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).not.toContain("SPAN")
  })

  test("TRACE=1 enables span output", () => {
    process.env.TRACE = "1"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("app")

    {
      using span = log.span!("import")
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("clearing TRACE disables span output", () => {
    // TRACE is not set (cleared in beforeEach), so spans should not appear
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("app")

    {
      using span = log.span!("import")
    }

    expect(consoleMock.findSpan()).toBeUndefined()
  })
})

describe("console method usage (patchConsole compatibility)", () => {
  test("span output uses process.stderr.write (bypasses Ink patchConsole)", () => {
    process.env.TRACE = "1"
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("work")
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput!.level).toBe("stderr") // Spans bypass console, go directly to stderr
  })
})

describe("createLogger", () => {
  // Test enabled/disabled levels with parameterized tests
  test.each([
    [
      "trace",
      { trace: true, debug: true, info: true, warn: true, error: true },
    ],
    [
      "debug",
      { trace: false, debug: true, info: true, warn: true, error: true },
    ],
    [
      "warn",
      { trace: false, debug: false, info: false, warn: true, error: true },
    ],
    [
      "error",
      { trace: false, debug: false, info: false, warn: false, error: true },
    ],
  ] as const)("at level %s, methods defined: %o", (level, expected) => {
    const log = createLogger("test", [{ level }, console])

    expect(log.trace !== undefined).toBe(expected.trace)
    expect(log.debug !== undefined).toBe(expected.debug)
    expect(log.info !== undefined).toBe(expected.info)
    expect(log.warn !== undefined).toBe(expected.warn)
    expect(log.error !== undefined).toBe(expected.error)
  })

  test("optional chaining skips call when disabled", () => {
    const log = createLogger("test", [{ level: "error" }, console])

    log.debug?.("should not log")
    log.info?.("should not log")
    log.warn?.("should not log")

    expect(consoleMock.output).toHaveLength(0)
  })

  test("optional chaining calls method when enabled", () => {
    const log = createLogger("test", [{ level: "debug" }, console])

    log.debug?.("should log")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("should log")
  })

  test("inherits props from child logger", () => {
    const log = createLogger("test", [{ level: "info" }, console])
    const child = log.child({ version: "1.0" })

    expect(child.props).toEqual({ version: "1.0" })
  })

  test("can create child loggers and spans", () => {
    const log = createLogger("test", [{ level: "info" }, console])

    const child = log.logger("child")
    expect(child.name).toBe("test:child")

    const span = log.span!("work")
    expect(span.spanData).not.toBeNull()
    span.end()
  })
})

describe("createLogger with props object", () => {
  test("creates logger with props (backwards compat)", () => {
    const log = createLogger("test", { service: "api", version: "1.0" })
    log.info?.("hello")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("hello")
    // Props should be on the logger
    expect(log.props).toEqual({ service: "api", version: "1.0" })
  })

  test("props appear in output", () => {
    const log = createLogger("test", { service: "api" })
    log.info?.("msg")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("service")
    expect(consoleMock.output[0]!.message).toContain("api")
  })

  test("props appear in JSON format output", () => {
    process.env.LOG_FORMAT = "json"
    const log = createLogger("test", { service: "api", version: "1.0" })
    log.info?.("hello")

    const parsed = JSON.parse(consoleMock.output[0]!.message) as Record<
      string,
      unknown
    >
    expect(parsed.service).toBe("api")
    expect(parsed.version).toBe("1.0")
    expect(parsed.msg).toBe("hello")
  })
})

describe("JSON format output", () => {
  test("format: json produces JSON output", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

    log.info!("test message", { key: "value" })

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.level).toBe("info")
    expect(parsed.name).toBe("test")
    expect(parsed.msg).toBe("test message")
    expect(parsed.key).toBe("value")
    expect(parsed.time).toBeDefined()
  })

  test("TRACE_FORMAT=json produces JSON output", () => {
    process.env.TRACE_FORMAT = "json"
    const log = createLogger("test", [{ level: "trace" }, console])

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
    const log = createLogger("test", [{ level: "trace" }, console])

    log.info!("prod message")

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("prod message")
  })

  test("JSON output includes all props", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const child = log.child({ app: "myapp", version: "1.0" })

    child.info!("message")

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.app).toBe("myapp")
    expect(parsed.version).toBe("1.0")
  })

  test("JSON output handles errors", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const err = new Error("test error")

    log.error!(err)

    const output = consoleMock.output[0]!.message
    const parsed = JSON.parse(output) as Record<string, unknown>
    expect(parsed.msg).toBe("test error")
    expect(parsed.error_type).toBe("Error")
    expect(parsed.error_stack).toContain("Error: test error")
  })

  test("JSON span output includes duration", () => {
    process.env.TRACE = "1"
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

    {
      using span = log.span!("work")
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
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

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
    const log = createLogger("test", [{ level: "trace" }, console])
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
    const log = createLogger("test", [{ level: "trace" }, console])
    log[method]!("msg")

    expect(consoleMock.output[0]!.message).toContain(label)
  })

  test("includes namespace", () => {
    const log = createLogger("myapp", [{ level: "trace" }, console])
    log.info!("message")

    expect(consoleMock.output[0]!.message).toContain("myapp")
  })

  test("span format includes SPAN label and duration", () => {
    process.env.TRACE = "1"
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("work")
    }

    const spanOutput = consoleMock.findSpan()
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toMatch(/\(\d+ms\)/)
  })
})

describe("TRACE namespace filtering", () => {
  test("TRACE=namespace enables spans and filtering", () => {
    process.env.TRACE = "myapp"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("myapp")

    {
      using span = log.span!("work")
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("filter allows exact namespace match", () => {
    process.env.TRACE = "myapp"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("myapp")

    {
      using span = log.span!("work")
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("filter allows child namespace match", () => {
    process.env.TRACE = "myapp"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("myapp")

    {
      using span = log.span!("import") // myapp:import
    }

    expect(consoleMock.findSpan()).toBeDefined()
  })

  test("filter blocks non-matching namespace", () => {
    process.env.TRACE = "myapp"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("other")

    {
      using span = log.span!("work")
    }

    expect(consoleMock.findSpan()).toBeUndefined()
  })

  test("filter supports multiple namespaces", () => {
    process.env.TRACE = "myapp,other"
    process.env.LOG_LEVEL = "trace"

    const log1 = createLogger("myapp")
    const log2 = createLogger("other")
    const log3 = createLogger("blocked")

    {
      using span = log1.span!("work")
    }
    {
      using span = log2.span!("work")
    }
    {
      using span = log3.span!("work")
    }

    const spanOutputs = consoleMock.findSpans()
    expect(spanOutputs).toHaveLength(2)
    expect(spanOutputs[0]!.message).toContain("myapp")
    expect(spanOutputs[1]!.message).toContain("other")
  })

  test("filter does not affect regular log messages", () => {
    process.env.TRACE = "myapp"
    process.env.LOG_LEVEL = "trace"
    const log = createLogger("other") // Not in TRACE filter

    log.info!("regular log")

    // Regular logs still appear
    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("regular log")
  })

  test("no filter when TRACE=1 (all spans enabled)", () => {
    process.env.TRACE = "1"
    process.env.LOG_LEVEL = "trace"

    const log1 = createLogger("any")
    const log2 = createLogger("namespace")

    {
      using span = log1.span!("work")
    }
    {
      using span = log2.span!("work")
    }

    // Both should appear
    expect(consoleMock.findSpans()).toHaveLength(2)
  })
})

describe("DEBUG namespace filtering", () => {
  test("DEBUG env var enables namespace filtering", () => {
    process.env.DEBUG = "myapp"
    const log = createLogger("myapp")
    log.info!("visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("visible")
  })

  test("filter allows exact namespace match", () => {
    process.env.DEBUG = "myapp"
    const log = createLogger("myapp")
    log.info!("visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("visible")
  })

  test("filter allows child namespace match", () => {
    process.env.DEBUG = "myapp"
    const log = createLogger("myapp")
    const child = log.logger("db")
    child.info!("visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("visible")
  })

  test("filter blocks non-matching namespace", () => {
    process.env.DEBUG = "myapp"
    const log = createLogger("other")
    log.info!("hidden")

    expect(consoleMock.output).toHaveLength(0)
  })

  test("filter supports multiple namespaces", () => {
    process.env.DEBUG = "myapp,other"

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
    process.env.DEBUG = "*"

    const log1 = createLogger("any")
    const log2 = createLogger("namespace")

    log1.info!("msg1")
    log2.info!("msg2")

    expect(consoleMock.output).toHaveLength(2)
  })

  test("negative pattern excludes matching namespace", () => {
    process.env.DEBUG = "myapp,-myapp:noisy"

    const log = createLogger("myapp")
    const quiet = log.logger("db")
    const noisy = log.logger("noisy")

    log.info!("root")
    quiet.info!("db msg")
    noisy.info!("noisy msg")

    expect(consoleMock.output).toHaveLength(2)
    expect(consoleMock.output[0]!.message).toContain("root")
    expect(consoleMock.output[1]!.message).toContain("db msg")
  })

  test("negative pattern excludes children of excluded namespace", () => {
    process.env.DEBUG = "*,-km:storage:sql"

    const log = createLogger("km")
    const storage = log.logger("storage")
    const sql = storage.logger("sql")
    const sqlChild = sql.logger("detail")

    log.info!("visible")
    storage.info!("visible")
    sql.info!("hidden")
    sqlChild.info!("also hidden")

    expect(consoleMock.output).toHaveLength(2)
  })

  test("exclude-only pattern (no includes) blocks only excluded", () => {
    process.env.DEBUG = "-km:noisy"

    const log1 = createLogger("km")
    const log2 = createLogger("km").logger("noisy")
    const log3 = createLogger("other")

    log1.info!("visible")
    log2.info!("hidden")
    log3.info!("visible")

    expect(consoleMock.output).toHaveLength(2)
    expect(consoleMock.output[0]!.message).toContain("km")
    expect(consoleMock.output[1]!.message).toContain("other")
  })

  test("DEBUG auto-lowers log level to debug", () => {
    process.env.DEBUG = "myapp"
    const log = createLogger("myapp")

    // Without DEBUG, default level is info, so debug would be hidden.
    // With DEBUG set, level auto-lowers to debug.
    log.debug?.("debug visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("debug visible")
  })

  test("debug messages visible when filter matches", () => {
    process.env.DEBUG = "myapp"

    const log = createLogger("myapp")
    log.debug?.("debug visible")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("debug visible")
  })

  test("filter also applies to spans", () => {
    process.env.TRACE = "1"
    process.env.DEBUG = "myapp"

    const log1 = createLogger("myapp")
    const log2 = createLogger("other")

    {
      using span = log1.span!("work")
    }
    {
      using span = log2.span!("work")
    }

    const spans = consoleMock.findSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.message).toContain("myapp")
  })
})

describe("ns config in pipeline", () => {
  test("ns in config array filters namespaces", () => {
    const log = createLogger("myapp", [
      { level: "trace", ns: "myapp" },
      console,
    ])
    log.info!("visible")

    const other = createLogger("other", [
      { level: "trace", ns: "myapp" },
      console,
    ])
    other.info!("hidden")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("myapp")
  })

  test("ns with negative pattern in config array", () => {
    const log = createLogger("myapp", [
      { level: "trace", ns: "myapp,-myapp:noisy" },
      console,
    ])
    const noisy = log.logger("noisy")

    log.info!("visible")
    noisy.info!("hidden")

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("myapp")
    expect(consoleMock.output[0]!.message).not.toContain("noisy")
  })
})

describe("output routing", () => {
  test("process.stderr in config routes output to stderr", () => {
    const log = createLogger("test", [{ level: "trace" }, process.stderr])
    log.info?.("hello")

    const stderrOutput = consoleMock.output.filter((o) => o.level === "stderr")
    expect(stderrOutput).toHaveLength(1)
    expect(stderrOutput[0]!.message).toContain("hello")

    // Should NOT appear in console output
    const consoleOutput = consoleMock.output.filter((o) => o.level === "info")
    expect(consoleOutput).toHaveLength(0)
  })

  test("omitting console from config suppresses all direct output", () => {
    const log = createLogger("test", [{ level: "trace" }])
    log.info?.("hello")

    // No console or stderr output
    expect(consoleMock.output).toHaveLength(0)
  })

  test("console in config uses console methods", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    log.info?.("hello")

    const consoleOutput = consoleMock.output.filter((o) => o.level === "info")
    expect(consoleOutput).toHaveLength(1)
  })
})

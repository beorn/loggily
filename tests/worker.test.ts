/**
 * Worker Console Forwarding Tests
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  forwardConsole,
  restoreConsole,
  createWorkerConsoleHandler,
  createWorkerLogger,
  createWorkerLogHandler,
  resetWorkerIds,
  isWorkerConsoleMessage,
  isWorkerLogMessage,
  isWorkerSpanMessage,
  isWorkerMessage,
  type WorkerConsoleMessage,
  type WorkerLogMessage,
  type WorkerSpanMessage,
  type WorkerMessage,
} from "../src/worker.ts"
import { resetIds } from "../src/index.ts"

// Capture console output from main thread handler
let consoleOutput: { level: string; message: string }[] = []

// Save/restore env vars
let savedEnv: Record<string, string | undefined>

beforeEach(() => {
  consoleOutput = []
  resetIds()
  savedEnv = {
    TRACE: process.env.TRACE,
    LOG_LEVEL: process.env.LOG_LEVEL,
    DEBUG: process.env.DEBUG,
    LOG_FORMAT: process.env.LOG_FORMAT,
  }
  delete process.env.TRACE
  process.env.LOG_LEVEL = "trace"

  // Mock console methods for main thread
  vi.spyOn(console, "log").mockImplementation((msg) => {
    consoleOutput.push({ level: "log", message: String(msg) })
  })
  vi.spyOn(console, "debug").mockImplementation((msg) => {
    consoleOutput.push({ level: "debug", message: String(msg) })
  })
  vi.spyOn(console, "info").mockImplementation((msg) => {
    consoleOutput.push({ level: "info", message: String(msg) })
  })
  vi.spyOn(console, "warn").mockImplementation((msg) => {
    consoleOutput.push({ level: "warn", message: String(msg) })
  })
  vi.spyOn(console, "error").mockImplementation((msg) => {
    consoleOutput.push({ level: "error", message: String(msg) })
  })
  vi.spyOn(console, "trace").mockImplementation((msg) => {
    consoleOutput.push({ level: "trace", message: String(msg) })
  })

  // Spans use process.stderr.write to bypass Ink's patchConsole
  vi.spyOn(process.stderr, "write").mockImplementation(((chunk: string | Uint8Array) => {
    consoleOutput.push({ level: "stderr", message: String(chunk) })
    return true
  }) as typeof process.stderr.write)
})

afterEach(() => {
  vi.restoreAllMocks()
  restoreConsole()
  // Restore env
  for (const [key, val] of Object.entries(savedEnv)) {
    if (val === undefined) {
      delete process.env[key]
    } else {
      process.env[key] = val
    }
  }
})

describe("isWorkerConsoleMessage", () => {
  test("returns true for valid message", () => {
    const msg: WorkerConsoleMessage = {
      type: "console",
      level: "log",
      args: ["test"],
      timestamp: Date.now(),
    }
    expect(isWorkerConsoleMessage(msg)).toBe(true)
  })

  test("returns false for invalid messages", () => {
    expect(isWorkerConsoleMessage(null)).toBe(false)
    expect(isWorkerConsoleMessage(undefined)).toBe(false)
    expect(isWorkerConsoleMessage({})).toBe(false)
    expect(isWorkerConsoleMessage({ type: "other" })).toBe(false)
    expect(isWorkerConsoleMessage({ type: "console" })).toBe(false)
    expect(isWorkerConsoleMessage({ type: "console", level: "log" })).toBe(false)
  })
})

describe("forwardConsole", () => {
  test("intercepts console.log", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)
    console.log("test message")

    expect(messages).toHaveLength(1)
    expect(messages[0]!.type).toBe("console")
    expect(messages[0]!.level).toBe("log")
    expect(messages[0]!.args).toEqual(["test message"])
  })

  test("intercepts all console levels", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)

    console.log("log")
    console.debug("debug")
    console.info("info")
    console.warn("warn")
    console.error("error")
    console.trace("trace")

    expect(messages).toHaveLength(6)
    expect(messages.map((m) => m.level)).toEqual(["log", "debug", "info", "warn", "error", "trace"])
  })

  test("includes namespace if provided", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage, "km:worker:test")
    console.log("message")

    expect(messages[0]!.namespace).toBe("km:worker:test")
  })

  test("serializes multiple arguments", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)
    console.log("message", 123, { key: "value" })

    expect(messages[0]!.args).toEqual(["message", 123, { key: "value" }])
  })

  test("serializes Error objects", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)
    console.error(new Error("test error"))

    const serializedError = messages[0]!.args[0] as {
      name: string
      message: string
      stack: string
    }
    expect(serializedError.name).toBe("Error")
    expect(serializedError.message).toBe("test error")
    expect(serializedError.stack).toContain("Error: test error")
  })

  test("handles non-serializable values", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)
    console.log(function namedFn() {})
    console.log(Symbol("test"))

    expect(messages[0]!.args[0]).toBe("[Function: namedFn]")
    expect(messages[1]!.args[0]).toBe("Symbol(test)")
  })

  test("includes timestamp", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    const before = Date.now()
    forwardConsole(mockPostMessage)
    console.log("message")
    const after = Date.now()

    expect(messages[0]!.timestamp).toBeGreaterThanOrEqual(before)
    expect(messages[0]!.timestamp).toBeLessThanOrEqual(after)
  })
})

describe("restoreConsole", () => {
  test("restores original console methods", () => {
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage)
    console.log("forwarded")
    expect(messages).toHaveLength(1)

    restoreConsole()
    console.log("not forwarded")
    expect(messages).toHaveLength(1) // Still only 1
  })
})

describe("createWorkerConsoleHandler", () => {
  test("outputs log messages through logger", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "test" })

    handler({
      type: "console",
      level: "info",
      args: ["test message"],
      timestamp: Date.now(),
    })

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("test message")
  })

  test("respects message namespace over default", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "default" })

    handler({
      type: "console",
      level: "info",
      namespace: "specific",
      args: ["message"],
      timestamp: Date.now(),
    })

    expect(consoleOutput[0]!.message).toContain("specific")
  })

  test("maps console levels to logger levels", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "test" })

    handler({
      type: "console",
      level: "log",
      args: ["l"],
      timestamp: Date.now(),
    })
    handler({
      type: "console",
      level: "debug",
      args: ["d"],
      timestamp: Date.now(),
    })
    handler({
      type: "console",
      level: "info",
      args: ["i"],
      timestamp: Date.now(),
    })
    handler({
      type: "console",
      level: "warn",
      args: ["w"],
      timestamp: Date.now(),
    })
    handler({
      type: "console",
      level: "error",
      args: ["e"],
      timestamp: Date.now(),
    })

    expect(consoleOutput).toHaveLength(5)
    // log -> info, debug -> debug, info -> info, warn -> warn, error -> error
    expect(consoleOutput[0]!.level).toBe("info")
    expect(consoleOutput[1]!.level).toBe("debug")
    expect(consoleOutput[2]!.level).toBe("info")
    expect(consoleOutput[3]!.level).toBe("warn")
    expect(consoleOutput[4]!.level).toBe("error")
  })

  test("formats multiple args as message", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "test" })

    handler({
      type: "console",
      level: "info",
      args: ["value:", 42, { key: "val" }],
      timestamp: Date.now(),
    })

    expect(consoleOutput[0]!.message).toContain("value:")
    expect(consoleOutput[0]!.message).toContain("42")
    expect(consoleOutput[0]!.message).toContain("key")
  })
})

describe("end-to-end forwarding", () => {
  test("worker -> main thread flow", () => {
    // Simulate worker side
    const messages: WorkerConsoleMessage[] = []
    const mockPostMessage = (msg: WorkerConsoleMessage) => messages.push(msg)

    forwardConsole(mockPostMessage, "km:worker:test")
    console.log("worker message", { count: 42 })
    restoreConsole()

    // Simulate main thread side
    const handler = createWorkerConsoleHandler()
    handler(messages[0]!)

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("km:worker:test")
    expect(consoleOutput[0]!.message).toContain("worker message")
  })
})

// ============ Full Logger Tests ============

describe("type guards", () => {
  test("isWorkerLogMessage", () => {
    expect(
      isWorkerLogMessage({
        type: "log",
        level: "info",
        namespace: "test",
        message: "hi",
        timestamp: 1,
      }),
    ).toBe(true)
    expect(isWorkerLogMessage({ type: "console" })).toBe(false)
    expect(isWorkerLogMessage(null)).toBe(false)
  })

  test("isWorkerSpanMessage", () => {
    expect(isWorkerSpanMessage({ type: "span", event: "start" })).toBe(true)
    expect(isWorkerSpanMessage({ type: "span", event: "end" })).toBe(true)
    expect(isWorkerSpanMessage({ type: "log" })).toBe(false)
  })

  test("isWorkerMessage", () => {
    expect(
      isWorkerMessage({
        type: "console",
        level: "log",
        args: [],
        timestamp: 1,
      }),
    ).toBe(true)
    expect(
      isWorkerMessage({
        type: "log",
        level: "info",
        namespace: "test",
        message: "hi",
        timestamp: 1,
      }),
    ).toBe(true)
    expect(isWorkerMessage({ type: "span", event: "start" })).toBe(true)
    expect(isWorkerMessage({ type: "unknown" })).toBe(false)
  })
})

describe("createWorkerLogger", () => {
  beforeEach(() => {
    resetWorkerIds()
  })

  test("creates logger with namespace", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "km:worker:test")
    expect(log.name).toBe("km:worker:test")
  })

  test("sends log messages", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")
    log.info("hello world", { key: "value" })

    expect(messages).toHaveLength(1)
    const msg = messages[0] as WorkerLogMessage
    expect(msg.type).toBe("log")
    expect(msg.level).toBe("info")
    expect(msg.namespace).toBe("test")
    expect(msg.message).toBe("hello world")
    expect(msg.data).toEqual({ key: "value" })
  })

  test("sends all log levels", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")
    log.trace("t")
    log.debug("d")
    log.info("i")
    log.warn("w")
    log.error("e")

    expect(messages).toHaveLength(5)
    expect((messages[0] as WorkerLogMessage).level).toBe("trace")
    expect((messages[1] as WorkerLogMessage).level).toBe("debug")
    expect((messages[2] as WorkerLogMessage).level).toBe("info")
    expect((messages[3] as WorkerLogMessage).level).toBe("warn")
    expect((messages[4] as WorkerLogMessage).level).toBe("error")
  })

  test("handles Error objects", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")
    log.error(new Error("test error"))

    const msg = messages[0] as WorkerLogMessage
    expect(msg.message).toBe("test error")
    expect(msg.data?.error_type).toBe("Error")
    expect(msg.data?.error_stack).toContain("Error: test error")
  })

  test("creates child loggers", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "parent", {
      version: "1.0",
    })
    const child = log.logger("child", { extra: true })

    expect(child.name).toBe("parent:child")
    expect(child.props).toEqual({ version: "1.0", extra: true })
  })
})

describe("createWorkerLogger spans", () => {
  beforeEach(() => {
    resetWorkerIds()
  })

  test("sends span start and end events", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using span = log.span("work")
      span.spanData.count = 42
    }

    // Should have start and end events
    const spanMessages = messages.filter((m) => m.type === "span") as WorkerSpanMessage[]
    expect(spanMessages).toHaveLength(2)

    const start = spanMessages.find((m) => m.event === "start")!
    const end = spanMessages.find((m) => m.event === "end")!

    expect(start.namespace).toBe("test:work")
    expect(start.spanId).toBe("wsp_1")
    expect(start.traceId).toBe("wtr_1")

    expect(end.namespace).toBe("test:work")
    expect(end.spanId).toBe("wsp_1")
    expect(end.spanData.count).toBe(42)
    expect(end.duration).toBeGreaterThanOrEqual(0)
  })

  test("nested spans share trace ID", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using outer = log.span("outer")
      {
        using inner = outer.span("inner")
        inner.info("inside")
      }
    }

    const spanMessages = messages.filter((m) => m.type === "span") as WorkerSpanMessage[]
    const outerStart = spanMessages.find((m) => m.namespace === "test:outer" && m.event === "start")!
    const innerStart = spanMessages.find((m) => m.namespace === "test:outer:inner" && m.event === "start")!

    // Both should share the same trace ID
    expect(innerStart.traceId).toBe(outerStart.traceId)
    // Inner should have outer as parent
    expect(innerStart.parentId).toBe(outerStart.spanId)
  })

  test("span can log messages", () => {
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using span = log.span("work")
      span.info("processing")
      span.debug("details")
    }

    const logMessages = messages.filter((m) => m.type === "log") as WorkerLogMessage[]
    expect(logMessages).toHaveLength(2)
    expect(logMessages[0]!.namespace).toBe("test:work")
    expect(logMessages[0]!.message).toBe("processing")
  })
})

describe("createWorkerLogHandler", () => {
  test("handles log messages", () => {
    const handler = createWorkerLogHandler()

    handler({
      type: "log",
      level: "info",
      namespace: "test",
      message: "hello",
      data: { key: "value" },
      timestamp: Date.now(),
    })

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("test")
    expect(consoleOutput[0]!.message).toContain("hello")
  })

  test("handles span end events", () => {
    process.env.TRACE = "1"
    const handler = createWorkerLogHandler()

    handler({
      type: "span",
      event: "end",
      namespace: "test:work",
      spanId: "wsp_1",
      traceId: "wtr_1",
      parentId: null,
      startTime: Date.now() - 100,
      endTime: Date.now(),
      duration: 100,
      props: {},
      spanData: { count: 42 },
      timestamp: Date.now(),
    })

    // Should have span output
    const spanOutput = consoleOutput.find((o) => o.message.includes("SPAN"))
    expect(spanOutput).toBeDefined()
  })

  test("handles console messages", () => {
    const handler = createWorkerLogHandler()

    handler({
      type: "console",
      level: "info",
      namespace: "test",
      args: ["console message"],
      timestamp: Date.now(),
    })

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("console message")
  })
})

describe("full logger end-to-end", () => {
  beforeEach(() => {
    resetWorkerIds()
  })

  test("worker logger -> main handler flow", () => {
    process.env.TRACE = "1"
    const messages: WorkerMessage[] = []
    const mockPostMessage = (msg: WorkerMessage) => messages.push(msg)

    // Worker side
    const log = createWorkerLogger(mockPostMessage, "km:worker:test")
    log.info("starting work")
    {
      using span = log.span("process")
      span.info("processing...")
      span.spanData.items = 5
    }
    log.info("done")

    // Main thread side
    const handler = createWorkerLogHandler()
    for (const msg of messages) {
      handler(msg)
    }

    // Should have log outputs and span output
    expect(consoleOutput.length).toBeGreaterThanOrEqual(4) // 3 logs + 1 span
    expect(consoleOutput.some((o) => o.message.includes("starting work"))).toBe(true)
    expect(consoleOutput.some((o) => o.message.includes("processing"))).toBe(true)
    expect(consoleOutput.some((o) => o.message.includes("done"))).toBe(true)
  })
})

// ============ Bug Fix Tests ============

describe("bug: worker span forwarding preserves worker data", () => {
  test("span end event preserves worker spanData as props", () => {
    process.env.TRACE = "1"
    const handler = createWorkerLogHandler()

    handler({
      type: "span",
      event: "end",
      namespace: "test:work",
      spanId: "wsp_original",
      traceId: "wtr_original",
      parentId: "wsp_parent",
      startTime: 1000,
      endTime: 1100,
      duration: 100,
      props: {},
      spanData: { count: 42 },
      timestamp: Date.now(),
    })

    // The span output should contain the worker's custom data as props
    const spanOutput = consoleOutput.find((o) => o.message.includes("SPAN"))
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("count")
    expect(spanOutput!.message).toContain("42")
  })

  test("span end event produces a span on main thread", () => {
    process.env.TRACE = "1"
    const handler = createWorkerLogHandler()

    // Send a span with a known duration of 500ms
    handler({
      type: "span",
      event: "end",
      namespace: "test:work",
      spanId: "wsp_1",
      traceId: "wtr_1",
      parentId: null,
      startTime: 1000,
      endTime: 1500,
      duration: 500,
      props: {},
      spanData: {},
      timestamp: Date.now(),
    })

    // In v2, the handler creates a new span on the main thread, so it will have
    // its own timing. Verify the span output exists.
    const spanOutput = consoleOutput.find((o) => o.message.includes("SPAN"))
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("test:work")
  })
})

describe("bug: postMessage error handling sends diagnostic fallback", () => {
  beforeEach(() => {
    resetWorkerIds()
  })

  test("log postMessage failure sends diagnostic fallback", () => {
    const messages: WorkerMessage[] = []
    let callCount = 0
    const failingPostMessage = (msg: WorkerMessage) => {
      callCount++
      if (callCount === 1) {
        throw new DOMException("Failed to execute 'postMessage': could not be cloned")
      }
      messages.push(msg)
    }

    const log = createWorkerLogger(failingPostMessage, "test")
    log.info("message with uncloneable data", { fn: () => {} })

    // Should have sent a diagnostic fallback message instead of silently dropping
    expect(messages.length).toBeGreaterThanOrEqual(1)
    const fallback = messages[0]!
    expect(fallback.type).toBe("log")
    expect((fallback as WorkerLogMessage).level).toBe("error")
    expect((fallback as WorkerLogMessage).message).toContain("postMessage")
  })

  test("span start postMessage failure sends diagnostic fallback", () => {
    const messages: WorkerMessage[] = []
    let callCount = 0
    const failingPostMessage = (msg: WorkerMessage) => {
      callCount++
      if (callCount === 1) {
        // First call is span start — make it fail
        throw new DOMException("Failed to execute 'postMessage': could not be cloned")
      }
      messages.push(msg)
    }

    const log = createWorkerLogger(failingPostMessage, "test")
    const span = log.span("work", { uncloneable: () => {} })
    span.end()

    // Should have a diagnostic fallback for the failed span start
    expect(messages.some((m) => m.type === "log" && (m as WorkerLogMessage).message.includes("postMessage"))).toBe(true)
  })

  test("span end postMessage failure sends diagnostic fallback", () => {
    const messages: WorkerMessage[] = []
    let callCount = 0
    const failingPostMessage = (msg: WorkerMessage) => {
      callCount++
      // Let span start succeed (call 1), fail on span end (call 2)
      if (callCount === 2) {
        throw new DOMException("Failed to execute 'postMessage': could not be cloned")
      }
      messages.push(msg)
    }

    const log = createWorkerLogger(failingPostMessage, "test")
    const span = log.span("work")
    span.spanData.circular = {} as Record<string, unknown>
    ;(span.spanData.circular as Record<string, unknown>).self = span.spanData.circular
    span.end()

    // Should have a diagnostic fallback for the failed span end
    const diagnostics = messages.filter(
      (m) => m.type === "log" && (m as WorkerLogMessage).message.includes("postMessage"),
    )
    expect(diagnostics.length).toBeGreaterThanOrEqual(1)
  })
})

describe("bug: console handler handles circular/bigint without throwing", () => {
  test("createWorkerConsoleHandler handles BigInt args", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "test" })

    // Should not throw when args contain BigInt (JSON.stringify throws on BigInt)
    expect(() => {
      handler({
        type: "console",
        level: "info",
        args: ["value:", BigInt(42)],
        timestamp: Date.now(),
      })
    }).not.toThrow()

    expect(consoleOutput).toHaveLength(1)
  })

  test("createWorkerConsoleHandler handles circular refs in args", () => {
    const handler = createWorkerConsoleHandler({ defaultNamespace: "test" })
    const circular: Record<string, unknown> = { name: "test" }
    circular.self = circular

    expect(() => {
      handler({
        type: "console",
        level: "info",
        args: ["obj:", circular],
        timestamp: Date.now(),
      })
    }).not.toThrow()

    expect(consoleOutput).toHaveLength(1)
  })

  test("createWorkerLogHandler handles BigInt in console args", () => {
    const handler = createWorkerLogHandler()

    expect(() => {
      handler({
        type: "console",
        level: "info",
        namespace: "test",
        args: ["bigint:", BigInt(999)],
        timestamp: Date.now(),
      })
    }).not.toThrow()

    expect(consoleOutput).toHaveLength(1)
  })

  test("createWorkerLogHandler handles circular refs in console args", () => {
    const handler = createWorkerLogHandler()
    const circular: Record<string, unknown> = { data: 1 }
    circular.ref = circular

    expect(() => {
      handler({
        type: "console",
        level: "info",
        namespace: "test",
        args: ["circular:", circular],
        timestamp: Date.now(),
      })
    }).not.toThrow()

    expect(consoleOutput).toHaveLength(1)
  })
})

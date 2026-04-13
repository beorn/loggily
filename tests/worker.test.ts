/**
 * Worker Logger/Console Forwarding Tests
 *
 * Tests the pipeline-based worker logging: withWorkerTransport, createWorkerLogger,
 * handleWorkerEvents, createWorkerLogHandler, and console forwarding.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  forwardConsole,
  restoreConsole,
  createWorkerConsoleHandler,
  createWorkerLogger,
  createWorkerLogHandler,
  handleWorkerEvents,
  workerTransportStage,
  isWorkerConsoleMessage,
  isWorkerLogEvent,
  isWorkerSpanEvent,
  isWorkerEvent,
  isWorkerMessage,
  type WorkerConsoleMessage,
} from "../src/worker.ts"
import { resetIds, baseCreateLogger, pipe, withSpans } from "../src/index.ts"
import type { Event, LogEvent, SpanEvent } from "../src/pipeline.ts"

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
  vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
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

// ============ Type Guards ============

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
    expect(isWorkerConsoleMessage({ type: "console", level: "log" })).toBe(
      false,
    )
  })
})

describe("isWorkerLogEvent", () => {
  test("returns true for LogEvent", () => {
    const event: LogEvent = {
      kind: "log",
      time: Date.now(),
      namespace: "test",
      level: "info",
      message: "hello",
    }
    expect(isWorkerLogEvent(event)).toBe(true)
  })

  test("returns false for non-log events", () => {
    expect(isWorkerLogEvent(null)).toBe(false)
    expect(isWorkerLogEvent({})).toBe(false)
    expect(isWorkerLogEvent({ kind: "span" })).toBe(false)
    expect(isWorkerLogEvent({ type: "log" })).toBe(false)
  })
})

describe("isWorkerSpanEvent", () => {
  test("returns true for SpanEvent", () => {
    const event: SpanEvent = {
      kind: "span",
      time: Date.now(),
      namespace: "test",
      name: "test",
      duration: 100,
      spanId: "sp_1",
      traceId: "tr_1",
      parentId: null,
    }
    expect(isWorkerSpanEvent(event)).toBe(true)
  })

  test("returns false for non-span events", () => {
    expect(isWorkerSpanEvent(null)).toBe(false)
    expect(isWorkerSpanEvent({})).toBe(false)
    expect(isWorkerSpanEvent({ kind: "log" })).toBe(false)
  })
})

describe("isWorkerEvent", () => {
  test("returns true for log and span events", () => {
    expect(
      isWorkerEvent({
        kind: "log",
        time: 1,
        namespace: "t",
        level: "info",
        message: "m",
      }),
    ).toBe(true)
    expect(
      isWorkerEvent({
        kind: "span",
        time: 1,
        namespace: "t",
        name: "t",
        duration: 1,
        spanId: "s",
        traceId: "t",
        parentId: null,
      }),
    ).toBe(true)
  })

  test("returns false for non-events", () => {
    expect(isWorkerEvent(null)).toBe(false)
    expect(isWorkerEvent({ type: "console" })).toBe(false)
  })
})

describe("isWorkerMessage", () => {
  test("returns true for console messages and events", () => {
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
        kind: "log",
        time: 1,
        namespace: "t",
        level: "info",
        message: "m",
      }),
    ).toBe(true)
    expect(
      isWorkerMessage({
        kind: "span",
        time: 1,
        namespace: "t",
        name: "t",
        duration: 1,
        spanId: "s",
        traceId: "t",
        parentId: null,
      }),
    ).toBe(true)
  })

  test("returns false for unknown messages", () => {
    expect(isWorkerMessage({ type: "unknown" })).toBe(false)
    expect(isWorkerMessage(null)).toBe(false)
  })
})

// ============ Console Forwarding ============

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
    expect(messages.map((m) => m.level)).toEqual([
      "log",
      "debug",
      "info",
      "warn",
      "error",
      "trace",
    ])
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

// ============ Console Handler ============

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

// ============ Console End-to-End ============

describe("console end-to-end forwarding", () => {
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

// ============ workerTransportStage ============

describe("workerTransportStage", () => {
  test("posts events via postMessage", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const transport = workerTransportStage(mockPostMessage)
    const factory = pipe(baseCreateLogger, withSpans())
    const log = factory("test", [{ level: "trace" }, transport])
    log.info?.("hello world")

    // Should have posted a LogEvent
    expect(posted.length).toBeGreaterThanOrEqual(1)
    const event = posted[0] as LogEvent
    expect(event.kind).toBe("log")
    expect(event.level).toBe("info")
    expect(event.namespace).toBe("test")
    expect(event.message).toBe("hello world")
  })

  test("handles postMessage failure with JSON fallback", () => {
    const posted: unknown[] = []
    let callCount = 0
    const failingPostMessage = (msg: unknown) => {
      callCount++
      if (callCount === 1) {
        throw new DOMException(
          "Failed to execute 'postMessage': could not be cloned",
        )
      }
      posted.push(msg)
    }

    const transport = workerTransportStage(failingPostMessage)
    const factory = pipe(baseCreateLogger, withSpans())
    const log = factory("test", [{ level: "trace" }, transport])
    log.info?.("test message")

    // Should have fallen back to JSON serialization
    expect(posted.length).toBeGreaterThanOrEqual(1)
    const event = posted[0] as LogEvent
    expect(event.kind).toBe("log")
    expect(event.message).toBe("test message")
  })

  test("silently drops if both postMessage and JSON fail", () => {
    const failingPostMessage = (_msg: unknown) => {
      throw new Error("always fails")
    }

    const transport = workerTransportStage(failingPostMessage)
    const factory = pipe(baseCreateLogger, withSpans())
    const log = factory("test", [{ level: "trace" }, transport])

    // Should not throw
    expect(() => log.info?.("test")).not.toThrow()
  })
})

// ============ createWorkerLogger ============

describe("createWorkerLogger", () => {
  test("creates logger that posts events", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "km:worker:test")
    log.info?.("hello world", { key: "value" })

    expect(posted.length).toBeGreaterThanOrEqual(1)
    const event = posted[0] as LogEvent
    expect(event.kind).toBe("log")
    expect(event.level).toBe("info")
    expect(event.namespace).toBe("km:worker:test")
    expect(event.message).toBe("hello world")
    expect(event.props).toEqual(expect.objectContaining({ key: "value" }))
  })

  test("posts all log levels", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")
    log.trace?.("t")
    log.debug?.("d")
    log.info?.("i")
    log.warn?.("w")
    log.error?.("e")

    const logEvents = posted.filter(
      (e) => (e as Event).kind === "log",
    ) as LogEvent[]
    expect(logEvents).toHaveLength(5)
    expect(logEvents[0]!.level).toBe("trace")
    expect(logEvents[1]!.level).toBe("debug")
    expect(logEvents[2]!.level).toBe("info")
    expect(logEvents[3]!.level).toBe("warn")
    expect(logEvents[4]!.level).toBe("error")
  })

  test("handles Error objects", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")
    log.error?.(new Error("test error"))

    const logEvents = posted.filter(
      (e) => (e as Event).kind === "log",
    ) as LogEvent[]
    expect(logEvents.length).toBeGreaterThanOrEqual(1)
    const event = logEvents[0]!
    expect(event.message).toBe("test error")
    expect(event.props?.error_type).toBe("Error")
    expect(event.props?.error_stack).toContain("Error: test error")
  })

  test("creates child loggers that also post via postMessage", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "parent")
    const child = log.child("child")
    child.info?.("from child")

    const logEvents = posted.filter(
      (e) => (e as Event).kind === "log",
    ) as LogEvent[]
    expect(logEvents.length).toBeGreaterThanOrEqual(1)
    const event = logEvents[0]!
    expect(event.namespace).toBe("parent:child")
    expect(event.message).toBe("from child")
  })

  test("creates child loggers with props", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "parent", {
      version: "1.0",
    })
    log.info?.("with props")

    const logEvents = posted.filter(
      (e) => (e as Event).kind === "log",
    ) as LogEvent[]
    expect(logEvents[0]!.props).toEqual(
      expect.objectContaining({ version: "1.0" }),
    )
  })
})

// ============ Worker Spans ============

describe("createWorkerLogger spans", () => {
  test("posts span events via postMessage", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using span = log.span!("work")
      span.spanData.count = 42
    }

    const spanEvents = posted.filter(
      (e) => (e as Event).kind === "span",
    ) as SpanEvent[]
    expect(spanEvents).toHaveLength(1)
    const end = spanEvents[0]!
    expect(end.namespace).toBe("test:work")
    expect(end.duration).toBeGreaterThanOrEqual(0)
    expect(end.props).toEqual(expect.objectContaining({ count: 42 }))
  })

  test("nested spans share trace ID", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using outer = log.span!("outer")
      {
        using inner = outer.span!("inner")
        inner.info?.("inside")
      }
    }

    const spanEvents = posted.filter(
      (e) => (e as Event).kind === "span",
    ) as SpanEvent[]
    // Inner and outer span end events
    expect(spanEvents.length).toBeGreaterThanOrEqual(2)

    const innerSpan = spanEvents.find(
      (e) => e.namespace === "test:outer:inner",
    )!
    const outerSpan = spanEvents.find((e) => e.namespace === "test:outer")!
    // Both share the same trace ID
    expect(innerSpan.traceId).toBe(outerSpan.traceId)
    // Inner has outer as parent
    expect(innerSpan.parentId).toBe(outerSpan.spanId)
  })

  test("span can log messages", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    const log = createWorkerLogger(mockPostMessage, "test")

    {
      using span = log.span!("work")
      span.info?.("processing")
      span.debug?.("details")
    }

    const logEvents = posted.filter(
      (e) => (e as Event).kind === "log",
    ) as LogEvent[]
    expect(logEvents).toHaveLength(2)
    expect(logEvents[0]!.namespace).toBe("test:work")
    expect(logEvents[0]!.message).toBe("processing")
  })
})

// ============ handleWorkerEvents ============

describe("handleWorkerEvents", () => {
  test("dispatches log events to target logger", () => {
    const dispatched: Event[] = []
    const target = {
      dispatch(event: Event) {
        dispatched.push(event)
      },
    }

    const handler = handleWorkerEvents(target)
    const event: LogEvent = {
      kind: "log",
      time: Date.now(),
      namespace: "test",
      level: "info",
      message: "hello",
    }
    handler(event)

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual(event)
  })

  test("dispatches span events to target logger", () => {
    const dispatched: Event[] = []
    const target = {
      dispatch(event: Event) {
        dispatched.push(event)
      },
    }

    const handler = handleWorkerEvents(target)
    const event: SpanEvent = {
      kind: "span",
      time: Date.now(),
      namespace: "test:work",
      name: "test:work",
      duration: 100,
      spanId: "sp_1",
      traceId: "tr_1",
      parentId: null,
      props: { count: 42 },
    }
    handler(event)

    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]).toEqual(event)
  })

  test("ignores non-event messages", () => {
    const dispatched: Event[] = []
    const target = {
      dispatch(event: Event) {
        dispatched.push(event)
      },
    }

    const handler = handleWorkerEvents(target)
    handler(null)
    handler(undefined)
    handler({ type: "console", level: "log", args: [] })
    handler("string")
    handler(42)

    expect(dispatched).toHaveLength(0)
  })
})

// ============ createWorkerLogHandler ============

describe("createWorkerLogHandler", () => {
  test("handles log events", () => {
    const handler = createWorkerLogHandler()

    handler({
      kind: "log",
      time: Date.now(),
      namespace: "test",
      level: "info",
      message: "hello",
      props: { key: "value" },
    } satisfies LogEvent)

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("test")
    expect(consoleOutput[0]!.message).toContain("hello")
  })

  test("handles span events", () => {
    process.env.TRACE = "1"
    const handler = createWorkerLogHandler()

    handler({
      kind: "span",
      time: Date.now(),
      namespace: "test:work",
      name: "test:work",
      duration: 100,
      spanId: "sp_1",
      traceId: "tr_1",
      parentId: null,
      props: { count: 42 },
    } satisfies SpanEvent)

    // Should have span output
    const spanOutput = consoleOutput.find((o) => o.message.includes("SPAN"))
    expect(spanOutput).toBeDefined()
    expect(spanOutput!.message).toContain("test:work")
    expect(spanOutput!.message).toContain("count")
    expect(spanOutput!.message).toContain("42")
  })

  test("handles console messages", () => {
    const handler = createWorkerLogHandler()

    handler({
      type: "console",
      level: "info",
      namespace: "test",
      args: ["console message"],
      timestamp: Date.now(),
    } satisfies WorkerConsoleMessage)

    expect(consoleOutput).toHaveLength(1)
    expect(consoleOutput[0]!.message).toContain("console message")
  })

  test("ignores unknown messages", () => {
    const handler = createWorkerLogHandler()

    handler({ type: "ready" })
    handler({ type: "sync", paths: [] })
    handler(null)

    expect(consoleOutput).toHaveLength(0)
  })
})

// ============ Full End-to-End ============

describe("full logger end-to-end", () => {
  test("worker logger -> main handler flow", () => {
    process.env.TRACE = "1"
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    // Worker side
    const log = createWorkerLogger(mockPostMessage, "km:worker:test")
    log.info?.("starting work")
    {
      using span = log.span!("process")
      span.info?.("processing...")
      span.spanData.items = 5
    }
    log.info?.("done")

    // Main thread side
    const handler = createWorkerLogHandler()
    for (const msg of posted) {
      handler(msg)
    }

    // Should have log outputs and span output
    expect(consoleOutput.length).toBeGreaterThanOrEqual(4) // 3 logs + 1 span
    expect(consoleOutput.some((o) => o.message.includes("starting work"))).toBe(
      true,
    )
    expect(consoleOutput.some((o) => o.message.includes("processing"))).toBe(
      true,
    )
    expect(consoleOutput.some((o) => o.message.includes("done"))).toBe(true)
  })

  test("events survive round-trip", () => {
    const posted: unknown[] = []
    const mockPostMessage = (msg: unknown) => posted.push(msg)

    // Worker side
    const log = createWorkerLogger(mockPostMessage, "test")
    log.info?.("round-trip", { key: "value" })

    // Simulate structuredClone (what postMessage does)
    const cloned = structuredClone(posted[0])

    // Main thread side
    const dispatched: Event[] = []
    const target = {
      dispatch(event: Event) {
        dispatched.push(event)
      },
    }
    const handler = handleWorkerEvents(target)
    handler(cloned)

    expect(dispatched).toHaveLength(1)
    const event = dispatched[0] as LogEvent
    expect(event.kind).toBe("log")
    expect(event.namespace).toBe("test")
    expect(event.message).toBe("round-trip")
    expect(event.props).toEqual(expect.objectContaining({ key: "value" }))
  })
})

// ============ Edge Cases ============

describe("console handler handles circular/bigint without throwing", () => {
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

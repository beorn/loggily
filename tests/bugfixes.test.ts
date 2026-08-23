/**
 * Tests for bug fixes:
 * 1. km-loggily.span-collection-broken — getCollectedSpans() always returns empty
 * 2. km-loggily.json-stringify-throws — JSON.stringify crashes on circular refs, bigint, symbol
 * 3. km-loggily.span-context-corrupt — non-LIFO end() calls corrupt AsyncLocalStorage context
 * 4. Error.cause chain serialization — cause chains are serialized up to max depth
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import {
  createLogger,
  resetIds,
  startCollecting,
  stopCollecting,
  getCollectedSpans,
  clearCollectedSpans,
  type Event,
  type LogEvent,
} from "../src/index.ts"
import {
  enableContextPropagation,
  disableContextPropagation,
  getCurrentSpan,
} from "../src/context.ts"
import { createConsoleMock } from "./helpers.ts"

let consoleMock: ReturnType<typeof createConsoleMock>

beforeEach(() => {
  resetIds()
  disableContextPropagation()
  clearCollectedSpans()
  delete process.env.TRACE
  consoleMock = createConsoleMock()
})

afterEach(() => {
  delete process.env.TRACE
  vi.restoreAllMocks()
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 1: km-loggily.span-collection-broken
// getCollectedSpans() always returns empty because spans are never pushed
// to the collectedSpans array after disposal/writeSpan.
// ─────────────────────────────────────────────────────────────────────────────

describe("span collection (km-loggily.span-collection-broken)", () => {
  test("startCollecting + span disposal populates collectedSpans", () => {
    startCollecting()
    const log = createLogger("test", [
      { level: "trace", idFormat: "simple" },
      console,
    ])

    {
      using span = log.span!("work")
      span.spanData.count = 42
    }

    const spans = getCollectedSpans()
    expect(spans).toHaveLength(1)
    expect(spans[0]!.id).toBe("sp_1")
    expect(spans[0]!.traceId).toBe("tr_1")
    expect(spans[0]!.duration).toBeGreaterThanOrEqual(0)
  })

  test("multiple spans are collected", () => {
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("a")
    }
    {
      using span = log.span!("b")
    }
    {
      using span = log.span!("c")
    }

    const spans = getCollectedSpans()
    expect(spans).toHaveLength(3)
  })

  test("nested spans are all collected", () => {
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    const parent = log.span!("parent")
    const child = parent.span!("child")
    child.end()
    parent.end()

    const spans = getCollectedSpans()
    expect(spans).toHaveLength(2)
  })

  test("stopCollecting returns collected spans and stops collection", () => {
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("before")
    }

    const collected = stopCollecting()
    expect(collected).toHaveLength(1)

    // After stopCollecting, new spans are not collected
    {
      using span = log.span!("after")
    }

    expect(getCollectedSpans()).toHaveLength(1) // still 1, not 2
  })

  test("collected spans have correct attributes", () => {
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("work")
      span.spanData.file = "data.csv"
      span.spanData.count = 100
    }

    const spans = getCollectedSpans()
    expect(spans[0]!.file).toBe("data.csv")
    expect(spans[0]!.count).toBe(100)
  })

  test("collection works even when spans output is disabled", () => {
    // No TRACE env var — spans output disabled, but collection should still work
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("silent")
    }

    const spans = getCollectedSpans()
    expect(spans).toHaveLength(1)
  })

  test("clearCollectedSpans empties the array", () => {
    startCollecting()
    const log = createLogger("test", [{ level: "trace" }, console])

    {
      using span = log.span!("work")
    }

    expect(getCollectedSpans()).toHaveLength(1)
    clearCollectedSpans()
    expect(getCollectedSpans()).toHaveLength(0)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 2: km-loggily.json-stringify-throws
// JSON.stringify crashes on circular refs (already partially handled in formatJSON
// but NOT in formatConsole), bigint, symbol, Error objects in data.
// ─────────────────────────────────────────────────────────────────────────────

describe("safe stringify (km-loggily.json-stringify-throws)", () => {
  test("bigint in data does not throw (console format)", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    expect(() => {
      log.info?.("bigint test", { value: BigInt(12345678901234567890n) })
    }).not.toThrow()

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("12345678901234567890")
  })

  test("bigint in data does not throw (JSON format)", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    expect(() => {
      log.info?.("bigint test", { value: BigInt(42n) })
    }).not.toThrow()

    const parsed = JSON.parse(consoleMock.output[0]!.message) as Record<
      string,
      unknown
    >
    expect(parsed.value).toBe("42")
  })

  test("symbol in data does not throw (console format)", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    expect(() => {
      log.info?.("symbol test", { key: Symbol("mySymbol") })
    }).not.toThrow()

    expect(consoleMock.output).toHaveLength(1)
  })

  test("symbol in data does not throw (JSON format)", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    expect(() => {
      log.info?.("symbol test", { key: Symbol("mySymbol") })
    }).not.toThrow()
  })

  test("circular reference in data does not throw (console format)", () => {
    const log = createLogger("test", [{ level: "trace" }, console])
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj

    expect(() => {
      log.info?.("circular test", obj)
    }).not.toThrow()

    expect(consoleMock.output).toHaveLength(1)
    expect(consoleMock.output[0]!.message).toContain("[Circular]")
  })

  test("circular reference in data does not throw (JSON format)", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const obj: Record<string, unknown> = { a: 1 }
    obj.self = obj

    expect(() => {
      log.info?.("circular test", obj)
    }).not.toThrow()

    expect(consoleMock.output[0]!.message).toContain("[Circular]")
  })

  test("Error object in data is serialized with message and stack", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const err = new Error("test error")

    expect(() => {
      log.info?.("error in data", { err })
    }).not.toThrow()

    const parsed = JSON.parse(consoleMock.output[0]!.message) as Record<
      string,
      unknown
    >
    const errObj = parsed.err as Record<string, unknown>
    expect(errObj).toBeDefined()
    expect(errObj.message).toBe("test error")
    expect(errObj.stack).toContain("Error: test error")
  })

  test("nested circular references are handled", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const a: Record<string, unknown> = { name: "a" }
    const b: Record<string, unknown> = { name: "b", ref: a }
    a.ref = b

    expect(() => {
      log.info?.("nested circular", { a, b })
    }).not.toThrow()
  })

  test("mixed problematic types in one data object", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])
    const circular: Record<string, unknown> = { x: 1 }
    circular.self = circular

    expect(() => {
      log.info?.("mixed", {
        big: BigInt(999n),
        sym: Symbol("test"),
        circ: circular,
        err: new Error("oops"),
        normal: "ok",
      })
    }).not.toThrow()

    const parsed = JSON.parse(consoleMock.output[0]!.message) as Record<
      string,
      unknown
    >
    expect(parsed.big).toBe("999")
    expect(parsed.normal).toBe("ok")
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 3: km-loggily.span-context-corrupt
// Non-LIFO end() calls corrupt AsyncLocalStorage context because
// exitSpanContext reconstructs a partial SpanContext instead of
// restoring the exact previous snapshot.
// ─────────────────────────────────────────────────────────────────────────────

describe("span context non-LIFO end (km-loggily.span-context-corrupt)", () => {
  test("ending inner span before outer restores outer context", () => {
    enableContextPropagation()
    const log = createLogger("test", [{ level: "trace" }, console])

    const outer = log.span!("outer")
    const inner = outer.span!("inner")

    // LIFO order: end inner first
    inner.end()
    const current = getCurrentSpan()
    expect(current).not.toBeNull()
    expect(current!.spanId).toBe(outer.spanData.id)
    // The parentId should be restored correctly (outer's parentId is null)
    expect(current!.parentId).toBeNull()

    outer.end()
    expect(getCurrentSpan()).toBeNull()
  })

  test("non-LIFO end order does not corrupt context", () => {
    enableContextPropagation()
    const log = createLogger("test", [{ level: "trace" }, console])

    const A = log.span!("A")
    const B = A.span!("B")
    const C = B.span!("C")

    // Non-LIFO: end B before C
    // Before this fix, ending B would set context to A, then ending C
    // would try to restore B (which is now ended), corrupting the context.
    B.end()

    // After ending B, the context should be restored to A
    const afterB = getCurrentSpan()
    expect(afterB).not.toBeNull()
    expect(afterB!.spanId).toBe(A.spanData.id)

    C.end()
    // After ending C, context should still be A (C's parent was B,
    // but the stored snapshot for C should reflect the context at C's creation time)
    // With the fix, we capture the full SpanContext snapshot at enter time

    A.end()
    expect(getCurrentSpan()).toBeNull()
  })

  test("three-level LIFO correctly restores each level", () => {
    enableContextPropagation()
    const log = createLogger("test", [{ level: "trace" }, console])

    const A = log.span!("A")
    expect(getCurrentSpan()!.spanId).toBe(A.spanData.id)

    const B = A.span!("B")
    expect(getCurrentSpan()!.spanId).toBe(B.spanData.id)

    const C = B.span!("C")
    expect(getCurrentSpan()!.spanId).toBe(C.spanData.id)

    C.end()
    expect(getCurrentSpan()!.spanId).toBe(B.spanData.id)
    // B's parent is A, so the parentId in the context should be A's spanId
    expect(getCurrentSpan()!.parentId).toBe(A.spanData.id)

    B.end()
    expect(getCurrentSpan()!.spanId).toBe(A.spanData.id)
    expect(getCurrentSpan()!.parentId).toBeNull()

    A.end()
    expect(getCurrentSpan()).toBeNull()
  })

  test("sibling spans maintain correct context", () => {
    enableContextPropagation()
    const log = createLogger("test", [{ level: "trace" }, console])

    const parent = log.span!("parent")

    const child1 = parent.span!("child1")
    child1.end()
    // After child1 ends, context should be back to parent
    expect(getCurrentSpan()!.spanId).toBe(parent.spanData.id)

    const child2 = parent.span!("child2")
    expect(getCurrentSpan()!.spanId).toBe(child2.spanData.id)
    child2.end()
    // After child2 ends, context should be back to parent
    expect(getCurrentSpan()!.spanId).toBe(parent.spanData.id)

    parent.end()
    expect(getCurrentSpan()).toBeNull()
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Bug 4: Error.cause chain serialization
// When log.error?.(new Error("timeout")) is called and the Error has a .cause
// chain, the causes should be serialized (not silently dropped).
// ─────────────────────────────────────────────────────────────────────────────

describe("Error.cause chain serialization", () => {
  test("Error.cause chain is serialized", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    const root = new Error("timeout")
    root.cause = new Error("DNS failed")
    ;(root.cause as Error).cause = new Error("network unreachable")

    log.error?.(root)

    const event = logs[0] as LogEvent
    expect(event.props?.error_cause).toEqual({
      name: "Error",
      message: "DNS failed",
      stack: expect.any(String),
      cause: {
        name: "Error",
        message: "network unreachable",
        stack: expect.any(String),
      },
    })
  })

  test("Error.cause chain depth is capped at 3", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    let err = new Error("level 0")
    for (let i = 1; i <= 5; i++) {
      const outer = new Error(`level ${i}`)
      outer.cause = err
      err = outer
    }

    log.error?.(err)

    const event = logs[0] as LogEvent
    // Should have cause chain but capped at depth 3
    let cause = event.props?.error_cause as Record<string, unknown>
    expect(cause).toBeDefined()
    let depth = 0
    while (cause?.cause) {
      depth++
      cause = cause.cause as Record<string, unknown>
    }
    expect(depth).toBeLessThanOrEqual(3)
  })

  test("Error without cause has no error_cause property", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    log.error?.(new Error("simple error"))

    const event = logs[0] as LogEvent
    expect(event.props?.error_cause).toBeUndefined()
  })

  test("Error with non-Error cause serializes the raw value", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    const err = new Error("failed")
    err.cause = "string cause"

    log.error?.(err)

    const event = logs[0] as LogEvent
    expect(event.props?.error_cause).toBe("string cause")
  })

  test("Error.cause with code property is preserved", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    const cause = new Error("connection refused") as Error & { code: string }
    cause.code = "ECONNREFUSED"
    const err = new Error("request failed")
    err.cause = cause

    log.error?.(err)

    const event = logs[0] as LogEvent
    const serializedCause = event.props?.error_cause as Record<string, unknown>
    expect(serializedCause.code).toBe("ECONNREFUSED")
    expect(serializedCause.message).toBe("connection refused")
  })

  test("Error.cause in error(error, message, data) overload", () => {
    const logs: Event[] = []
    const log = createLogger("test", [
      (e: Event) => {
        logs.push(e)
        return e
      },
      "console",
    ])

    const root = new Error("timeout")
    root.cause = new Error("DNS failed")

    log.error?.(root, "request failed", { url: "/api" })

    const event = logs[0] as LogEvent
    expect(event.message).toBe("request failed")
    expect(event.props?.error_cause).toEqual({
      name: "Error",
      message: "DNS failed",
      stack: expect.any(String),
    })
    expect(event.props?.url).toBe("/api")
  })

  test("Error.cause in safeStringify (JSON format)", () => {
    const log = createLogger("test", [
      { level: "trace", format: "json" },
      console,
    ])

    const root = new Error("timeout")
    root.cause = new Error("DNS failed")

    log.info?.("error in data", { err: root })

    expect(consoleMock.output).toHaveLength(1)
    const parsed = JSON.parse(consoleMock.output[0]!.message) as Record<
      string,
      unknown
    >
    const errObj = parsed.err as Record<string, unknown>
    expect(errObj.cause).toEqual({
      name: "Error",
      message: "DNS failed",
      stack: expect.any(String),
    })
  })
})

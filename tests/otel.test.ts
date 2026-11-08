import { describe, test, expect, vi } from "vitest"
import { toOtel } from "../src/otel.ts"
import type { LogEvent, SpanEvent } from "loggily"

describe("OTEL bridge", () => {
  test("fatal maps to severity21 through the existing injected logs API", () => {
    const emit = vi.fn()
    const stage = toOtel({
      api: {
        logs: {
          getLoggerProvider: () => ({
            getLogger: () => ({ emit }),
          }),
        },
      },
    })
    const event: LogEvent = {
      kind: "log",
      time: 0,
      namespace: "critical",
      level: "fatal",
      message: "critical event",
      props: { unit: "worker" },
    }
    expect(stage(event)).toBe(event)
    expect(emit).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({
        severityNumber: 21,
        severityText: "FATAL",
        body: "critical event",
        attributes: { "loggily.namespace": "critical", unit: "worker" },
      }),
    )
  })

  test("toOtel returns a stage function", () => {
    const stage = toOtel()
    expect(typeof stage).toBe("function")
  })

  test("stage passes events through unchanged", () => {
    const stage = toOtel()
    const event: LogEvent = {
      kind: "log",
      time: Date.now(),
      namespace: "test",
      level: "info",
      message: "hello",
    }
    const result = stage(event)
    expect(result).toEqual(event)
  })

  test("stage passes span events through unchanged", () => {
    const stage = toOtel()
    const event: SpanEvent = {
      kind: "span",
      time: Date.now(),
      namespace: "test",
      name: "test:op",
      duration: 100,
      spanId: "sp_1",
      traceId: "tr_1",
      parentId: null,
    }
    const result = stage(event)
    expect(result).toEqual(event)
  })

  test("options disable log/span forwarding", () => {
    const logsOnly = toOtel({ spans: false })
    const spansOnly = toOtel({ logs: false })
    const neither = toOtel({ logs: false, spans: false })

    const logEvent: LogEvent = {
      kind: "log",
      time: Date.now(),
      namespace: "test",
      level: "info",
      message: "msg",
    }

    // All should pass through regardless
    expect(logsOnly(logEvent)).toEqual(logEvent)
    expect(spansOnly(logEvent)).toEqual(logEvent)
    expect(neither(logEvent)).toEqual(logEvent)
  })
})

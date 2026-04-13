/**
 * Tests for writable sink compatibility.
 *
 * Writables receive raw Event objects by default (objectMode).
 * Set objectMode: false for formatted string output.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import {
  createLogger,
  type Event,
  type LogEvent,
  type SpanEvent,
} from "loggily"
import { createConsoleMock } from "./helpers.ts"

describe("Pino transport compatibility", () => {
  let restoreConsole: ReturnType<typeof vi.spyOn>[]

  beforeEach(() => {
    restoreConsole = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi
        .spyOn(process.stderr, "write")
        .mockImplementation((() => true) as typeof process.stderr.write),
    ]
  })

  afterEach(() => {
    for (const spy of restoreConsole) spy.mockRestore()
  })

  test("{ write } transport receives raw Event objects by default", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }

    const log = createLogger("test", [{ level: "debug" }, transport])
    log.info?.("hello world")
    log.debug?.("verbose detail")

    expect(events).toHaveLength(2)
    expect(events[0]!.kind).toBe("log")
    expect((events[0] as LogEvent).message).toBe("hello world")
    expect((events[1] as LogEvent).message).toBe("verbose detail")
  })

  test("objectMode: false receives formatted strings", () => {
    const messages: string[] = []
    const transport = {
      write: (msg: string) => messages.push(msg),
      objectMode: false as const,
    }

    const log = createLogger("test", [
      { level: "info", format: "json" },
      transport,
    ])
    log.info?.("structured", { count: 42 })

    expect(messages).toHaveLength(1)
    const parsed = JSON.parse(messages[0]!.trim()) as Record<string, unknown>
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("structured")
    expect(parsed.count).toBe(42)
  })

  test("transport with level filtering via branch", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }

    const log = createLogger("test", [
      { level: "debug" },
      "console",
      [{ level: "error" }, transport], // branch: transport only gets errors
    ])

    log.debug?.("debug msg")
    log.info?.("info msg")
    log.error?.("error msg")

    expect(events).toHaveLength(1)
    expect((events[0] as LogEvent).message).toBe("error msg")
  })

  test("transport works alongside console sink", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }
    const mock = createConsoleMock()

    const log = createLogger("test", [{ level: "info" }, "console", transport])
    log.info?.("dual output")

    expect(mock.output.some((o) => o.message.includes("dual output"))).toBe(
      true,
    )
    expect(events.some((e) => (e as LogEvent).message === "dual output")).toBe(
      true,
    )
  })

  test("transport receives span events", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }

    const log = createLogger("test", [{ level: "trace" }, transport])

    {
      using span = log.span!("operation")
      span.info?.("working")
    }

    const spanEvent = events.find((e) => e.kind === "span") as
      | SpanEvent
      | undefined
    expect(spanEvent).toBeDefined()
    expect(spanEvent!.name).toBe("test:operation")
    expect(typeof spanEvent!.duration).toBe("number")
  })

  test("multiple transports in config array", () => {
    const all: Event[] = []
    const errorsOnly: Event[] = []
    const allTransport = { write: (obj: unknown) => all.push(obj as Event) }
    const errorTransport = {
      write: (obj: unknown) => errorsOnly.push(obj as Event),
    }

    const log = createLogger("test", [
      { level: "debug" },
      allTransport,
      [{ level: "error" }, errorTransport],
    ])

    log.debug?.("debug")
    log.info?.("info")
    log.error?.("error")

    expect(all).toHaveLength(3)
    expect(errorsOnly).toHaveLength(1)
    expect((errorsOnly[0] as LogEvent).message).toBe("error")
  })

  test("transport with namespace filtering", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }

    const log = createLogger("app", [
      { level: "debug", ns: "app:db" },
      transport,
    ])

    log.info?.("root msg")
    const db = log.child("db")
    db.info?.("query done")

    expect(events).toHaveLength(1)
    expect((events[0] as LogEvent).message).toBe("query done")
  })

  test("stage function works with transport", () => {
    const events: Event[] = []
    const transport = { write: (obj: unknown) => events.push(obj as Event) }

    const log = createLogger("test", [
      { level: "info" },
      (e: Event) => ({
        ...e,
        props: { ...(e as LogEvent).props, enriched: true },
      }),
      transport,
    ])

    log.info?.("enriched msg")
    expect(events).toHaveLength(1)
    expect((events[0] as LogEvent).props?.enriched).toBe(true)
  })

  test("explicit objectMode: true still works (backwards compat)", () => {
    const events: Event[] = []
    const transport = {
      write: (obj: unknown) => events.push(obj as Event),
      objectMode: true,
    }

    const log = createLogger("test", [{ level: "info" }, transport])
    log.info?.("hello", { count: 42 })

    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe("log")
    expect((events[0] as LogEvent).props?.count).toBe(42)
  })
})

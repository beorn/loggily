/**
 * Tests proving Pino transport compatibility.
 *
 * Pino transports are objects with { write(msg: string) } method.
 * loggily accepts these as writable sinks in config arrays.
 */

import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"
import { createLogger, type Event, type LogEvent, type SpanEvent } from "loggily"
import { createConsoleMock } from "./helpers.ts"

describe("Pino transport compatibility", () => {
  let restoreConsole: ReturnType<typeof vi.spyOn>[]

  beforeEach(() => {
    restoreConsole = [
      vi.spyOn(console, "debug").mockImplementation(() => {}),
      vi.spyOn(console, "info").mockImplementation(() => {}),
      vi.spyOn(console, "warn").mockImplementation(() => {}),
      vi.spyOn(console, "error").mockImplementation(() => {}),
      vi.spyOn(process.stderr, "write").mockImplementation((() => true) as typeof process.stderr.write),
    ]
  })

  afterEach(() => {
    for (const spy of restoreConsole) spy.mockRestore()
  })

  test("Pino-style { write(msg) } transport receives formatted strings", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("test", [{ level: "debug" }, transport])
    log.info?.("hello world")
    log.debug?.("verbose detail")

    expect(messages).toHaveLength(2)
    expect(messages[0]).toContain("INFO")
    expect(messages[0]).toContain("hello world")
    expect(messages[1]).toContain("DEBUG")
    expect(messages[1]).toContain("verbose detail")
  })

  test("Pino transport receives JSON when format is json", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("test", [{ level: "info", format: "json" }, transport])
    log.info?.("structured", { count: 42 })

    expect(messages).toHaveLength(1)
    const parsed = JSON.parse(messages[0]!.trim())
    expect(parsed.level).toBe("info")
    expect(parsed.msg).toBe("structured")
    expect(parsed.count).toBe(42)
  })

  test("Pino transport with level filtering", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("test", [
      { level: "debug" },
      "console",
      [{ level: "error" }, transport], // branch: transport only gets errors
    ])

    log.debug?.("debug msg")
    log.info?.("info msg")
    log.error?.("error msg")

    // Transport should only receive the error
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("error msg")
  })

  test("Pino transport works alongside console sink", () => {
    const transportMessages: string[] = []
    const transport = { write: (msg: string) => transportMessages.push(msg) }
    const mock = createConsoleMock()

    const log = createLogger("test", [{ level: "info" }, "console", transport])
    log.info?.("dual output")

    // Both console and transport receive the message
    expect(mock.output.some((o) => o.message.includes("dual output"))).toBe(true)
    expect(transportMessages.some((m) => m.includes("dual output"))).toBe(true)
  })

  test("Pino transport receives span events", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("test", [{ level: "trace" }, transport])

    {
      using span = log.span("operation")
      span.info?.("working")
    }

    // Should have at least the info message and the span
    const spanMsg = messages.find((m) => m.includes("SPAN"))
    expect(spanMsg).toBeDefined()
    expect(spanMsg).toContain("operation")
  })

  test("Multiple Pino transports in config array", () => {
    const all: string[] = []
    const errorsOnly: string[] = []
    const allTransport = { write: (msg: string) => all.push(msg) }
    const errorTransport = { write: (msg: string) => errorsOnly.push(msg) }

    const log = createLogger("test", [{ level: "debug" }, allTransport, [{ level: "error" }, errorTransport]])

    log.debug?.("debug")
    log.info?.("info")
    log.error?.("error")

    expect(all).toHaveLength(3)
    expect(errorsOnly).toHaveLength(1)
    expect(errorsOnly[0]).toContain("error")
  })

  test("Pino transport with namespace filtering", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("app", [{ level: "debug", ns: "app:db" }, transport])

    log.info?.("root msg") // namespace "app" — doesn't match "app:db"
    const db = log.child("db")
    db.info?.("query done") // namespace "app:db" — matches

    // Only the db message should pass the namespace filter
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("query done")
  })

  test("Stage function works with Pino transport", () => {
    const messages: string[] = []
    const transport = { write: (msg: string) => messages.push(msg) }

    const log = createLogger("test", [
      { level: "info" },
      // Stage: enrich with hostname
      (e: Event) => ({
        ...e,
        props: { ...(e as LogEvent).props, enriched: true },
      }),
      transport,
    ])

    log.info?.("enriched msg")
    expect(messages).toHaveLength(1)
    expect(messages[0]).toContain("enriched")
  })

  test("Writable with objectMode receives raw Event objects", () => {
    const events: Event[] = []
    const transport = {
      write: (obj: unknown) => events.push(obj as Event),
      objectMode: true,
    }

    const log = createLogger("test", [{ level: "info" }, transport])
    log.info?.("hello", { count: 42 })

    expect(events).toHaveLength(1)
    expect(events[0]!.kind).toBe("log")
    expect((events[0] as LogEvent).message).toBe("hello")
    expect((events[0] as LogEvent).props?.count).toBe(42)
  })

  test("Writable without objectMode receives formatted strings", () => {
    const messages: unknown[] = []
    const transport = { write: (data: unknown) => messages.push(data) }

    const log = createLogger("test", [{ level: "info" }, transport])
    log.info?.("hello")

    expect(messages).toHaveLength(1)
    expect(typeof messages[0]).toBe("string")
  })

  test("objectMode writable receives span events as raw objects", () => {
    const events: Event[] = []
    const transport = {
      write: (obj: unknown) => events.push(obj as Event),
      objectMode: true,
    }

    const log = createLogger("test", [{ level: "trace" }, transport])

    {
      using span = log.span("operation")
      span.info?.("working")
    }

    const spanEvent = events.find((e) => e.kind === "span") as SpanEvent | undefined
    expect(spanEvent).toBeDefined()
    expect(spanEvent!.name).toBe("test:operation")
    expect(typeof spanEvent!.duration).toBe("number")
  })
})

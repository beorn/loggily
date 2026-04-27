/**
 * addWriterFor — namespace-glob-routed writer fan-out.
 *
 * Validates the per-namespace routing primitive used by bg-recall and
 * injection-envelope to fold their bespoke JSONL pipes into loggily.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"

const unsubs: Array<() => void> = []

beforeEach(() => {
  // The pipeline still mirrors to console alongside writers; suppress so
  // tests don't trip the harness's "no stray console output" guard.
  const { setSuppressConsole } =
    require("../src/index.ts") as typeof import("../src/index.ts")
  setSuppressConsole(true)
})

afterEach(() => {
  while (unsubs.length) unsubs.pop()?.()
  const { setSuppressConsole } =
    require("../src/index.ts") as typeof import("../src/index.ts")
  setSuppressConsole(false)
})

function track(unsub: () => void): () => void {
  unsubs.push(unsub)
  return unsub
}

describe("addWriterFor — namespace routing", () => {
  test("only fires for matching namespaces", () => {
    const { addWriterFor, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const captured: string[] = []
    track(addWriterFor("bg-recall:*", (_fmt, _lvl, ns) => captured.push(ns)))

    const bg = createLogger("bg-recall:trigger")
    const inj = createLogger("injection:wrap")
    const other = createLogger("silvery:render")
    bg.warn?.("hi")
    inj.warn?.("hi")
    other.warn?.("hi")

    expect(captured).toEqual(["bg-recall:trigger"])
  })

  test("matches descendant namespaces", () => {
    const { addWriterFor, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const captured: string[] = []
    track(addWriterFor("bg-recall", (_fmt, _lvl, ns) => captured.push(ns)))

    createLogger("bg-recall").warn?.("a")
    createLogger("bg-recall:trigger").warn?.("b")
    createLogger("bg-recall:hint:emit").warn?.("c")

    expect(captured).toEqual(["bg-recall", "bg-recall:trigger", "bg-recall:hint:emit"])
  })

  test("supports exclude patterns (-ns)", () => {
    const { addWriterFor, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const captured: string[] = []
    track(addWriterFor(["bg-recall:*", "-bg-recall:noisy"], (_fmt, _lvl, ns) => captured.push(ns)))

    createLogger("bg-recall:trigger").warn?.("a")
    createLogger("bg-recall:noisy").warn?.("b")
    createLogger("bg-recall:hint").warn?.("c")

    expect(captured).toEqual(["bg-recall:trigger", "bg-recall:hint"])
  })

  test("delivers structured event so JSONL sinks can re-serialize", () => {
    const { addWriterFor, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const events: Array<{ ns: string; props?: Record<string, unknown>; msg?: string }> = []
    track(
      addWriterFor("bg-recall:*", (_fmt, _lvl, ns, event) => {
        if (event.kind === "log") {
          events.push({ ns, props: event.props, msg: event.message })
        }
      }),
    )

    const log = createLogger("bg-recall:hint")
    log.warn?.("emitted", { hintId: "h-42", score: 0.91 })

    expect(events).toHaveLength(1)
    expect(events[0]!.ns).toBe("bg-recall:hint")
    expect(events[0]!.msg).toBe("emitted")
    expect(events[0]!.props).toMatchObject({ hintId: "h-42", score: 0.91 })
  })

  test("unsubscribe stops further writes", () => {
    const { addWriterFor, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const captured: string[] = []
    const unsub = addWriterFor("bg-recall:*", (_fmt, _lvl, ns) => captured.push(ns))

    createLogger("bg-recall:a").warn?.("1")
    unsub()
    createLogger("bg-recall:a").warn?.("2")

    expect(captured).toEqual(["bg-recall:a"])
  })

  test("legacy 2-arg writers still work via addWriter", () => {
    const { addWriter, createLogger } =
      require("../src/index.ts") as typeof import("../src/index.ts")
    const captured: Array<[string, string]> = []
    track(addWriter((formatted, level) => captured.push([formatted, level])))

    createLogger("legacy:test").warn?.("hello")

    expect(captured.length).toBe(1)
    expect(captured[0]![1]).toBe("warn")
    expect(captured[0]![0]).toContain("hello")
  })
})

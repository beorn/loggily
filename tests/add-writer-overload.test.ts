/**
 * addWriter — unified overload (catch-all + scoped).
 *
 * Validates the writer-registration primitive: a bare WriterFn is a
 * catch-all; passing a ConfigObject ({ ns, level }) as the first arg
 * routes the writer through namespace + level filters.
 */

import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { addWriter, createLogger, setLogLevel, setSuppressConsole } from "../src/index.ts"

const unsubs: Array<() => void> = []

beforeEach(() => {
  setSuppressConsole(true)
})

afterEach(() => {
  while (unsubs.length) unsubs.pop()?.()
  setSuppressConsole(false)
})

function track(unsub: () => void): () => void {
  unsubs.push(unsub)
  return unsub
}

describe("addWriter — overloaded form (writer | config + writer)", () => {
  test("addWriter(writer) — catch-all, every namespace routes", () => {
    const captured: string[] = []
    track(addWriter((_fmt, _lvl, ns) => captured.push(ns)))

    createLogger("a:b").warn?.("hi")
    createLogger("c:d").warn?.("hi")
    createLogger("e").warn?.("hi")

    expect(captured).toEqual(["a:b", "c:d", "e"])
  })

  test("addWriter({ ns }, writer) — namespace scope only", () => {
    const captured: string[] = []
    track(
      addWriter({ ns: "bg-recall:*" }, (_fmt, _lvl, ns) => captured.push(ns)),
    )

    createLogger("bg-recall:trigger").warn?.("a")
    createLogger("injection:wrap").warn?.("b")
    createLogger("bg-recall:hint").warn?.("c")

    expect(captured).toEqual(["bg-recall:trigger", "bg-recall:hint"])
  })

  test("addWriter({ level }, writer) — level filter only", () => {
    setLogLevel("trace") // ensure all levels emit through the pipeline
    track(() => setLogLevel("info"))

    const captured: string[] = []
    track(addWriter({ level: "warn" }, (_fmt, lvl) => captured.push(lvl)))

    const log = createLogger("a:b")
    log.trace?.("t")
    log.debug?.("d")
    log.info?.("i")
    log.warn?.("w")
    log.error?.("e")

    expect(captured).toEqual(["warn", "error"])
  })

  test("addWriter({ ns, level }, writer) — both filters apply", () => {
    setLogLevel("trace")
    track(() => setLogLevel("info"))

    const captured: Array<{ ns: string; lvl: string }> = []
    track(
      addWriter({ ns: "bg-recall:*", level: "warn" }, (_fmt, lvl, ns) =>
        captured.push({ ns, lvl }),
      ),
    )

    createLogger("bg-recall:trigger").debug?.("nope") // level too low
    createLogger("bg-recall:trigger").warn?.("yes") // matches both
    createLogger("injection:wrap").error?.("nope") // wrong ns
    createLogger("bg-recall:hint").error?.("yes") // matches both

    expect(captured).toEqual([
      { ns: "bg-recall:trigger", lvl: "warn" },
      { ns: "bg-recall:hint", lvl: "error" },
    ])
  })

  test("addWriter({}, writer) — empty config behaves like catch-all", () => {
    const captured: string[] = []
    track(addWriter({}, (_fmt, _lvl, ns) => captured.push(ns)))

    createLogger("a").warn?.("a")
    createLogger("b:c").warn?.("b")

    expect(captured).toEqual(["a", "b:c"])
  })

  test("addWriter({ ns: array }, writer) — array of patterns with excludes", () => {
    const captured: string[] = []
    track(
      addWriter({ ns: ["bg-recall:*", "-bg-recall:noisy"] }, (_fmt, _lvl, ns) =>
        captured.push(ns),
      ),
    )

    createLogger("bg-recall:trigger").warn?.("a")
    createLogger("bg-recall:noisy").warn?.("b")
    createLogger("bg-recall:hint").warn?.("c")

    expect(captured).toEqual(["bg-recall:trigger", "bg-recall:hint"])
  })

  test("addWriter throws when config given without writer", () => {
    expect(() => (addWriter as any)({ ns: "x:*" })).toThrow(
      /writer fn required/,
    )
  })

  test("unsubscribe stops further writes (scoped form)", () => {
    const captured: string[] = []
    const unsub = addWriter({ ns: "x:*" }, (_fmt, _lvl, ns) =>
      captured.push(ns),
    )
    createLogger("x:a").warn?.("a")
    unsub()
    createLogger("x:b").warn?.("b")

    expect(captured).toEqual(["x:a"])
  })
})

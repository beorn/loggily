/**
 * @failure A library's fallback logger (`createLogger("lib:x")`, no config
 *          array) writes to the console under a host that owns its output, so
 *          its rows miss the host's stream, file and filters.
 * @level l1
 * @consumer setDefaultOutput — a host routes pipeline-less loggers to its own pipeline for its lifetime
 * @testonly none
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import {
  type ConditionalLogger,
  createLogger,
  setDefaultOutput,
} from "../src/index.ts"

const CONSOLE_METHODS = ["log", "info", "warn", "error", "debug"] as const

let consoleRows: string[] = []

beforeEach(() => {
  consoleRows = []
  for (const method of CONSOLE_METHODS) {
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      consoleRows.push(args.map(String).join(" "))
    })
  }
})

afterEach(() => {
  vi.restoreAllMocks()
})

/** A host logger whose stream is an array, at `level`. */
function host(level: "trace" | "debug" | "info"): {
  logger: ConditionalLogger
  rows: string[]
} {
  const rows: string[] = []
  const logger = createLogger("host", [
    { level },
    { write: (text: string) => rows.push(text), objectMode: false },
  ])
  return { logger, rows }
}

describe("setDefaultOutput", () => {
  test("a pipeline-less logger writes through the host, under its own namespace, and stops after dispose", () => {
    const { logger, rows } = host("debug")
    const lib = createLogger("lib:process")

    const handle = setDefaultOutput(logger)
    lib.debug?.("command finished")
    expect(rows).toHaveLength(1)
    expect(rows[0]).toContain("lib:process")
    expect(rows[0]).toContain("command finished")
    expect(consoleRows).toEqual([])

    handle[Symbol.dispose]()
    lib.warn?.("after the host")
    expect(rows).toHaveLength(1)
    expect(consoleRows.join("\n")).toContain("after the host")
  })

  test("levels gate by the host's level while it is set", () => {
    const { logger, rows } = host("info")
    const lib = createLogger("lib:quiet")
    using _ = setDefaultOutput(logger)
    expect(lib.debug).toBeUndefined()
    lib.info?.("kept")
    expect(rows.map((row) => row.includes("kept"))).toEqual([true])
  })

  test("nested set and dispose restore in order; an out-of-order dispose removes only its own entry", () => {
    const outer = host("debug")
    const inner = host("debug")
    const lib = createLogger("lib:nested")

    const a = setDefaultOutput(outer.logger)
    const b = setDefaultOutput(inner.logger)
    lib.info?.("one")
    b[Symbol.dispose]()
    lib.info?.("two")
    a[Symbol.dispose]()
    lib.warn?.("three")
    expect(inner.rows.map((row) => row.includes("one"))).toEqual([true])
    expect(outer.rows.map((row) => row.includes("two"))).toEqual([true])
    expect(consoleRows.join("\n")).toContain("three")

    const c = setDefaultOutput(outer.logger)
    const d = setDefaultOutput(inner.logger)
    c[Symbol.dispose]()
    lib.info?.("four")
    expect(inner.rows.some((row) => row.includes("four"))).toBe(true)
    expect(outer.rows.some((row) => row.includes("four"))).toBe(false)
    d[Symbol.dispose]()
    d[Symbol.dispose]()
    lib.warn?.("five")
    expect(consoleRows.join("\n")).toContain("five")
  })
})

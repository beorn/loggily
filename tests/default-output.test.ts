/**
 * @failure A library's fallback logger (`createLogger("lib:x")`, no config
 *          array) writes to the console under a host that owns its output, so
 *          its rows miss the host's stream, file and filters.
 * @level l1
 * @consumer setDefaultOutput — a host routes pipeline-less loggers to its own pipeline for its lifetime
 * @testonly none
 */

import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { existsSync, readFileSync, unlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join } from "node:path"
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

  test("does not open the ambient LOG_FILE while a host owns output — an unusable path cannot abort construction", () => {
    const { logger, rows } = host("debug")
    const previous = process.env.LOG_FILE
    const missing = join(
      tmpdir(),
      `loggily-unused-${Date.now()}-${Math.random().toString(36).slice(2)}`,
      "absent-parent",
      "log.jsonl",
    )
    process.env.LOG_FILE = missing
    try {
      // The defect order: the host is installed BEFORE the library logger is
      // created, so the env pipeline opened an unused, unusable path and threw
      // ENOENT from file-writer.ts before any event could reach the host.
      const handle = setDefaultOutput(logger)
      const lib = createLogger("lib:unused-file")
      lib.info?.("routed to the host")

      expect(rows.some((row) => row.includes("routed to the host"))).toBe(true)
      expect(existsSync(missing)).toBe(false)
      expect(existsSync(dirname(missing))).toBe(false)
      handle[Symbol.dispose]()
    } finally {
      if (previous === undefined) delete process.env.LOG_FILE
      else process.env.LOG_FILE = previous
    }
  })

  test("with no host set, an unusable active LOG_FILE still fails at createLogger (error timing preserved)", () => {
    const previous = process.env.LOG_FILE
    const missing = join(
      tmpdir(),
      "loggily-nohost-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2),
      "absent-parent",
      "log.jsonl",
    )
    process.env.LOG_FILE = missing
    try {
      // No host owns output, so the documented no-host destination is selected
      // eagerly at construction: a bad path must surface here, not silently
      // later, which is the shape the lazy host-first path must not change.
      expect(() => createLogger("lib:no-host")).toThrow(/ENOENT/)
      expect(existsSync(missing)).toBe(false)
      expect(existsSync(dirname(missing))).toBe(false)
    } finally {
      if (previous === undefined) delete process.env.LOG_FILE
      else process.env.LOG_FILE = previous
    }
  })

  test("a host installed before the logger stops owning output on dispose, and the file sink is created then written", async () => {
    const previous = {
      LOG_FILE: process.env.LOG_FILE,
      LOG_FORMAT: process.env.LOG_FORMAT,
      LOG_LEVEL: process.env.LOG_LEVEL,
    }
    const file = join(
      tmpdir(),
      "loggily-host-dispose-" +
        Date.now() +
        "-" +
        Math.random().toString(36).slice(2) +
        ".jsonl",
    )
    process.env.LOG_FILE = file
    process.env.LOG_FORMAT = "json"
    process.env.LOG_LEVEL = "info"
    try {
      // Host FIRST, then the library logger — the order the disposal probe uses.
      // The file sink must not be opened while the host owns output, and must
      // still come up once the host is gone: deferred creation, not dropped.
      const { logger, rows } = host("debug")
      const handle = setDefaultOutput(logger)
      const lib = createLogger("lib:after-dispose")

      lib.info?.("while the host owns output")
      expect(
        rows.some((row) => row.includes("while the host owns output")),
      ).toBe(true)
      expect(existsSync(file)).toBe(false)

      handle[Symbol.dispose]()
      lib.warn?.("AFTER_HOST_DISPOSAL")

      // The console still receives the row immediately; the file writer buffers,
      // so wait past its flush interval before reading the file back.
      expect(consoleRows.join("\n")).toContain("AFTER_HOST_DISPOSAL")
      await new Promise((resolve) => setTimeout(resolve, 150))
      expect(existsSync(file)).toBe(true)
      expect(readFileSync(file, "utf8")).toContain("AFTER_HOST_DISPOSAL")
    } finally {
      for (const [key, value] of Object.entries(previous)) {
        if (value === undefined) delete process.env[key]
        else process.env[key] = value
      }
      if (existsSync(file)) unlinkSync(file)
    }
  })
})

/**
 * @failure  Three crash handlers disagreed: one kept a crashed MCP server running, one was registered by a UI library
 *           on construction, one exited without a record. ADR-0031 decision 3 makes one installer that writes one
 *           FATAL `exception` record, flushes inside one budget and always exits 1. These run real Bun child
 *           processes, because the exit code, a closed fd 2 and a hung closer are facts a mocked exit cannot prove.
 * @level    l2 — real child processes under Bun
 * @consumer @i/1-instruments/31167-one-logging-path (tribe recall server; km entries in slice 2)
 * @testonly none
 */

import { spawnSync } from "node:child_process"
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
  existsSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { afterAll, describe, expect, test } from "vitest"
import { installCrashHandler } from "../src/index.ts"

const MODULE = fileURLToPath(new URL("../src/index.ts", import.meta.url))
const SINK_MODULE = fileURLToPath(new URL("../src/sink.ts", import.meta.url))
const BUN = process.execPath.endsWith("bun") ? process.execPath : "bun"
const root = mkdtempSync(join(tmpdir(), "loggily-crash-"))
afterAll(() => rmSync(root, { recursive: true, force: true }))

type Record = {
  level: string
  message: string
  props?: { [key: string]: unknown }
}

let seq = 0
/**
 * Run one scenario in a Bun child. `level` sets the entry logger's threshold; its records are appended, one JSON
 * event per line, to a file the parent reads back. `body` runs after the logger is built and may use `install`.
 */
function run(body: string, level = "info") {
  const dir = join(root, String(seq++))
  const script = join(dir + ".ts")
  const records = dir + ".records.jsonl"
  const marks = dir + ".marks.txt"
  writeFileSync(
    script,
    [
      `import * as loggily from ${JSON.stringify(MODULE)}`,
      `import { appendFileSync, closeSync } from "node:fs"`,
      `import { openLineSink } from ${JSON.stringify(SINK_MODULE)}`,
      `const mark = (text) => appendFileSync(${JSON.stringify(marks)}, text + "\\n")`,
      `const logger = loggily.createLogger("crash-test", [{ level: ${JSON.stringify(level)} }, (event) => {`,
      `  if (globalThis.__sinkThrows) throw new Error("sink exploded")`,
      `  appendFileSync(${JSON.stringify(records)}, JSON.stringify({ level: event.level, message: event.message, props: event.props }) + "\\n")`,
      `  return null`,
      `}])`,
      `const install = (extra = {}) => loggily.installCrashHandler({ logger, ...extra })`,
      body,
    ].join("\n"),
  )
  const started = Date.now()
  const res = spawnSync(BUN, [script], { encoding: "utf8", timeout: 15_000 })
  const elapsedMs = Date.now() - started
  const read = (path: string) =>
    existsSync(path) ? readFileSync(path, "utf8") : ""
  const parsed = read(records)
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Record)
  return {
    status: res.status,
    signal: res.signal,
    stderr: res.stderr,
    stdout: res.stdout,
    records: parsed,
    marks: read(marks),
    elapsedMs,
  }
}

describe("installCrashHandler: one record, one budget, exit 1 (ADR-0031 decision 3)", () => {
  test("an uncaught Error writes one FATAL exception record with its own name, then exits 1", () => {
    const r = run(
      `install(); setTimeout(() => { throw new TypeError("boom") }, 0)`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.records).toHaveLength(1)
    const [record] = r.records
    expect(record).toMatchObject({ level: "fatal", message: "exception" })
    expect(record!.props).toMatchObject({
      "event.name": "exception",
      "exception.type": "TypeError",
      "exception.message": "boom",
    })
    expect(String(record!.props!["exception.stacktrace"])).toContain(
      "TypeError: boom",
    )
  })

  test("a non-Error rejection becomes an Error named UnhandledRejection", () => {
    const r = run(`install(); Promise.reject("plain reason")`)
    expect(r.status, r.stderr).toBe(1)
    expect(r.records[0]!.props).toMatchObject({
      "event.name": "exception",
      "exception.type": "UnhandledRejection",
      "exception.message": "plain reason",
    })
  })

  test("a rejection reason that cannot be printed still produces a record and exit 1", () => {
    const r = run(
      `install(); Promise.reject({ [Symbol.toPrimitive]() { throw new Error("no") } })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.records[0]!.props).toMatchObject({
      "exception.message": "<unprintable rejection reason>",
    })
  })

  test("a restore that throws is named in the record, and the process still exits 1", () => {
    const r = run(
      `install({ restore: () => { throw new Error("tty gone") } }); setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.records[0]!.props).toMatchObject({
      "crash.restore_error": "Error: tty gone",
    })
  })

  test("a logger filtered to silent is not overridden: no record, one plain stderr line, exit 1", () => {
    const r = run(
      `install(); setTimeout(() => { throw new RangeError("quiet") })`,
      "silent",
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.records).toEqual([])
    expect(r.stderr).toContain(
      "uncaught uncaughtException: RangeError: quiet (no FATAL record: the logger's level filter suppresses fatal)",
    )
  })

  test("a sink that throws inside the pipeline is reported by the pipeline's own guard, and exit 1 still wins", () => {
    const r = run(
      `globalThis.__sinkThrows = true; install(); setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain("threw — dropping event, fail-closed")
  })

  test("a fatal call that throws gets the plain failure line, and exit 1 still wins", () => {
    const r = run(
      `loggily.installCrashHandler({ logger: { fatal() { throw new Error("fatal exploded") } } });` +
        ` setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain(
      "uncaught uncaughtException: Error: x (FATAL record failed: Error: fatal exploded)",
    )
  })

  test("with fd 2 closed, the plain line has nowhere to go and the process still exits 1", () => {
    const r = run(
      `install(); closeSync(2); setTimeout(() => { throw new Error("x") })`,
      "silent",
    )
    expect(r.status).toBe(1)
  })

  test("a closer that never settles is cut at the budget while the other closers still run", () => {
    const r = run(
      `install({ timeoutMs: 300, closers: [() => new Promise(() => {}), async (ms) => { mark("second closer ms " + ms) }] });` +
        ` setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    // Started together: the second closer gets most of the budget, not what a hung first one left over.
    const ms = Number(/second closer ms (\S+)/u.exec(r.marks)?.[1])
    expect(ms, r.marks).toBeGreaterThan(150)
    expect(r.stderr).toContain("crash flush: closer 0 timed out")
    expect(r.elapsedMs).toBeLessThan(5_000)
  })

  test("a closer that rejects or throws is reported, never logged, and exit 1 still wins", () => {
    const r = run(
      `install({ closers: [async () => { throw new Error("pending 12") }, () => { throw new Error("sync") }] });` +
        ` setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain(
      "crash flush: closer 0 failed (Error: pending 12)",
    )
    expect(r.stderr).toContain("crash flush: closer 1 failed (Error: sync)")
    expect(r.records).toHaveLength(1)
  })

  test("a real LineSink owner's closer drains its pending lines inside the budget", () => {
    const r = run(
      `const sink = openLineSink({ fd: 2 });` +
        ` for (let i = 0; i < 50; i++) sink.push("sink line " + i + "\\n");` +
        ` install({ closers: [async (ms) => { const { pending } = await sink.close(ms); if (pending > 0) throw new Error("pending " + pending) }] });` +
        ` setTimeout(() => { throw new Error("x") })`,
    )
    expect(r.status, r.stderr).toBe(1)
    expect(r.stderr).toContain("sink line 49")
    expect(r.stderr).not.toContain("crash flush: closer")
  })
})

describe("installCrashHandler: installation (ADR-0031 3b)", () => {
  test("a second install throws, and disposing removes both listeners", () => {
    const before = [
      process.listenerCount("uncaughtException"),
      process.listenerCount("unhandledRejection"),
    ]
    const logger = { fatal: () => {} } as unknown as Parameters<
      typeof installCrashHandler
    >[0]["logger"]
    const first = installCrashHandler({ logger })
    try {
      expect(() => installCrashHandler({ logger })).toThrow(/already installed/)
      expect(process.listenerCount("uncaughtException")).toBe(before[0]! + 1)
    } finally {
      first[Symbol.dispose]()
    }
    expect([
      process.listenerCount("uncaughtException"),
      process.listenerCount("unhandledRejection"),
    ]).toEqual(before)
    installCrashHandler({ logger })[Symbol.dispose]()
  })

  test.each([Number.NaN, Number.POSITIVE_INFINITY, -1])(
    "timeoutMs %s is refused at install",
    (timeoutMs) => {
      const logger = { fatal: () => {} } as unknown as Parameters<
        typeof installCrashHandler
      >[0]["logger"]
      expect(() => installCrashHandler({ logger, timeoutMs })).toThrow(
        TypeError,
      )
    },
  )
})

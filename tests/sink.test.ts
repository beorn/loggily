/**
 * @failure A long-lived Bun service whose stderr reader stalls parks on its next log line: every in-process write
 *          path blocks once the pipe or pty is full, and a watchdog that writes before it kills never kills
 *          (km 25947). The sink must let every producer return at once, keep every line it does write whole, and
 *          announce exactly what it dropped.
 * @level l2
 * @consumer @km/daemon/25947-bd-close-blocks-daemon
 */
import { afterEach, describe, expect, test } from "vitest"
import { spawn } from "node:child_process"
import { once } from "node:events"
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { postSinkLine } from "../src/sink.ts"

const MODULE = fileURLToPath(new URL("../src/sink.ts", import.meta.url))
const roots: string[] = []
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

interface Summary {
  readonly pushedMain: number
  readonly pushedWorker: number
  readonly droppedMain: number
  readonly droppedWorker: number
  readonly droppedTotal: number
  readonly maxPushMsMain: number
  readonly maxPushMsWorker: number
  readonly pendingAtClose: number
}

/**
 * The scenario runs in a REAL child process whose fd 2 is a pipe this test owns, so the stall is a real full pipe:
 * the parent reads nothing for `unreadMs`, then drains until the child exits.
 */
async function scenario(
  body: string,
  unreadMs: number,
  guardMs = 20_000,
): Promise<{
  code: number | null
  signal: string | null
  stderr: string
  summary: Summary
}> {
  const root = mkdtempSync(join(tmpdir(), "loggily-sink-"))
  roots.push(root)
  const script = join(root, "scenario.ts")
  const summaryPath = join(root, "summary.json")
  const progressPath = join(root, "progress.txt")
  writeFileSync(
    script,
    [
      `import { openLineSink, postSinkLine } from ${JSON.stringify(MODULE)}`,
      `import { Worker } from "node:worker_threads"`,
      `import { appendFileSync } from "node:fs"`,
      `const SUMMARY = ${JSON.stringify(summaryPath)}`,
      // Phase marks name where a scenario stopped when it never reaches its summary.
      `const mark = (phase) => appendFileSync(${JSON.stringify(progressPath)}, phase + " " + Date.now() + "\\n")`,
      body,
    ].join("\n"),
  )
  const child = spawn(process.execPath, [script], {
    stdio: ["ignore", "ignore", "pipe"],
  })
  child.stderr.pause()
  await new Promise((resolve) => setTimeout(resolve, unreadMs))
  let stderr = ""
  child.stderr.setEncoding("utf8")
  child.stderr.on("data", (chunk: string) => {
    stderr += chunk
  })
  // A stream paused explicitly does not resume when a data listener is attached; without this the child's writer
  // parks forever and the guard reports a hang that is the test's own.
  child.stderr.resume()
  // A scenario that hangs is killed and reported with its stderr tail, never left to the test's own timeout.
  const started = Date.now()
  const guard = setTimeout(() => child.kill("SIGKILL"), guardMs)
  const [code, signal] = (await once(child, "exit")) as [
    number | null,
    NodeJS.Signals | null,
  ]
  clearTimeout(guard)
  await new Promise((resolve) => setTimeout(resolve, 50))
  let summary: Summary
  try {
    summary = JSON.parse(readFileSync(summaryPath, "utf8")) as Summary
  } catch (error) {
    // No mark means the scenario stopped before its first phase.
    const progress = existsSync(progressPath)
      ? readFileSync(progressPath, "utf8")
      : "(no phase marks)"
    throw new Error(
      `the scenario ended (code ${code}, signal ${signal}) after ${Date.now() - started}ms without a summary (${error instanceof Error ? error.message : String(error)}); phases: ${JSON.stringify(progress)}; stderr tail: ${JSON.stringify(stderr.slice(-400))}`,
    )
  }
  return { code, signal, stderr, summary }
}

// A written line: an optional drop marker, then one of ours. A marker alone is what close writes when drops are still owed.
const LINE =
  /^(?:\((\d+) lines? dropped while fd 2 was blocked for \d+s\)(?: |$))?(M\d+ m{1000}|W\d+ w{1000}|TAIL\d)?$/u

describe("loggily/sink: a line sink that never parks its producers (km 25947)", () => {
  test("pushes from the main thread and a worker into a pipe nobody drains return at once; every line written is whole, none interleave, and the markers add up to the drops exactly", async () => {
    const { code, signal, stderr, summary } = await scenario(
      [
        `const sink = openLineSink({ fd: 2 })`,
        `const producer = sink.producer()`,
        `const worker = new Worker(\``,
        `  const { parentPort, workerData } = require("node:worker_threads")`,
        `  \${postSinkLine.toString()}`,
        `  const control = new Int32Array(workerData.control)`,
        `  const sleeper = new Int32Array(new SharedArrayBuffer(4))`,
        `  let dropped = 0`,
        `  let maxPushMs = 0`,
        `  for (let i = 0; i < 400; i++) {`,
        `    const started = performance.now()`,
        `    if (!postSinkLine(workerData.port, control, "W" + i + " " + "w".repeat(1000) + "\\\\n")) dropped += 1`,
        `    maxPushMs = Math.max(maxPushMs, performance.now() - started)`,
        `    Atomics.wait(sleeper, 0, 0, 2)`,
        `  }`,
        `  parentPort.postMessage({ done: { dropped, maxPushMs } })`,
        `\`, { eval: true, workerData: { port: producer.port, control: producer.control }, transferList: [producer.port] })`,
        // The producer port carries lines only; the test worker reports to the main thread on its own parentPort.
        `const workerDone = new Promise((resolve, reject) => { worker.on("message", resolve); worker.on("error", reject) })`,
        `let droppedMain = 0`,
        `let maxPushMsMain = 0`,
        `let pushedMain = 0`,
        `await new Promise((resolve) => {`,
        `  const tick = setInterval(() => {`,
        `    const started = performance.now()`,
        `    if (!sink.push("M" + pushedMain + " " + "m".repeat(1000) + "\\n")) droppedMain += 1`,
        `    maxPushMsMain = Math.max(maxPushMsMain, performance.now() - started)`,
        `    pushedMain += 1`,
        `    if (pushedMain === 400) { clearInterval(tick); resolve() }`,
        `  }, 2)`,
        `})`,
        `const done = (await workerDone).done`,
        `mark("produced")`,
        // Wait for the reader to drain what was accepted, then push tail lines so the drop marker lands on one.
        `const until = Date.now() + 10_000`,
        `while (sink.pending() > 0 && Date.now() < until) await new Promise((resolve) => setTimeout(resolve, 5))`,
        `mark("drained pending=" + sink.pending())`,
        `for (let i = 0; i < 3; i++) sink.push("TAIL" + i + "\\n")`,
        `const closed = await sink.close(2_000)`,
        `mark("closed pending=" + closed.pending)`,
        `const { writeFileSync } = await import("node:fs")`,
        `writeFileSync(SUMMARY, JSON.stringify({ pushedMain, pushedWorker: 400, droppedMain, droppedWorker: done.dropped, droppedTotal: sink.dropped(), maxPushMsMain, maxPushMsWorker: done.maxPushMs, pendingAtClose: closed.pending }))`,
      ].join("\n"),
      1_500,
    )
    expect(signal ?? code, stderr.slice(-300)).toBe(0)
    expect(summary.droppedTotal).toBe(
      summary.droppedMain + summary.droppedWorker,
    )
    // 800 KiB pushed against a 64 KiB pipe and a 64 KiB bound while nothing read for 1.5 s: drops are certain.
    expect(summary.droppedTotal).toBeGreaterThan(0)
    expect(summary.maxPushMsMain).toBeLessThan(50)
    expect(summary.maxPushMsWorker).toBeLessThan(50)
    expect(summary.pendingAtClose).toBe(0)
    const lines = stderr.split("\n")
    expect(lines.at(-1)).toBe("")
    lines.pop()
    let markers = 0
    let written = 0
    for (const line of lines) {
      const match = LINE.exec(line)
      expect(
        match !== null && (match[1] !== undefined || match[2] !== undefined),
        `a line that is not whole or not ours: ${JSON.stringify(line.slice(0, 120))}`,
      ).toBe(true)
      if (match?.[1] !== undefined) markers += Number(match[1])
      if (match?.[2] !== undefined && !match[2].startsWith("TAIL")) written += 1
    }
    expect(markers).toBe(summary.droppedTotal)
    expect(written).toBe(
      summary.pushedMain + summary.pushedWorker - summary.droppedTotal,
    )
    // Both producers got lines through.
    expect(lines.some((line) => /(^|\) )M\d+ /u.test(line))).toBe(true)
    expect(lines.some((line) => /(^|\) )W\d+ /u.test(line))).toBe(true)
  }, 60_000)

  test("a full non-blocking fd answers EAGAIN: the writer waits it out on its own thread, the producer keeps running, and the process exits on its own", async () => {
    // Measured 2026-10-17 with strace: the pipe a Bun parent opens for a child is non-blocking, so the writer's
    // write(2) answered EAGAIN once the pipe was full; a writer that threw on it died, its main-thread notice threw
    // EAGAIN too, and Bun's error printer parked the main thread in poll(fd 2, POLLOUT, -1) for good. The child
    // builds that fd itself: a FIFO it opens non-blocking at both ends and never reads.
    const root = mkdtempSync(join(tmpdir(), "loggily-sink-"))
    roots.push(root)
    const script = join(root, "never-drained.ts")
    const summaryPath = join(root, "summary.json")
    const fifo = join(root, "unread.fifo")
    writeFileSync(
      script,
      [
        `import { openLineSink } from ${JSON.stringify(MODULE)}`,
        `import { execFileSync } from "node:child_process"`,
        `import { constants, openSync, writeFileSync } from "node:fs"`,
        `execFileSync("mkfifo", [${JSON.stringify(fifo)}])`,
        `openSync(${JSON.stringify(fifo)}, constants.O_RDONLY | constants.O_NONBLOCK)`,
        `const fd = openSync(${JSON.stringify(fifo)}, constants.O_WRONLY | constants.O_NONBLOCK)`,
        `const sink = openLineSink({ fd })`,
        `const pad = "x".repeat(1000)`,
        `for (let i = 0; i < 400; i++) sink.push("B" + i + " " + pad + "\\n")`,
        `let ticks = 0`,
        `const timer = setInterval(() => {`,
        `  sink.push("T" + ticks + " " + pad + "\\n")`,
        `  ticks += 1`,
        `  if (ticks === 5) {`,
        `    clearInterval(timer)`,
        `    writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({ ticks, dropped: sink.dropped(), pending: sink.pending() }))`,
        `    process.exit(0)`,
        `  }`,
        `}, 100)`,
      ].join("\n"),
    )
    const child = spawn(process.execPath, [script], {
      stdio: ["ignore", "ignore", "pipe"],
    })
    let stderr = ""
    child.stderr.setEncoding("utf8")
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
    })
    const guard = setTimeout(() => child.kill("SIGKILL"), 10_000)
    const [code, signal] = (await once(child, "exit")) as [
      number | null,
      NodeJS.Signals | null,
    ]
    clearTimeout(guard)
    const summary = existsSync(summaryPath)
      ? readFileSync(summaryPath, "utf8")
      : "(none)"
    expect(
      { code, signal },
      `the child must end on its own with its summary; got ${summary}; stderr ${JSON.stringify(stderr.slice(-300))}`,
    ).toEqual({ code: 0, signal: null })
    const parsed = JSON.parse(summary) as {
      ticks: number
      dropped: number
      pending: number
    }
    expect(parsed.ticks).toBe(5)
    // The FIFO took its 64 KiB and the bound held the rest: the writer is parked in its retry, nothing was lost silently.
    expect(parsed.dropped).toBeGreaterThan(0)
    expect(parsed.pending).toBeGreaterThan(0)
    expect(stderr, "the writer must not have died").not.toContain(
      "loggily sink:",
    )
  }, 30_000)

  test("a line dropped at the bound is refused at once, counted, and the control slots say so", () => {
    const control = new Int32Array(
      new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * 7),
    )
    Atomics.store(control, 3, 16)
    Atomics.store(control, 6, (Date.now() / 1000) | 0)
    const posted: unknown[] = []
    const port = { postMessage: (value: unknown) => posted.push(value) }
    expect(postSinkLine(port, control, "0123456789\n")).toBe(true)
    expect(Atomics.load(control, 0)).toBe(11)
    expect(postSinkLine(port, control, "0123456789\n")).toBe(false)
    expect(Atomics.load(control, 0)).toBe(11)
    expect(Atomics.load(control, 1)).toBe(1)
    expect(Atomics.load(control, 4)).toBe(1)
    expect(Atomics.load(control, 2)).toBeGreaterThan(0)
    expect(posted).toHaveLength(1)
  })
})

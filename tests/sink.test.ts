/**
 * @failure A long-lived Bun service whose stderr reader stalls parks on its next log line: every in-process write
 *          path blocks once the pipe or pty is full, and a watchdog that writes before it kills never kills
 *          (km 25947). The sink must let every producer return at once, keep every line it does write whole, and
 *          announce exactly what it dropped.
 * @level l2
 * @consumer @km/daemon/25947-bd-close-blocks-daemon
 * @testonly none
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

/** The 1000-byte filler every scenario line carries after its tag. */
const pad = (n: number): string => "x".repeat(n)

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

  test("a full non-blocking fd answers EAGAIN: the writer waits it out on its own thread, the producer keeps running, and once the reader drains, every pending line is written with the drop marker on a later line", async () => {
    // Measured 2026-10-17 with strace: Bun sets O_NONBLOCK on its fd 2 when that is a pipe, so the writer's write(2)
    // answered EAGAIN once the pipe was full; a writer that threw on it died, its main-thread notice threw EAGAIN
    // too, and Bun's error printer parked the main thread in poll(fd 2, POLLOUT, -1) for good. The child builds that
    // fd itself: a FIFO it opens non-blocking at both ends and reads only after the burst. A writer that died during
    // the stall would leave the bound's worth pending for good and no later line, so this row fails for that bug.
    const root = mkdtempSync(join(tmpdir(), "loggily-sink-"))
    roots.push(root)
    const script = join(root, "drained-later.ts")
    const summaryPath = join(root, "summary.json")
    const fifo = join(root, "unread.fifo")
    writeFileSync(
      script,
      [
        `import { openLineSink } from ${JSON.stringify(MODULE)}`,
        `import { execFileSync } from "node:child_process"`,
        `import { constants, openSync, readSync, writeFileSync } from "node:fs"`,
        `execFileSync("mkfifo", [${JSON.stringify(fifo)}])`,
        `const rfd = openSync(${JSON.stringify(fifo)}, constants.O_RDONLY | constants.O_NONBLOCK)`,
        `const fd = openSync(${JSON.stringify(fifo)}, constants.O_WRONLY | constants.O_NONBLOCK)`,
        `const sink = openLineSink({ fd })`,
        `const pad = "x".repeat(1000)`,
        `for (let i = 0; i < 400; i++) sink.push("B" + i + " " + pad + "\\n")`,
        `const atBurst = { dropped: sink.dropped(), pending: sink.pending() }`,
        `let text = ""`,
        `const buf = Buffer.alloc(65536)`,
        `const drain = () => {`,
        `  for (;;) {`,
        `    let n = 0`,
        `    try {`,
        `      n = readSync(rfd, buf, 0, buf.length, null)`,
        `    } catch (error) {`,
        `      if (error !== null && typeof error === "object" && error.code === "EAGAIN") return`,
        `      throw error`,
        `    }`,
        `    if (n === 0) return`,
        `    text += buf.toString("utf8", 0, n)`,
        `  }`,
        `}`,
        `let ticks = 0`,
        `const timer = setInterval(() => {`,
        `  drain()`,
        // A tick line goes only once the writer has put everything out and the sink takes it: pushed while the
        // writer still backs off (up to 50 ms) with the bound nearly full, it is dropped as designed, and this row
        // is about later lines arriving whole, not about the bound.
        `  if (ticks < 5) {`,
        `    if (sink.pending() > 0 || !sink.push("T" + ticks + " " + pad + "\\n")) return`,
        `    ticks += 1`,
        `    return`,
        `  }`,
        `  if (sink.pending() > 0 || !text.includes("T4 " + pad + "\\n")) return`,
        `  drain()`,
        `  clearInterval(timer)`,
        `  writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({ atBurst, ticks, dropped: sink.dropped(), pending: sink.pending(), text }))`,
        `  process.exit(0)`,
        `}, 20)`,
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
    const guard = setTimeout(() => child.kill("SIGKILL"), 15_000)
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
      `the child must end on its own with its summary; got ${summary.slice(0, 300)}; stderr ${JSON.stringify(stderr.slice(-300))}`,
    ).toEqual({ code: 0, signal: null })
    const parsed = JSON.parse(summary) as {
      atBurst: { dropped: number; pending: number }
      ticks: number
      dropped: number
      pending: number
      text: string
    }
    expect(parsed.ticks).toBe(5)
    // The FIFO took its 64 KiB and the bound held the rest: during the stall the writer waited, nothing was lost silently.
    expect(parsed.atBurst.dropped).toBeGreaterThan(0)
    expect(parsed.atBurst.pending).toBeGreaterThan(0)
    // Once the reader drained, the writer put every pending byte out and the later lines arrived whole.
    expect(parsed.pending).toBe(0)
    for (let i = 0; i < 5; i++) {
      expect(
        parsed.text,
        `tick line T${i} must have been written whole`,
      ).toContain(`\nT${i} ${pad(1000)}\n`)
    }
    // Every drop recorded during the burst was announced on a later line, as the marker before one of ours.
    const markers = [
      ...parsed.text.matchAll(
        /\((\d+) lines? dropped while fd \d+ was blocked for \d+s\) [BT]\d+ /gu,
      ),
    ]
    expect(
      markers.length,
      `the drop marker must prefix a later line; text tail ${JSON.stringify(parsed.text.slice(-200))}`,
    ).toBeGreaterThan(0)
    const announced = markers.reduce((sum, m) => sum + Number(m[1]), 0)
    expect(announced).toBeGreaterThanOrEqual(parsed.atBurst.dropped)
    expect(announced).toBeLessThanOrEqual(parsed.dropped)
    // The sink's notice goes to the fd it writes, the FIFO, so a dead writer shows in the text read from it.
    expect(parsed.text, "the writer must not have died").not.toContain(
      "loggily sink:",
    )
  }, 30_000)

  test("a reader that goes away (EPIPE) ends the writer: onWriterGone fires once with the reason, the producer keeps running, and the process exits on its own", async () => {
    // The sink's own notice goes to the fd that just failed, so without this signal the owner learns nothing and
    // every later line goes nowhere. The child closes the FIFO's only read end itself, then keeps pushing.
    const root = mkdtempSync(join(tmpdir(), "loggily-sink-"))
    roots.push(root)
    const script = join(root, "reader-gone.ts")
    const summaryPath = join(root, "summary.json")
    const fifo = join(root, "gone.fifo")
    writeFileSync(
      script,
      [
        `import { openLineSink } from ${JSON.stringify(MODULE)}`,
        `import { execFileSync } from "node:child_process"`,
        `import { closeSync, constants, openSync, writeFileSync } from "node:fs"`,
        `execFileSync("mkfifo", [${JSON.stringify(fifo)}])`,
        `const rfd = openSync(${JSON.stringify(fifo)}, constants.O_RDONLY | constants.O_NONBLOCK)`,
        `const fd = openSync(${JSON.stringify(fifo)}, constants.O_WRONLY | constants.O_NONBLOCK)`,
        `const reasons = []`,
        `const sink = openLineSink({ fd, onWriterGone: (reason) => reasons.push(reason) })`,
        `sink.push("before the reader left\\n")`,
        `closeSync(rfd)`,
        `let pushes = 0`,
        `let sinceGone = -1`,
        `const timer = setInterval(() => {`,
        `  sink.push("after the reader left " + pushes + "\\n")`,
        `  pushes += 1`,
        `  if (reasons.length > 0) sinceGone += 1`,
        `  if (sinceGone < 20 && pushes < 300) return`,
        `  clearInterval(timer)`,
        `  writeFileSync(${JSON.stringify(summaryPath)}, JSON.stringify({ reasons, pushes, pending: sink.pending() }))`,
        `  process.exit(0)`,
        `}, 10)`,
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
    const guard = setTimeout(() => child.kill("SIGKILL"), 15_000)
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
      reasons: string[]
      pushes: number
      pending: number
    }
    expect(parsed.reasons, "the owner is told exactly once").toHaveLength(1)
    expect(parsed.reasons[0]).toMatch(/EPIPE/u)
    expect(parsed.pushes).toBeGreaterThan(20)
    // The notice went to the dead fd, never to this process's real stderr, and nothing parked.
    expect(stderr).not.toContain("loggily sink:")
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

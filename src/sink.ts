/**
 * `loggily/sink`: a line sink that never parks the thread writing to it (km 25947).
 *
 * Under Bun (measured 1.4.3) every in-process write to a pipe or pty whose
 * reader has stalled parks the writer in the kernel once ~10 KB (pty) or
 * 64 KiB (pipe) sits unread: console.error, process.stderr.write, fs.writeSync
 * and Bun.stderr.writer() alike, on the main thread and in a worker. A
 * long-lived service whose fd 2 is a supervisor's capture therefore wedges
 * with its reader, and a watchdog that writes its kill line the same way never
 * kills. A non-blocking fd (the pipe a Bun or Node parent opens for a child)
 * answers EAGAIN instead of parking, and a thrown EAGAIN is the same wedge one
 * step later: the uncaught error is printed to the same full fd. This sink
 * moves the one blocking write to a writer worker: producers
 * post whole lines over a MessagePort and return at once, and a shared Atomics
 * byte counter bounds what is pending ({@link LINE_SINK_PENDING_BYTES}). A
 * line that would cross the bound is dropped and counted, never waited for,
 * and the next line the writer puts out carries
 * `(N lines dropped while fd 2 was blocked for Xs)`: a bounded queue with
 * surfaced drops, never a silent eviction (invariants I21/I22, as inhab's
 * pty-output-queue applies them). Only a copy that goes through this sink can
 * drop; a file writer beside it keeps every line.
 *
 * Node and Bun only: this module imports node:worker_threads, and loggily's
 * main entry never does.
 */
import { writeSync } from "node:fs"
import { MessageChannel, Worker, type MessagePort } from "node:worker_threads"

/** Bytes a sink lets producers have in flight; a line past that is dropped and counted. */
export const LINE_SINK_PENDING_BYTES = 65_536

/** How long {@link LineSink.close} waits for the pending bytes to drain before the writer is stopped. */
export const LINE_SINK_CLOSE_DRAIN_MS = 500

// The control slots, shared by every producer and the writer: 0 pending bytes, 1 lines dropped since the last marker,
// 2 the first drop's time as seconds since the sink opened plus one (0 = none), 3 the bound, 4 lines dropped in all,
// 5 the closed flag, 6 the sink's open time. Times are epoch seconds wrapped to int32 (`| 0`), and only their
// differences are read, so they stay right for 68 years from any open, not until January 2038. postSinkLine and the
// writer source address the slots by number, because both must reference nothing outside themselves.
const PENDING = 0
const BOUND = 3
const DROPPED_TOTAL = 4
const CLOSED = 5
const OPENED = 6
const CONTROL_SLOTS = 7

/** What a producer on another thread needs: the port to post on (transfer it) and the control buffer. */
export interface LineSinkProducer {
  readonly port: MessagePort
  readonly control: SharedArrayBuffer
}

export interface LineSink {
  /** Post one line from this thread; returns at once, false when the line was dropped at the bound. */
  push(line: string): boolean
  /** A port and the control buffer for a producer on another thread; hand both over with the port transferred. */
  producer(): LineSinkProducer
  /** Bytes posted and not yet written. */
  pending(): number
  /** Lines dropped at the bound since the sink opened, from every producer. */
  dropped(): number
  /**
   * Ask the writer to put a pending drop marker out, wait at most `timeoutMs`
   * for the pending bytes to reach zero, then stop the writer. A writer parked
   * in a write stays parked until the process ends; only the sink's copy of
   * what was pending is lost then.
   */
  close(timeoutMs?: number): Promise<{ readonly pending: number }>
}

export interface LineSinkOptions {
  /** The file descriptor the writer writes to, 2 for stderr. */
  readonly fd: number
  /** The pending-byte bound; {@link LINE_SINK_PENDING_BYTES} by default. */
  readonly pendingBytes?: number
}

/**
 * Post one line through a producer port, from any thread. Returns at once:
 * true when the line is in flight, false when it was dropped because the
 * pending bytes would cross the bound. It references nothing outside itself,
 * so a worker built from source text can embed it with `toString()`.
 */
export function postSinkLine(
  port: {
    postMessage(value: unknown, transfer?: readonly ArrayBuffer[]): void
  },
  control: Int32Array,
  text: string,
): boolean {
  const bytes = new TextEncoder().encode(text)
  const was = Atomics.add(control, 0, bytes.length)
  if (was + bytes.length > Atomics.load(control, 3)) {
    Atomics.sub(control, 0, bytes.length)
    Atomics.add(control, 1, 1)
    Atomics.add(control, 4, 1)
    const sinceOpen = ((Date.now() / 1000) | 0) - Atomics.load(control, 6)
    Atomics.compareExchange(control, 2, 0, (sinceOpen | 0) + 1)
    return false
  }
  port.postMessage(bytes, [bytes.buffer])
  return true
}

/**
 * The writer worker, as source: it runs via `eval`, loads nothing, and owns
 * the one blocking write. It may park inside that write for as long as the
 * reader stalls; nothing else does. Pending bytes come off the counter only
 * once the kernel took the whole line, so a zero counter means written.
 */
export const LINE_SINK_WORKER_SOURCE = `
const { writeSync } = require("node:fs")
const { parentPort, workerData } = require("node:worker_threads")
const control = new Int32Array(workerData.control)
const fd = workerData.fd
const encoder = new TextEncoder()
const sleeper = new Int32Array(new SharedArrayBuffer(4))
const write = (bytes) => {
  let offset = 0
  while (offset < bytes.length) {
    try {
      offset += writeSync(fd, bytes, offset, bytes.length - offset)
    } catch (error) {
      // A non-blocking fd whose reader stalled answers EAGAIN instead of parking the caller: wait here, on this
      // thread only, and retry; the bound and the drop count hold exactly as for a parked write. Anything else
      // (EPIPE: the reader is gone) ends the writer, and the main thread says so once.
      const code = error !== null && typeof error === "object" ? error.code : undefined
      if (code === "EAGAIN" || code === "EWOULDBLOCK") {
        Atomics.wait(sleeper, 0, 0, 2)
        continue
      }
      throw error
    }
  }
}
const marker = () => {
  const dropped = Atomics.exchange(control, 1, 0)
  if (dropped === 0) return null
  const first = Atomics.exchange(control, 2, 0)
  const now = (((Date.now() / 1000) | 0) - Atomics.load(control, 6)) | 0
  const blockedS = first > 0 ? Math.max(0, now - (first - 1)) : 0
  return "(" + dropped + " line" + (dropped === 1 ? "" : "s") + " dropped while fd " + fd + " was blocked for " + blockedS + "s)"
}
const onLine = (bytes) => {
  const prefix = marker()
  if (prefix !== null) write(encoder.encode(prefix + " "))
  write(bytes)
  Atomics.sub(control, 0, bytes.length)
  Atomics.notify(control, 0)
}
const onMessage = (message) => {
  if (message instanceof Uint8Array) onLine(message)
  else if (message !== null && typeof message === "object" && message.port !== undefined) listen(message.port)
  else if (message !== null && typeof message === "object" && message.close === true) {
    const prefix = marker()
    if (prefix !== null) write(encoder.encode(prefix + "\\n"))
    // The ack goes through shared memory, not a message: a main-thread message listener on an unref'd worker keeps a
    // finished Bun process alive (measured 1.4.3), and this sink must cost a fast process nothing.
    Atomics.store(control, 5, 1)
    Atomics.notify(control, 5)
  }
}
const listen = (port) => {
  if (typeof port.on === "function") port.on("message", onMessage)
  else port.onmessage = (event) => onMessage(event.data)
}
listen(parentPort)
`

/** Open a sink on `fd`: one writer worker, unref'd so it never keeps a finished process alive. */
export function openLineSink(options: LineSinkOptions): LineSink {
  const bound = options.pendingBytes ?? LINE_SINK_PENDING_BYTES
  if (!Number.isInteger(bound) || bound <= 0) {
    throw new Error(
      `loggily sink: pendingBytes must be a positive whole number, got ${String(options.pendingBytes)}`,
    )
  }
  const controlBuffer = new SharedArrayBuffer(
    Int32Array.BYTES_PER_ELEMENT * CONTROL_SLOTS,
  )
  const control = new Int32Array(controlBuffer)
  Atomics.store(control, BOUND, bound)
  Atomics.store(control, OPENED, (Date.now() / 1000) | 0)
  const worker = new Worker(LINE_SINK_WORKER_SOURCE, {
    eval: true,
    workerData: { fd: options.fd, control: controlBuffer },
  })
  worker.unref()
  let closed = false
  // A writer that dies leaves every producer posting into nothing: say so once, on the fd itself, best effort. The
  // notice never throws and never retries: a full non-blocking fd (EAGAIN) or a gone reader (EPIPE) drops it, and a
  // file writer beside the sink still holds every line. The residual: on a BLOCKING fd whose reader stalled, this
  // one direct write parks the main thread, the same as a direct stderr write does today.
  const notice = (text: string): void => {
    try {
      writeSync(options.fd, text)
    } catch {
      // silent-fallback-allow: the notice is best effort. A full non-blocking fd (EAGAIN) or a gone reader (EPIPE)
      // drops it, and nothing on this thread may wait for fd 2: waiting here is the stall the sink exists to end.
    }
  }
  worker.on("error", (error: unknown) => {
    const reason = error instanceof Error ? error.message : String(error)
    notice(
      `loggily sink: its writer failed, so lines to fd ${options.fd} stop here: ${reason}\n`,
    )
  })
  worker.on("exit", (code: number) => {
    if (closed) return
    notice(
      `loggily sink: its writer exited (code ${code}), so lines to fd ${options.fd} stop here\n`,
    )
  })
  return {
    push: (line) => postSinkLine(worker, control, line),
    producer: () => {
      const { port1, port2 } = new MessageChannel()
      worker.postMessage({ port: port1 }, [port1])
      return { port: port2, control: controlBuffer }
    },
    pending: () => Atomics.load(control, PENDING),
    dropped: () => Atomics.load(control, DROPPED_TOTAL),
    close: async (timeoutMs = LINE_SINK_CLOSE_DRAIN_MS) => {
      closed = true
      worker.postMessage({ close: true })
      const deadline = Date.now() + timeoutMs
      while (
        (Atomics.load(control, PENDING) > 0 ||
          Atomics.load(control, CLOSED) === 0) &&
        Date.now() < deadline
      ) {
        await new Promise<void>((resolve) => {
          setTimeout(resolve, 5)
        })
      }
      // A writer parked in a write does not answer terminate until the write returns: never await it.
      void worker.terminate()
      return { pending: Atomics.load(control, PENDING) }
    },
  }
}

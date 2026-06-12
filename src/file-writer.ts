/**
 * File writer for loggily — Node.js/Bun only.
 *
 * Separated from core logger to allow tree-shaking in browser bundles.
 * Uses dynamic import("node:fs") to avoid static dependency on Node APIs.
 */

import { openSync, writeSync, closeSync } from "node:fs"

/** Options for creating an async buffered file writer */
export interface FileWriterOptions {
  /** Buffer size threshold in bytes before flushing (default: 4096) */
  bufferSize?: number
  /** Flush interval in milliseconds (default: 100) */
  flushInterval?: number
  /** Test-only filesystem injection. Production callers should omit this. */
  __fs?: {
    openSync(path: string, flags: string): number
    writeSync(fd: number, data: string): unknown
    closeSync(fd: number): void
  }
}

/** An async buffered file writer with automatic flushing */
export interface FileWriter {
  /** Write a line to the buffer (appends newline) */
  write(line: string): void
  /** Flush the buffer immediately */
  flush(): void
  /** Close the writer and flush remaining buffer */
  close(): void
}

/**
 * Create an async buffered file writer for log output.
 * Buffers writes and flushes on size threshold or interval.
 * Registers a process.on('exit') handler to flush remaining buffer.
 *
 * **Node.js/Bun only** — not available in browser environments.
 *
 * @param filePath - Path to the log file (opened in append mode)
 * @param options - Buffer size and flush interval configuration
 * @returns FileWriter with write, flush, and close methods
 *
 * @example
 * const writer = createFileWriter('/tmp/app.log')
 * const unsubscribe = addWriter((formatted) => writer.write(formatted))
 *
 * // On shutdown:
 * unsubscribe()
 * writer.close()
 */
export function createFileWriter(
  filePath: string,
  options: FileWriterOptions = {},
): FileWriter {
  const bufferSize = options.bufferSize ?? 4096
  const flushInterval = options.flushInterval ?? 100
  const fs = options.__fs ?? { openSync, writeSync, closeSync }

  let buffer = ""
  let fd: number | null = null
  let timer: ReturnType<typeof setInterval> | null = null
  let closed = false

  // Std-stream paths (DEBUG_LOG=/dev/stderr et al.) bind the already-open
  // descriptor instead of re-opening the device node: openSync("/dev/stderr",
  // "a") works on macOS but throws ENXIO on Linux whenever stderr is a pipe
  // (CI runners). The borrowed fd is never closed — it belongs to the process.
  const stdFd = stdStreamFd(filePath)

  // Open file in append mode (regular paths only)
  fd = stdFd ?? fs.openSync(filePath, "a")

  /** Flush buffer contents to disk synchronously */
  function flush(): void {
    if (buffer.length === 0 || fd === null) return
    const data = buffer
    fs.writeSync(fd, data)
    buffer = ""
  }

  // Set up periodic flush
  timer = setInterval(flush, flushInterval)
  // Don't let the timer keep the process alive
  if (timer && typeof timer === "object" && "unref" in timer) {
    ;(timer as { unref(): void }).unref()
  }

  // Flush on process exit to avoid data loss
  const exitHandler = (): void => flush()
  process.on("exit", exitHandler)

  return {
    write(line: string): void {
      if (closed) return
      buffer += line + "\n"
      if (buffer.length >= bufferSize) {
        flush()
      }
    },

    flush,

    close(): void {
      if (closed) return
      closed = true
      if (timer !== null) {
        clearInterval(timer)
        timer = null
      }
      try {
        flush()
      } catch {
        // Swallow flush errors during close — data loss is unavoidable
        // at this point, but we must still release the fd and exit handler.
      } finally {
        if (fd !== null) {
          // Borrowed std-stream descriptors stay open — closing fd 1/2 would
          // sever the whole process's stdout/stderr.
          if (stdFd === null) fs.closeSync(fd)
          fd = null
        }
        process.removeListener("exit", exitHandler)
      }
    },
  }
}

/**
 * Map a std-stream pseudo-path to its file descriptor, or null for regular
 * paths. Covers the portable spellings: /dev/stdout, /dev/stderr, /dev/fd/N
 * (macOS + Linux), /proc/self/fd/N (Linux).
 */
function stdStreamFd(filePath: string): number | null {
  if (filePath === "/dev/stdout") return 1
  if (filePath === "/dev/stderr") return 2
  const m = /^(?:\/dev\/fd|\/proc\/self\/fd)\/(\d+)$/.exec(filePath)
  return m ? Number(m[1]) : null
}

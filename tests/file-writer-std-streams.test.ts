/**
 * Tests for std-stream paths in createFileWriter.
 *
 * `DEBUG_LOG=/dev/stderr` is a documented diagnostic recipe (stream loggily
 * output to the terminal when a TUI owns stdout). Opening `/dev/stderr` with
 * `openSync(path, "a")` works on macOS but throws ENXIO on Linux whenever
 * stderr is a pipe (GitHub Actions runners, most CI). The writer must bind
 * the already-open file descriptor for std-stream paths instead of
 * re-opening the device node — and must never close that fd.
 */

import { describe, test, expect, beforeEach, vi } from "vitest"
import { createFileWriter } from "../src/file-writer.ts"

const mockOpenSync = vi.fn((_path?: string, _flags?: string) => 42)
const mockWriteSync = vi.fn()
const mockCloseSync = vi.fn()

const mockFs = {
  openSync: mockOpenSync,
  writeSync: mockWriteSync,
  closeSync: mockCloseSync,
}

describe("file-writer std-stream paths", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenSync.mockReturnValue(42)
    mockWriteSync.mockReturnValue(0)
    mockCloseSync.mockReturnValue(undefined)
  })

  test.each([
    ["/dev/stderr", 2],
    ["/dev/stdout", 1],
    ["/dev/fd/7", 7],
    ["/proc/self/fd/5", 5],
  ])(
    "%s binds fd %i without openSync (ENXIO on Linux pipe-backed std streams)",
    (path, fd) => {
      // CI repro: openSync on a pipe-backed /dev/stderr throws ENXIO. If the
      // writer never calls openSync for std-stream paths, this mock is inert.
      mockOpenSync.mockImplementation(() => {
        const err = new Error(
          `ENXIO: no such device or address, open '${path}'`,
        ) as NodeJS.ErrnoException
        err.code = "ENXIO"
        throw err
      })

      const writer = createFileWriter(path, {
        bufferSize: 999999,
        flushInterval: 60000,
        __fs: mockFs,
      })
      writer.write("hello")
      writer.flush()

      expect(mockOpenSync).not.toHaveBeenCalled()
      expect(mockWriteSync).toHaveBeenCalledWith(fd, "hello\n")

      // Closing the writer must NOT close the process's std fd.
      writer.close()
      expect(mockCloseSync).not.toHaveBeenCalled()
    },
  )

  test("regular paths still open, write, and close their own fd", () => {
    const writer = createFileWriter("/tmp/regular.log", {
      bufferSize: 999999,
      flushInterval: 60000,
      __fs: mockFs,
    })
    writer.write("line")
    writer.flush()
    writer.close()

    expect(mockOpenSync).toHaveBeenCalledWith("/tmp/regular.log", "a")
    expect(mockWriteSync).toHaveBeenCalledWith(42, "line\n")
    expect(mockCloseSync).toHaveBeenCalledWith(42)
  })

  test("windows-style or relative paths are not mistaken for std streams", () => {
    const writer = createFileWriter("dev/stderr", {
      bufferSize: 999999,
      flushInterval: 60000,
      __fs: mockFs,
    })
    writer.write("x")
    writer.close()
    expect(mockOpenSync).toHaveBeenCalledWith("dev/stderr", "a")
    expect(mockCloseSync).toHaveBeenCalledWith(42)
  })
})

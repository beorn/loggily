/**
 * Tests for file-writer safety:
 * - Buffer is NOT cleared before writeSync succeeds (data loss prevention)
 * - close() always runs cleanup (closeSync + removeListener) even if flush() throws
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"

// Mock node:fs to control writeSync behavior
const mockOpenSync = vi.fn((_path?: string, _flags?: string) => 42) // fake fd
const mockWriteSync = vi.fn()
const mockCloseSync = vi.fn()

vi.mock("node:fs", () => ({
  openSync: (path: string, flags: string) => mockOpenSync(path, flags),
  writeSync: (fd: number, data: string) => mockWriteSync(fd, data),
  closeSync: (fd: number) => mockCloseSync(fd),
}))

// Import AFTER mock setup
const { createFileWriter } = await import("../src/file-writer.ts")

describe("file-writer safety", () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockOpenSync.mockReturnValue(42)
    mockWriteSync.mockReturnValue(0)
    mockCloseSync.mockReturnValue(undefined)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  test("buffer is preserved when writeSync throws", () => {
    const writer = createFileWriter("/fake/path.log", {
      bufferSize: 999999,
      flushInterval: 60000,
    })

    // Write some data
    writer.write("important data")

    // Make writeSync throw on next call
    mockWriteSync.mockImplementationOnce(() => {
      throw new Error("disk full")
    })

    // Flush should throw but buffer should be preserved
    expect(() => writer.flush()).toThrow("disk full")

    // Restore writeSync to succeed
    mockWriteSync.mockReturnValue(0)

    // Flush again — data should still be in buffer since it was preserved
    writer.flush()

    // writeSync should have been called twice: once failing, once succeeding
    expect(mockWriteSync).toHaveBeenCalledTimes(2)
    // The second successful call should contain the original data
    const secondCallData = mockWriteSync.mock.calls[1]![1]
    expect(secondCallData).toContain("important data")

    writer.close()
  })

  test("close() runs closeSync and removeListener even when flush() throws", () => {
    const writer = createFileWriter("/fake/path.log", {
      bufferSize: 999999,
      flushInterval: 60000,
    })
    writer.write("some data")

    // Make writeSync always throw so flush() fails during close()
    mockWriteSync.mockImplementation(() => {
      throw new Error("disk full")
    })

    const removeListenerSpy = vi.spyOn(process, "removeListener")

    // close() should not throw even though flush() fails internally
    expect(() => writer.close()).not.toThrow()

    // closeSync should have been called (fd cleanup)
    expect(mockCloseSync).toHaveBeenCalledWith(42)
    // exit handler should have been removed
    expect(removeListenerSpy).toHaveBeenCalledWith("exit", expect.any(Function))

    removeListenerSpy.mockRestore()
  })
})

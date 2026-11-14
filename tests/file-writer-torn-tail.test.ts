/**
 * @failure A second writer appends its record onto a torn tail, so the next
 *          JSON line shares the damaged physical line and a reader can drop it.
 * @level l1
 * @consumer @ag/hab/28010-controller-survives-kill-oom-reboot/33944-reboot-left-services-down/34294-start-loggily-records-on-a-new
 * @testonly none
 */

import {
  appendFileSync,
  chmodSync,
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
  writeSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { createFileWriter } from "../src/file-writer.ts"

const record = (msg: string) => `{"msg":${JSON.stringify(msg)}}`

function countingFs(writes: string[]) {
  return {
    openSync,
    writeSync(fd: number, data: string) {
      writes.push(data)
      return writeSync(fd, data)
    },
    closeSync,
  }
}

describe("file writer torn tail", () => {
  let dir = ""
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
  })

  test("a second writer starts on a new line after a 32-NUL tail", () => {
    dir = mkdtempSync(join(tmpdir(), "loggily-torn-"))
    const path = join(dir, "daemon.log")
    const first = createFileWriter(path, {
      bufferSize: 1,
      flushInterval: 60_000,
    })
    first.write(record("A"))
    first.close()
    appendFileSync(path, Buffer.alloc(32))
    const torn = readFileSync(path)
    const writes: string[] = []
    const second = createFileWriter(path, {
      bufferSize: 1,
      flushInterval: 60_000,
      __fs: countingFs(writes),
    })
    second.write(record("B"))
    second.write(record("C"))
    second.close()
    const bytes = readFileSync(path)
    const b = Buffer.from(`${record("B")}\n`)
    const at = bytes.lastIndexOf(b)
    expect(at).toBeGreaterThan(0)
    expect(bytes[at - 1]).toBe(0x0a)
    expect(bytes.subarray(0, torn.length)).toEqual(torn)
    expect(writes).toEqual([`\n${record("B")}\n`, `${record("C")}\n`])
  })

  test("an empty file gains no boundary newline", () => {
    dir = mkdtempSync(join(tmpdir(), "loggily-empty-"))
    const path = join(dir, "daemon.log")
    writeFileSync(path, "")
    const writes: string[] = []
    const writer = createFileWriter(path, {
      bufferSize: 1,
      flushInterval: 60_000,
      __fs: countingFs(writes),
    })
    writer.write(record("A"))
    writer.close()
    expect(writes).toEqual([`${record("A")}\n`])
  })

  test("/dev/null opens, writes, and closes", () => {
    const writer = createFileWriter("/dev/null", { bufferSize: 1, flushInterval: 60_000 })
    writer.write(record("A"))
    writer.close()
  })

  test("a directory fails the open and names the path", () => {
    dir = mkdtempSync(join(tmpdir(), "loggily-dir-"))
    expect(() => createFileWriter(dir, { flushInterval: 60_000 })).toThrow(dir)
  })

  test("an unreadable file fails the open and names the path", () => {
    dir = mkdtempSync(join(tmpdir(), "loggily-unreadable-"))
    const path = join(dir, "daemon.log")
    writeFileSync(path, "x")
    chmodSync(path, 0)
    expect(() => createFileWriter(path, { flushInterval: 60_000 })).toThrow(
      path,
    )
    chmodSync(path, 0o644)
  })

  test("a file that already ends in LF gains no extra boundary newline", () => {
    dir = mkdtempSync(join(tmpdir(), "loggily-clean-"))
    const path = join(dir, "daemon.log")
    const first = createFileWriter(path, {
      bufferSize: 1,
      flushInterval: 60_000,
    })
    first.write(record("A"))
    first.close()
    const before = readFileSync(path)
    const second = createFileWriter(path, {
      bufferSize: 1,
      flushInterval: 60_000,
    })
    second.write(record("B"))
    second.close()
    const bytes = readFileSync(path)
    expect(bytes.subarray(0, before.length)).toEqual(before)
    expect(bytes.subarray(before.length)).toEqual(
      Buffer.from(`${record("B")}\n`),
    )
  })
})

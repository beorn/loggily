/**
 * Shared test helpers for loggily test suite.
 */

import { vi } from "vitest"

export interface CapturedLog {
  level: string
  message: string
}

/** Create a mock console that captures output */
export function createConsoleMock() {
  const output: CapturedLog[] = []
  const capture =
    (level: string) =>
    (msg: unknown): void => {
      output.push({ level, message: String(msg) })
    }

  vi.spyOn(console, "debug").mockImplementation(capture("debug"))
  vi.spyOn(console, "info").mockImplementation(capture("info"))
  vi.spyOn(console, "warn").mockImplementation(capture("warn"))
  vi.spyOn(console, "error").mockImplementation(capture("error"))

  vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output.push({ level: "stderr", message: String(chunk) })
    return true
  }) as typeof process.stderr.write)

  return {
    output,
    findSpan: () => output.find((o) => o.message.includes("SPAN")),
    findSpans: () => output.filter((o) => o.message.includes("SPAN")),
  }
}

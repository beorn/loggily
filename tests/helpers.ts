/**
 * Shared test helpers for loggily test suite.
 */

import { vi } from "vitest"
import { safeStringify } from "../src/pipeline.ts"

export interface CapturedLog {
  level: string
  /**
   * Concatenated string form of all args passed to the console method, with
   * non-string args stringified via util.inspect-style `safeFormat`. This
   * preserves backwards compatibility for tests that assert on `message`
   * containing a keyword, now that the console sink spreads structured args
   * (browser `%c` CSS or terminal multi-arg) instead of pre-formatting a
   * single string.
   */
  message: string
  /** Raw args, in order, for tests that need structural assertions. */
  args: unknown[]
}

/** Format one console-arg into a string, preserving nested object content. */
function formatArg(arg: unknown): string {
  if (typeof arg === "string") return arg
  if (arg instanceof Error) {
    // Include the error name, message, stack, code, cause shape so tests
    // that look for "error_type"/"error_stack" keywords can still match.
    const payload: Record<string, unknown> = {
      error_type: arg.name,
      error_message: arg.message,
      error_stack: arg.stack,
    }
    const code = (arg as { code?: string }).code
    if (code) payload.error_code = code
    if (arg.cause !== undefined) payload.error_cause = safeStringify(arg.cause)
    return safeStringify(payload)
  }
  if (typeof arg === "bigint") return arg.toString()
  if (typeof arg === "object" && arg !== null) return safeStringify(arg)
  return String(arg)
}

/** Create a mock console that captures output */
export function createConsoleMock() {
  const output: CapturedLog[] = []
  const capture =
    (level: string) =>
    (...args: unknown[]): void => {
      const message = args.map(formatArg).join(" ")
      output.push({ level, message, args })
    }

  vi.spyOn(console, "debug").mockImplementation(capture("debug"))
  vi.spyOn(console, "info").mockImplementation(capture("info"))
  vi.spyOn(console, "warn").mockImplementation(capture("warn"))
  vi.spyOn(console, "error").mockImplementation(capture("error"))

  vi.spyOn(process.stderr, "write").mockImplementation(((
    chunk: string | Uint8Array,
  ) => {
    output.push({ level: "stderr", message: String(chunk), args: [chunk] })
    return true
  }) as typeof process.stderr.write)

  return {
    output,
    findSpan: () => output.find((o) => o.message.includes("SPAN")),
    findSpans: () => output.filter((o) => o.message.includes("SPAN")),
  }
}

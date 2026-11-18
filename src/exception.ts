/**
 * One exception shape (ADR-0031 decision 2): OpenTelemetry's exception attributes, built here and nowhere else.
 *
 * A record carries one exception as flat attributes: `exception.type`, `exception.message`, `exception.stacktrace`,
 * `error.type`, and `code.function.name` / `code.file.path` / `code.line.number` for the top stack frame. Causes,
 * which OpenTelemetry has no attribute for, are text in the stacktrace (`Caused by: …`, three deep). Any other Error in
 * a record is written as that same text.
 */
import { isSecretKey } from "./redaction.js"

/** The attributes `exceptionAttributes` writes: strings, and the frame's line number. */
export type ExceptionAttributes = Record<string, string | number>

/** How many causes the text follows, as the earlier nested serializer did; it also ends a cause cycle. */
const CAUSE_DEPTH = 3

/** A V8/Bun frame: `at fn (file:line:col)` or `at file:line:col`. A frame without a location does not match. */
const FRAME = /^\s*at (?:(.+?) \()?(.+?):(\d+):\d+\)?$/u

/** The OpenTelemetry exception attributes for one Error. Unknown frame fields are omitted, never written empty. */
export function exceptionAttributes(err: Error): ExceptionAttributes {
  const code = codeOf(err)
  const attributes: ExceptionAttributes = {
    "exception.type": err.name,
    "exception.message": err.message,
    "exception.stacktrace": formatErrorText(err),
    "error.type": code ?? err.name,
  }
  const frame = topFrame(err.stack)
  if (frame !== undefined) {
    if (frame.functionName !== undefined) attributes["code.function.name"] = frame.functionName
    attributes["code.file.path"] = frame.filePath
    attributes["code.line.number"] = frame.lineNumber
  }
  return attributes
}

/**
 * An Error as text: its stack (or `name: message` without one) and its code on a `code:` line, then up to three
 * causes as `Caused by:` blocks in the same form, so a cause's code (ECONNREFUSED under a timeout) is not lost.
 */
export function formatErrorText(err: Error): string {
  return errorHead(err) + causeText(err.cause, CAUSE_DEPTH)
}

/**
 * The Error a record without an explicit one carries in its data: the first own top-level Error whose key the
 * redaction policy does not treat as secret (an Error under `password` stays where key redaction replaces it whole).
 * Returns the data without that key, a copy; the caller's object is never changed.
 */
export function takeDataException(
  data: Record<string, unknown>,
): { error: Error; rest: Record<string, unknown> } | undefined {
  for (const key of Object.keys(data)) {
    const value = data[key]
    if (!(value instanceof Error) || isSecretKey(key)) continue
    const rest = { ...data }
    delete rest[key]
    return { error: value, rest }
  }
  return undefined
}

function errorHead(err: Error): string {
  const head = typeof err.stack === "string" && err.stack !== "" ? err.stack : `${err.name}: ${err.message}`
  const code = codeOf(err)
  return code === undefined ? head : `${head}\n  code: ${code}`
}

/** A Node or library error code (ENOENT, ECONNRESET): a nonempty string, else none. */
function codeOf(err: Error): string | undefined {
  const code = (err as { code?: unknown }).code
  return typeof code === "string" && code !== "" ? code : undefined
}

function causeText(cause: unknown, depth: number): string {
  if (depth <= 0 || cause === undefined || cause === null) return ""
  if (cause instanceof Error) return `\nCaused by: ${errorHead(cause)}${causeText(cause.cause, depth - 1)}`
  return `\nCaused by: ${valueText(cause)}`
}

/** A non-Error cause keeps its details: strings as they are, anything else as JSON, String() only as a last resort. */
function valueText(value: unknown): string {
  if (typeof value === "string") return value
  const seen = new WeakSet<object>()
  try {
    const json = JSON.stringify(value, (_key, val: unknown) => {
      if (typeof val === "bigint" || typeof val === "symbol") return val.toString()
      if (typeof val === "object" && val !== null) {
        if (seen.has(val)) return "[Circular]"
        seen.add(val)
      }
      return val
    })
    return json ?? String(value)
  } catch {
    return String(value)
  }
}

function topFrame(
  stack: string | undefined,
): { functionName?: string; filePath: string; lineNumber: number } | undefined {
  const line = stack?.split("\n").find((row) => /^\s*at /u.test(row))
  const match = line === undefined ? null : FRAME.exec(line)
  if (match === null) return undefined
  const [, functionName, filePath, lineNumber] = match
  return {
    ...(functionName !== undefined && functionName !== "<anonymous>" ? { functionName } : {}),
    filePath: filePath!,
    lineNumber: Number(lineNumber),
  }
}

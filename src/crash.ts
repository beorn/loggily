/**
 * One process crash handler (ADR-0031 decision 3; @cto 37515bb5 conditions 3a-3e, r2.1 GO 0447 on #31167).
 *
 * A process entry calls {@link installCrashHandler} once. On `uncaughtException` or `unhandledRejection` it runs the
 * owner's synchronous restore, writes one FATAL record with event name `exception` through the entry's own logger,
 * gives the owner's async closers and the stdout/stderr drain one shared budget, then exits 1. It never continues.
 * Signals are not handled here: a signal is a stop, owned elsewhere.
 *
 * Limits, stated rather than hidden: only the async closers and the drain are time-bounded. The restore callback, a
 * synchronous sink inside the logger's pipeline, a write to a stalled fd 2 and the file writers' `exit` listeners run
 * synchronously and no in-process timer can cut them short. Calling the logger proves that the record was handed to
 * the pipeline, not that a sink delivered it. A closer or drain that fails or runs out of budget gets one plain line on
 * fd 2, never a log call into the pipeline that may be what failed. Tested under Bun; Node is not yet proven.
 */
import { writeSync } from "node:fs"
import type { ConditionalLogger } from "./core.js"
import { drainOutput } from "./node-output.js"

/** The async budget when the entry names none, in milliseconds. */
export const CRASH_FLUSH_TIMEOUT_MS = 2000

/** The longest plain diagnostic line this handler writes; a longer one is cut, so the output stays finite. */
const NOTICE_MAX_CHARS = 2000

export interface CrashHandlerOptions {
  /** The entry's logger. The FATAL record goes through its pipeline and filters; a filter is never overridden. */
  readonly logger: ConditionalLogger
  /** Synchronous owner cleanup run before the record, such as restoring the terminal. It must not exit. */
  readonly restore?: (error: Error) => void
  /**
   * Owner-held async closers, all started at once, each given the time left in the one budget. A closer that cannot
   * finish its work rejects: a LineSink owner, for example, rejects when `close()` resolves with `pending > 0`.
   */
  readonly closers?: readonly ((remainingMs: number) => Promise<void>)[]
  /** The one budget for every async step, in milliseconds: finite and nonnegative. Default 2000. */
  readonly timeoutMs?: number
}

type CrashOrigin = "uncaughtException" | "unhandledRejection"

let installed = false
let crashing = false

/**
 * Install the process's one crash handler. Call it from a process entry, never from a library import or factory; a
 * second call while one is installed throws. Disposing removes both listeners and allows a later install.
 */
export function installCrashHandler(options: CrashHandlerOptions): Disposable {
  if (installed) {
    throw new Error(
      "installCrashHandler: a crash handler is already installed in this process (ADR-0031 3b)",
    )
  }
  const timeoutMs = options.timeoutMs ?? CRASH_FLUSH_TIMEOUT_MS
  if (!Number.isFinite(timeoutMs) || timeoutMs < 0) {
    throw new TypeError(
      `installCrashHandler: timeoutMs must be a finite nonnegative number, got ${String(timeoutMs)}`,
    )
  }
  const onUncaught = (value: unknown): void =>
    onCrash("uncaughtException", value, options, timeoutMs)
  const onRejection = (value: unknown): void =>
    onCrash("unhandledRejection", value, options, timeoutMs)
  process.on("uncaughtException", onUncaught)
  process.on("unhandledRejection", onRejection)
  installed = true
  return {
    [Symbol.dispose](): void {
      process.off("uncaughtException", onUncaught)
      process.off("unhandledRejection", onRejection)
      installed = false
    },
  }
}

function onCrash(
  origin: CrashOrigin,
  value: unknown,
  options: CrashHandlerOptions,
  timeoutMs: number,
): void {
  // The re-entry state is checked and set before any caller code runs: a throw or rejection from any step below
  // lands here and ends the process, never a second record or a recursive log.
  if (crashing) exitNow()
  crashing = true
  const started = performance.now()
  handleCrash(origin, value, options, timeoutMs, started)
    .then(exitNow)
    .catch(exitNow)
}

async function handleCrash(
  origin: CrashOrigin,
  value: unknown,
  options: CrashHandlerOptions,
  timeoutMs: number,
  started: number,
): Promise<void> {
  const error = normalize(origin, value)
  let restoreError: string | undefined
  if (options.restore !== undefined) {
    try {
      options.restore(error)
    } catch (err) {
      restoreError = describe(err)
    }
  }
  writeRecord(origin, error, options.logger, restoreError)

  const deadline = started + timeoutMs
  const closers = options.closers ?? []
  const outcomes = await Promise.all(
    closers.map((closer, index) => {
      let running: Promise<void>
      try {
        running = closer(remaining(deadline))
      } catch (err) {
        running = Promise.reject(err)
      }
      return bounded(running, deadline).then((outcome) => ({ index, outcome }))
    }),
  )
  for (const { index, outcome } of outcomes) {
    if (outcome !== "done") {
      notice(
        `crash flush: closer ${index} ${outcome}; its pending output may be lost`,
      )
    }
  }
  const drained = await bounded(
    drainOutput([process.stderr, process.stdout]),
    deadline,
  )
  if (drained !== "done") {
    notice(
      `crash flush: stdout/stderr drain ${drained}; trailing output may be lost`,
    )
  }
}

/** One Error per crash. A non-Error value becomes an Error named for its origin; a real Error keeps its name. */
function normalize(origin: CrashOrigin, value: unknown): Error {
  if (value instanceof Error) return value
  let message: string
  try {
    message = String(value)
  } catch {
    message =
      origin === "unhandledRejection"
        ? "<unprintable rejection reason>"
        : "<unprintable thrown value>"
  }
  const error = new Error(message)
  error.name =
    origin === "unhandledRejection" ? "UnhandledRejection" : "UncaughtException"
  return error
}

function writeRecord(
  origin: CrashOrigin,
  error: Error,
  logger: ConditionalLogger,
  restoreError?: string,
): void {
  const fatal = logger.fatal
  if (typeof fatal !== "function") {
    notice(
      `${headline(origin, error)} (no FATAL record: the logger's level filter suppresses fatal)`,
    )
    return
  }
  try {
    fatal.call(logger, "exception", {
      "event.name": "exception",
      exception: error,
      ...(restoreError === undefined
        ? {}
        : { "crash.restore_error": restoreError }),
    })
  } catch (err) {
    notice(`${headline(origin, error)} (FATAL record failed: ${describe(err)})`)
  }
}

function headline(origin: CrashOrigin, error: Error): string {
  return `uncaught ${origin}: ${error.name}: ${error.message}`
}

function describe(err: unknown): string {
  try {
    return err instanceof Error ? `${err.name}: ${err.message}` : String(err)
  } catch {
    return "<unprintable error>"
  }
}

/** The one plain diagnostic: a synchronous best-effort write to fd 2. A broken fd 2 is swallowed; exit 1 still wins. */
function notice(text: string): void {
  try {
    const line =
      text.length > NOTICE_MAX_CHARS
        ? `${text.slice(0, NOTICE_MAX_CHARS)}…`
        : text
    writeSync(2, `${line}\n`)
  } catch {
    // silent-fallback-allow: this is the last diagnostic channel. A closed or broken fd 2 (EBADF, EPIPE) leaves
    // nowhere to say it, and the process still exits 1, which is the remaining signal.
  }
}

function remaining(deadline: number): number {
  return Math.max(0, deadline - performance.now())
}

async function bounded(
  work: Promise<unknown>,
  deadline: number,
): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("timed out"), remaining(deadline))
  })
  try {
    return await Promise.race([
      work.then(
        () => "done",
        (err: unknown) => `failed (${describe(err)})`,
      ),
      timeout,
    ])
  } finally {
    clearTimeout(timer)
  }
}

function exitNow(): never {
  process.exit(1)
}

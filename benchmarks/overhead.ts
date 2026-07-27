/**
 * loggily Benchmark Suite
 *
 * Compares zero-overhead disabled logging and enabled logging performance
 * against popular alternatives: pino, winston, debug.
 *
 * All "enabled" benchmarks use the same kind of sink (noop writer) for a fair
 * apples-to-apples comparison of formatting + serialization throughput.
 *
 * Run: bun benchmarks/overhead.ts
 */

import {
  addWriter,
  createLogger,
  setLogLevel,
  setSuppressConsole,
  disableSpans,
} from "../src/index.ts"

// ── Helpers ──────────────────────────────────────────────────────────────────

function measure(
  name: string,
  fn: () => void,
  iterations: number,
): { name: string; opsPerSec: number; nsPerOp: number } {
  // Warmup
  for (let i = 0; i < 1000; i++) fn()

  const start = Bun.nanoseconds()
  for (let i = 0; i < iterations; i++) fn()
  const elapsed = Bun.nanoseconds() - start

  const nsPerOp = elapsed / iterations
  const opsPerSec = 1e9 / nsPerOp

  return { name, opsPerSec, nsPerOp }
}

function formatOps(ops: number): string {
  if (ops >= 1e9) return `${(ops / 1e9).toFixed(0)}B`
  if (ops >= 1e6) return `${(ops / 1e6).toFixed(0)}M`
  if (ops >= 1e3) return `${(ops / 1e3).toFixed(0)}K`
  return `${ops.toFixed(0)}`
}

function formatNs(ns: number): string {
  if (ns >= 1e6) return `${(ns / 1e6).toFixed(1)}ms`
  if (ns >= 1e3) return `${(ns / 1e3).toFixed(1)}µs`
  return `${ns.toFixed(1)}ns`
}

function printResults(
  title: string,
  results: Array<{ name: string; opsPerSec: number; nsPerOp: number }>,
) {
  console.log(`\n${title}`)
  console.log("─".repeat(70))

  const maxNameLen = Math.max(...results.map((r) => r.name.length))

  for (const r of results) {
    const name = r.name.padEnd(maxNameLen)
    const ops = formatOps(r.opsPerSec).padStart(6)
    const ns = formatNs(r.nsPerOp).padStart(8)
    console.log(`  ${name}  ${ops} ops/s  ${ns}/op`)
  }
}

// ── Expensive argument simulation ────────────────────────────────────────────

function expensiveArg(): string {
  return JSON.stringify({
    a: 1,
    b: 2,
    c: [3, 4, 5],
    d: { e: "hello", f: true },
  })
}

// ── Noop stream (shared sink type for fair enabled comparisons) ──────────────

const { Writable } = await import("stream")
const noopStream = () =>
  new Writable({
    write(_chunk: unknown, _encoding: string, callback: () => void) {
      callback()
    },
  })

// ── loggily setup ──────────────────────────────────────────────────────

// Route all output to noop writer, suppress console
setSuppressConsole(true)
addWriter(() => {}) // noop writer — receives formatted output, discards it
disableSpans()
const loggilyLog = createLogger("bench")

// ── Pino setup ───────────────────────────────────────────────────────────────

type LogFn = {
  (msg: string): void
  (obj: Record<string, unknown>, msg: string): void
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (...args: any[]): void
}

interface BenchLogger {
  debug: LogFn
  info: LogFn
  warn: LogFn
}

// Disabled pino (level=warn, debug/info disabled) — second arg = noop stream
// Enabled pino (level=debug, all levels active) — second arg = noop stream
let pinoDisabled: BenchLogger
let pinoEnabled: BenchLogger
try {
  // Opaque specifier ("pino" as string): pino is an OPTIONAL comparison dep,
  // deliberately not declared anywhere (hh logging-unification). A literal
  // specifier fails typecheck (TS2307) wherever pino isn't installed; the
  // opaque form types as `any` in every environment while the runtime import
  // and the catch-fallback below behave identically.
  const pino = (
    (await import("pino" as string)) as {
      default: (
        options?: { level?: string },
        destination?: unknown,
      ) => BenchLogger
    }
  ).default
  pinoDisabled = pino({ level: "warn" }, noopStream())
  pinoEnabled = pino({ level: "debug" }, noopStream())
} catch {
  console.log("pino not installed — install with: bun add -d pino")
  const stub: BenchLogger = { debug: () => {}, info: () => {}, warn: () => {} }
  pinoDisabled = stub
  pinoEnabled = stub
}

// ── Winston setup ────────────────────────────────────────────────────────────

// Disabled winston (level=warn, debug/info disabled)
// Enabled winston (level=debug, all levels active) — noop stream transport
let winstonDisabled: BenchLogger
let winstonEnabled: BenchLogger
try {
  // Opaque specifier — same optional-comparison-dep rationale as pino above.
  const winston = (await import("winston" as string)) as {
    createLogger: (options?: {
      level?: string
      transports?: unknown[]
    }) => BenchLogger
    transports: {
      Console: new (options?: { silent?: boolean }) => unknown
      Stream: new (options?: { stream?: unknown }) => unknown
    }
  }
  winstonDisabled = winston.createLogger({
    level: "warn",
    transports: [new winston.transports.Console({ silent: true })],
  })
  winstonEnabled = winston.createLogger({
    level: "debug",
    transports: [new winston.transports.Stream({ stream: noopStream() })],
  })
} catch {
  console.log("winston not installed — install with: bun add -d winston")
  const stub: BenchLogger = { debug: () => {}, info: () => {}, warn: () => {} }
  winstonDisabled = stub
  winstonEnabled = stub
}

// ── Debug setup ──────────────────────────────────────────────────────────────

let debugFn: (msg: string) => void
try {
  const debug = (await import("debug")).default
  debugFn = debug("bench") // DEBUG env not set → disabled
} catch {
  console.log("debug not installed — install with: bun add -d debug")
  debugFn = () => {}
}

// ── Baseline: noop ───────────────────────────────────────────────────────────

const noop = (): void => {}

// ── Benchmarks ───────────────────────────────────────────────────────────────

const N = 10_000_000

console.log("loggily Benchmark Suite")
console.log(`Iterations: ${(N / 1e6).toFixed(0)}M per test`)
console.log(`Runtime: Bun ${Bun.version}`)
console.log(`Platform: ${process.platform} ${process.arch}`)

// ─── PART 1: DISABLED LOGGING ────────────────────────────────────────────────

// 1. Disabled debug call — cheap args
{
  setLogLevel("warn") // debug disabled

  const results = [
    measure("noop()", () => noop(), N),
    measure("loggily: log.debug?.(str)", () => loggilyLog.debug?.("hello"), N),
    measure("pino: log.debug(str)", () => pinoDisabled.debug("hello"), N),
    measure("winston: log.debug(str)", () => winstonDisabled.debug("hello"), N),
    measure('debug: debug("hello")', () => debugFn("hello"), N),
  ]

  printResults("DISABLED DEBUG — cheap argument (string literal)", results)
}

// 2. Disabled debug call — expensive args
{
  setLogLevel("warn") // debug disabled

  const results = [
    measure("noop(expensive)", () => noop(), N),
    measure(
      "loggily: log.debug?.(expensive)",
      () => loggilyLog.debug?.(`state: ${expensiveArg()}`),
      N,
    ),
    measure(
      "pino: log.debug(expensive)",
      () => pinoDisabled.debug(`state: ${expensiveArg()}`),
      N,
    ),
    measure(
      "winston: log.debug(expensive)",
      () => winstonDisabled.debug(`state: ${expensiveArg()}`),
      N,
    ),
    measure(
      "debug: debug(expensive)",
      () => debugFn(`state: ${expensiveArg()}`),
      N,
    ),
  ]

  printResults("DISABLED DEBUG — expensive argument (JSON.stringify)", results)
}

// ─── PART 2: ENABLED LOGGING (all to noop writers) ───────────────────────────
// Fair comparison: all loggers format + serialize, all write to noop sinks.
// loggily: addWriter(noop) + setSuppressConsole(true)
// pino: pino(opts, noopWritableStream)
// winston: Stream transport with noop Writable

// 3. Enabled info — cheap args (string literal)
{
  setLogLevel("info") // info enabled

  const results = [
    measure(
      "loggily: log.info?.(str)",
      () => loggilyLog.info?.("hello"),
      N / 10,
    ),
    measure("pino: log.info(str)", () => pinoEnabled.info("hello"), N / 10),
    measure(
      "winston: log.info(str)",
      () => winstonEnabled.info("hello"),
      N / 10,
    ),
  ]

  printResults(
    "ENABLED INFO — cheap argument (string literal) — all to noop sink",
    results,
  )
}

// 4. Enabled info — structured data
{
  setLogLevel("info") // info enabled

  const structuredData = { key: "value", count: 42 }

  const results = [
    measure(
      "loggily: log.info?.(str, data)",
      () => loggilyLog.info?.("request", structuredData),
      N / 10,
    ),
    measure(
      "pino: log.info(obj, str)",
      () => pinoEnabled.info(structuredData, "request"),
      N / 10,
    ),
    measure(
      "winston: log.info(str, data)",
      () => winstonEnabled.info("request", structuredData),
      N / 10,
    ),
  ]

  printResults(
    "ENABLED INFO — structured data ({ key, count }) — all to noop sink",
    results,
  )
}

// 5. Enabled warn — with Error object
{
  setLogLevel("warn") // warn enabled

  const err = new Error("something broke")

  const results = [
    measure(
      "loggily: log.warn?.(Error)",
      () => loggilyLog.warn?.(err as unknown as string),
      N / 10,
    ),
    measure(
      "pino: log.warn(Error)",
      () => pinoEnabled.warn({ err }, "something broke"),
      N / 10,
    ),
    measure(
      "winston: log.warn(str, Error)",
      () => winstonEnabled.warn("something broke", { error: err }),
      N / 10,
    ),
  ]

  printResults("ENABLED WARN — Error object — all to noop sink", results)
}

// ─── PART 3: SPANS ──────────────────────────────────────────────────────────

// 6. Disabled span optional chaining — should match the existing
// ConditionalLogger optional-method baseline and skip lazy prop evaluation.
{
  setLogLevel("warn")
  disableSpans()
  let propsEvaluated = 0

  const noopBaseline = measure("noop()", () => noop(), N)
  const conditionalBaseline = measure(
    "loggily: log.debug?.(disabled baseline)",
    () => {
      void loggilyLog.debug?.("disabled")
    },
    N,
  )
  const disabledSpan = measure(
    "loggily: log.span?.(disabled)",
    () => {
      void loggilyLog.span?.("op")
    },
    N,
  )
  const disabledSpanLazyProps = measure(
    "loggily: log.span?.(disabled, lazy props)",
    () => {
      void loggilyLog.span?.("op", () => {
        propsEvaluated++
        return { state: expensiveArg() }
      })
    },
    N,
  )
  const results = [
    noopBaseline,
    conditionalBaseline,
    disabledSpan,
    disabledSpanLazyProps,
  ]

  printResults("DISABLED SPAN — optional method short-circuit", results)

  const ratio = disabledSpan.nsPerOp / conditionalBaseline.nsPerOp
  console.log(
    `  disabled span / disabled debug ratio: ${ratio.toFixed(3)}x (${((ratio - 1) * 100).toFixed(1)}%)`,
  )
  console.log(`  disabled lazy span props evaluated: ${propsEvaluated}`)
}

// 7. Enabled span creation + disposal to noop writer.
{
  process.env.TRACE = "1"
  const spanLog = createLogger("bench:span-enabled")

  const results = [
    measure(
      "loggily: span create+dispose",
      () => {
        using _s = spanLog.span!("op")
      },
      N / 10,
    ),
  ]

  printResults("ENABLED SPAN — create + dispose (noop output)", results)
}

console.log("\n" + "─".repeat(70))
console.log("Key: ops/s = operations per second, /op = time per operation")
console.log(
  "loggily uses ?. for zero-overhead: disabled calls skip argument evaluation",
)
console.log(
  "Enabled benchmarks: all loggers write to noop sinks (fair comparison)",
)
console.log("")

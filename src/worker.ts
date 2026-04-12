/**
 * Worker Thread Logger/Console Forwarding
 *
 * Pipeline-based worker logging: worker loggers use a postMessage transport
 * so events flow through the main thread's pipeline for output.
 *
 * ## Structured Logger (Recommended)
 *
 * @example Worker side:
 * ```typescript
 * import { createWorkerLogger } from "loggily/worker"
 * const log = createWorkerLogger(postMessage, "km:worker:parse")
 *
 * log.info?.("processing", { file: "test.md" })
 * {
 *   using span = log.span?.("parse")
 *   // ... work ...
 *   span.spanData.lines = 100
 * }
 * ```
 *
 * @example Main thread side:
 * ```typescript
 * import { createWorkerLogHandler } from "loggily/worker"
 *
 * const handleLog = createWorkerLogHandler()
 * worker.onmessage = (e) => handleLog(e.data)
 * ```
 *
 * ## Console Forwarding (Simple)
 *
 * @example Worker side:
 * ```typescript
 * import { forwardConsole } from "loggily/worker"
 * forwardConsole(postMessage)
 *
 * console.log("message")  // Forwarded to main thread
 * ```
 */

import { createLogger, baseCreateLogger, pipe, withSpans, type ConditionalLogger } from "./core.js"
import type { Event, LogEvent, SpanEvent, Stage, ConfigElement } from "./pipeline.js"

// ============ Console Message Type ============

/** Message sent from worker to main thread for console output */
export interface WorkerConsoleMessage {
  type: "console"
  level: "log" | "debug" | "info" | "warn" | "error" | "trace"
  namespace?: string
  args: unknown[]
  timestamp: number
}

// ============ Type Guards ============

/** Type guard for LogEvent (structured log from worker) */
export function isWorkerLogEvent(msg: unknown): msg is LogEvent {
  return typeof msg === "object" && (msg as LogEvent)?.kind === "log"
}

/** Type guard for SpanEvent (span from worker) */
export function isWorkerSpanEvent(msg: unknown): msg is SpanEvent {
  return typeof msg === "object" && (msg as SpanEvent)?.kind === "span"
}

/** Type guard for any pipeline Event (log or span) */
export function isWorkerEvent(msg: unknown): msg is Event {
  return isWorkerLogEvent(msg) || isWorkerSpanEvent(msg)
}

/** Type guard for WorkerConsoleMessage */
export function isWorkerConsoleMessage(msg: unknown): msg is WorkerConsoleMessage {
  return (
    typeof msg === "object" &&
    (msg as WorkerConsoleMessage)?.type === "console" &&
    typeof (msg as WorkerConsoleMessage).level === "string" &&
    Array.isArray((msg as WorkerConsoleMessage).args)
  )
}

/** Type guard for any worker message (console or pipeline event) */
export function isWorkerMessage(msg: unknown): msg is WorkerConsoleMessage | Event {
  return isWorkerConsoleMessage(msg) || isWorkerEvent(msg)
}

// ============ Worker Side: Console Forwarding ============

type PostMessageFn = (message: WorkerConsoleMessage) => void

/** Store original console methods for restoration */
let originalConsole: typeof console | null = null

/**
 * Serialize a value for transmission via postMessage.
 * Handles non-serializable values like functions and circular references.
 */
function serializeArg(arg: unknown, depth = 0): unknown {
  // Prevent infinite recursion
  if (depth > 5) return "[max depth]"

  if (arg === null || arg === undefined) return arg
  if (typeof arg === "function") return `[Function: ${arg.name || "anonymous"}]`
  if (typeof arg === "symbol") return arg.toString()
  if (typeof arg === "bigint") return arg.toString() + "n"

  if (arg instanceof Error) {
    const result: Record<string, unknown> = {
      name: arg.name,
      message: arg.message,
      stack: arg.stack,
    }
    if ((arg as { code?: string }).code) result.code = (arg as { code?: string }).code
    if (arg.cause !== undefined) result.cause = serializeArg(arg.cause, depth + 1)
    return result
  }

  if (Array.isArray(arg)) {
    return arg.map((v) => serializeArg(v, depth + 1))
  }

  if (typeof arg === "object") {
    try {
      // Try structured clone first (handles most cases)
      structuredClone(arg)
      return arg
    } catch {
      // Fall back to manual serialization
      const result: Record<string, unknown> = {}
      const seen = new Set<object>()
      seen.add(arg)

      for (const [key, value] of Object.entries(arg)) {
        if (typeof value === "object" && value !== null && seen.has(value)) {
          result[key] = "[Circular]"
        } else {
          result[key] = serializeArg(value, depth + 1)
        }
      }
      return result
    }
  }

  return arg
}

/**
 * Forward console.* calls from worker to main thread.
 *
 * Monkey-patches console methods to send messages via postMessage.
 * Call this at the start of your worker script.
 *
 * @param postMessage - The worker's postMessage function
 * @param namespace - Optional namespace for log messages (e.g., "km:worker:parse")
 *
 * @example
 * ```typescript
 * // At top of worker file:
 * import { forwardConsole } from "loggily/worker"
 * forwardConsole(postMessage, "km:worker:parse")
 *
 * // Now all console.* calls are forwarded:
 * console.log("processing", { file: "test.md" })
 * console.error(new Error("failed"))
 * ```
 */
export function forwardConsole(postMessage: PostMessageFn, namespace?: string): void {
  // Store original console for restoration
  if (!originalConsole) {
    originalConsole = { ...console }
  }

  const levels = ["log", "debug", "info", "warn", "error", "trace"] as const

  for (const level of levels) {
    console[level] = (...args: unknown[]) => {
      const serializedArgs = args.map((arg) => serializeArg(arg))

      try {
        postMessage({
          type: "console",
          level,
          namespace,
          args: serializedArgs,
          timestamp: Date.now(),
        })
      } catch {
        // postMessage might fail if worker is shutting down
        // Fall back to original console
        originalConsole?.[level](...args)
      }
    }
  }
}

/**
 * Restore original console methods.
 * Call this if you need to disable console forwarding.
 */
export function restoreConsole(): void {
  if (originalConsole) {
    Object.assign(console, originalConsole)
    originalConsole = null
  }
}

// ============ Worker Side: Pipeline Transport ============

/**
 * Create a pipeline stage that forwards events via postMessage.
 *
 * Events are plain JSON objects that survive structuredClone natively.
 * The stage consumes events (returns null) so nothing is output locally.
 * The main thread uses handleWorkerEvents() or createWorkerLogHandler()
 * to dispatch them through a local logger pipeline.
 */
export function workerTransportStage(postMessage: (msg: unknown) => void): Stage {
  return (event: Event): null => {
    try {
      postMessage(event)
    } catch {
      // If postMessage fails (non-cloneable), try with JSON round-trip
      try {
        postMessage(JSON.parse(JSON.stringify(event)))
      } catch {
        // Silently drop -- worker can't communicate
      }
    }
    return null // Consume the event (no local output)
  }
}

/**
 * Create a logger for use in a worker thread.
 *
 * All log and span events are forwarded to the main thread via postMessage.
 * The main thread should use createWorkerLogHandler() to process these messages.
 *
 * @param postMessage - The worker's postMessage function
 * @param namespace - Logger namespace (e.g., "km:worker:parse")
 * @param props - Optional initial props
 *
 * @example
 * ```typescript
 * import { createWorkerLogger } from "loggily/worker"
 *
 * const log = createWorkerLogger(postMessage, "km:worker:parse")
 *
 * log.info?.("starting parse", { file: "test.md" })
 *
 * {
 *   using span = log.span?.("process")
 *   span.info?.("processing...")
 *   span.spanData.count = 100
 * }
 * // Span end event automatically sent to main thread
 * ```
 */
export function createWorkerLogger(
  postMessage: (msg: unknown) => void,
  namespace: string,
  props?: Record<string, unknown>,
): ConditionalLogger {
  const transport = workerTransportStage(postMessage)
  const config: ConfigElement[] = [{ level: "trace" as const }, transport]
  const factory = pipe(baseCreateLogger, withSpans())
  const logger = factory(namespace, config)
  return props ? logger.child(props) : logger
}

// ============ Main Thread Side: Event Handling ============

/**
 * Create a handler that dispatches worker events to a target logger.
 *
 * Use this when you have a specific logger to dispatch through.
 *
 * @param target - Logger or object with dispatch method
 * @returns Handler function to call with worker messages
 */
export function handleWorkerEvents(
  target: ConditionalLogger | { dispatch(event: Event): void },
): (msg: unknown) => void {
  return (msg: unknown) => {
    if (typeof msg !== "object" || msg === null) return
    const event = msg as Record<string, unknown>
    if (event.kind === "log" || event.kind === "span") {
      target.dispatch(msg as Event)
    }
  }
}

/**
 * Create a zero-config handler for worker logger messages.
 *
 * Automatically creates loggers per-namespace. For console messages,
 * formats args and dispatches through a logger.
 *
 * @returns Handler function to call with any worker message
 *
 * @example
 * ```typescript
 * import { createWorkerLogHandler } from "loggily/worker"
 *
 * const handleLog = createWorkerLogHandler()
 * worker.onmessage = (e) => handleLog(e.data)
 * ```
 */
export function createWorkerLogHandler(): (message: unknown) => void {
  const loggers = new Map<string, ConditionalLogger>()

  function getLogger(namespace: string): ConditionalLogger {
    let logger = loggers.get(namespace)
    if (!logger) {
      logger = createLogger(namespace)
      loggers.set(namespace, logger)
    }
    return logger
  }

  return (message: unknown) => {
    if (isWorkerEvent(message)) {
      const logger = getLogger(message.namespace)
      logger.dispatch(message)
    } else if (isWorkerConsoleMessage(message)) {
      const logger = getLogger(message.namespace || "worker")
      const { message: msg, data } = formatConsoleArgs(message.args)
      dispatchToLogger(logger, message.level, msg, data)
    }
  }
}

// ============ Main Thread Side: Console Handler ============

export interface WorkerConsoleHandlerOptions {
  /** Default namespace if message doesn't include one */
  defaultNamespace?: string
  /** Custom logger to use (defaults to creating one with the namespace) */
  logger?: { name: string; dispatch(event: Event): void }
}

/** Safely stringify a value, handling circular refs and BigInt */
function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

/** Format console args into a message string and optional data object */
function formatConsoleArgs(args: unknown[]): { message: string; data: Record<string, unknown> | undefined } {
  const message =
    args.length === 0
      ? ""
      : args.length === 1 && typeof args[0] === "string"
        ? args[0]
        : args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" ")

  const lastArg = args[args.length - 1]
  const data =
    args.length > 1 && typeof lastArg === "object" && lastArg !== null && !Array.isArray(lastArg)
      ? (lastArg as Record<string, unknown>)
      : undefined

  return { message, data }
}

/** Dispatch a message to a logger at the given console level */
function dispatchToLogger(
  logger: ConditionalLogger,
  level: "log" | "debug" | "info" | "warn" | "error" | "trace",
  message: string,
  data?: Record<string, unknown>,
): void {
  switch (level) {
    case "trace":
      logger.trace?.(message, data)
      break
    case "debug":
      logger.debug?.(message, data)
      break
    case "info":
    case "log":
      logger.info?.(message, data)
      break
    case "warn":
      logger.warn?.(message, data)
      break
    case "error":
      logger.error?.(message, data)
      break
  }
}

/**
 * Create a handler for worker console messages.
 *
 * Use this on the main thread to receive and output messages from workers.
 *
 * @param options - Handler options
 * @returns Handler function to call with worker messages
 *
 * @example
 * ```typescript
 * import { createWorkerConsoleHandler } from "loggily/worker"
 *
 * const handleConsole = createWorkerConsoleHandler({
 *   defaultNamespace: "km:worker:parse"
 * })
 *
 * worker.onmessage = (e) => {
 *   if (e.data.type === "console") {
 *     handleConsole(e.data)
 *   }
 * }
 * ```
 */
export function createWorkerConsoleHandler(
  options: WorkerConsoleHandlerOptions = {},
): (message: WorkerConsoleMessage) => void {
  const loggers = new Map<string, ConditionalLogger>()

  function getLogger(namespace?: string): ConditionalLogger {
    const ns = namespace || options.defaultNamespace || "worker"

    let logger = loggers.get(ns)
    if (!logger) {
      logger = options.logger ? (options.logger as ConditionalLogger) : createLogger(ns)
      loggers.set(ns, logger)
    }
    return logger
  }

  return (message: WorkerConsoleMessage) => {
    const logger = getLogger(message.namespace)
    const { message: msg, data } = formatConsoleArgs(message.args)
    dispatchToLogger(logger, message.level, msg, data)
  }
}

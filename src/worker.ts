/**
 * Worker Thread Logger/Console Forwarding
 *
 * Provides utilities to forward loggily and console.* output from worker threads
 * to the main thread, ensuring proper integration with DEBUG_LOG and log files.
 *
 * ## Full Logger Forwarding (Recommended)
 *
 * @example Worker side:
 * ```typescript
 * import { createWorkerLogger } from "loggily/worker"
 * const log = createWorkerLogger(postMessage, "km:worker:parse")
 *
 * log.info("processing", { file: "test.md" })
 * {
 *   using span = log.span("parse")
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
 * worker.onmessage = (e) => {
 *   if (e.data.type === "log" || e.data.type === "span") handleLog(e.data)
 * }
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

import {
  createLogger,
  createSpanDataProxy,
  type ConditionalLogger,
  type LazyMessage,
  type Logger,
  type SpanLogger,
  type SpanData,
} from "./index.ts"
import { serializeCause } from "./pipeline.js"

// ============ Message Protocol ============

/** Message sent from worker to main thread for console output */
export interface WorkerConsoleMessage {
  type: "console"
  level: "log" | "debug" | "info" | "warn" | "error" | "trace"
  namespace?: string
  args: unknown[]
  timestamp: number
}

/** Message sent from worker to main thread for structured log output */
export interface WorkerLogMessage {
  type: "log"
  level: "trace" | "debug" | "info" | "warn" | "error"
  namespace: string
  message: string
  data?: Record<string, unknown>
  timestamp: number
}

/** Message sent from worker to main thread for span events */
export interface WorkerSpanMessage {
  type: "span"
  event: "start" | "end"
  namespace: string
  spanId: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime?: number
  duration?: number
  props: Record<string, unknown>
  spanData: Record<string, unknown>
  timestamp: number
}

/** Union type for all worker messages */
export type WorkerMessage = WorkerConsoleMessage | WorkerLogMessage | WorkerSpanMessage

/** Type guard for WorkerConsoleMessage */
export function isWorkerConsoleMessage(msg: unknown): msg is WorkerConsoleMessage {
  return (
    typeof msg === "object" &&
    (msg as WorkerConsoleMessage)?.type === "console" &&
    typeof (msg as WorkerConsoleMessage).level === "string" &&
    Array.isArray((msg as WorkerConsoleMessage).args)
  )
}

/** Type guard for WorkerLogMessage */
export function isWorkerLogMessage(msg: unknown): msg is WorkerLogMessage {
  return (
    typeof msg === "object" &&
    (msg as WorkerLogMessage)?.type === "log" &&
    typeof (msg as WorkerLogMessage).level === "string" &&
    typeof (msg as WorkerLogMessage).namespace === "string"
  )
}

/** Type guard for WorkerSpanMessage */
export function isWorkerSpanMessage(msg: unknown): msg is WorkerSpanMessage {
  return (
    typeof msg === "object" &&
    (msg as WorkerSpanMessage)?.type === "span" &&
    typeof (msg as WorkerSpanMessage).event === "string"
  )
}

/** Type guard for any worker message */
export function isWorkerMessage(msg: unknown): msg is WorkerMessage {
  return isWorkerConsoleMessage(msg) || isWorkerLogMessage(msg) || isWorkerSpanMessage(msg)
}

// ============ Worker Side ============

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

// ============ Worker Logger (Full API) ============

type PostMessageAnyFn = (message: WorkerMessage) => void

let workerSpanIdCounter = 0
let workerTraceIdCounter = 0

function generateWorkerSpanId(): string {
  return `wsp_${(++workerSpanIdCounter).toString(36)}`
}

function generateWorkerTraceId(): string {
  return `wtr_${(++workerTraceIdCounter).toString(36)}`
}

/** Reset worker ID counters (for testing) */
export function resetWorkerIds(): void {
  workerSpanIdCounter = 0
  workerTraceIdCounter = 0
}

interface WorkerLoggerOptions {
  /** Parent span ID for nested spans */
  parentSpanId?: string | null
  /** Trace ID for distributed tracing */
  traceId?: string | null
}

/**
 * Create a logger instance for use in a worker thread.
 *
 * All log calls and span events are forwarded to the main thread via postMessage.
 * The main thread should use createWorkerLogHandler to process these messages.
 *
 * @param postMessage - The worker's postMessage function
 * @param namespace - Logger namespace (e.g., "km:worker:parse")
 * @param props - Optional initial props
 * @param options - Optional configuration
 *
 * @example
 * ```typescript
 * import { createWorkerLogger } from "loggily/worker"
 *
 * const log = createWorkerLogger(postMessage, "km:worker:parse")
 *
 * log.info("starting parse", { file: "test.md" })
 *
 * {
 *   using span = log.span("process")
 *   span.info("processing...")
 *   span.spanData.lineCount = 100
 * }
 * // Span end event automatically sent to main thread
 * ```
 */
export function createWorkerLogger(
  postMessage: PostMessageAnyFn,
  namespace: string,
  props: Record<string, unknown> = {},
  options: WorkerLoggerOptions = {},
): Logger {
  const { parentSpanId = null, traceId = null } = options

  function log(
    level: "trace" | "debug" | "info" | "warn" | "error",
    message: LazyMessage,
    data?: Record<string, unknown>,
  ): void {
    const resolved = typeof message === "function" ? message() : message
    try {
      postMessage({
        type: "log",
        level,
        namespace,
        message: resolved,
        data: data ? { ...props, ...data } : Object.keys(props).length > 0 ? props : undefined,
        timestamp: Date.now(),
      })
    } catch (err) {
      // postMessage failed (e.g. uncloneable data) — send a diagnostic fallback
      try {
        postMessage({
          type: "log",
          level: "error",
          namespace,
          message: `postMessage failed for ${level} "${resolved}": ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        })
      } catch {
        // Worker might be shutting down — truly nothing we can do
      }
    }
  }

  function createSpan(spanNamespace?: string, spanProps?: Record<string, unknown>): SpanLogger {
    const fullNamespace = spanNamespace ? `${namespace}:${spanNamespace}` : namespace
    const mergedProps = { ...props, ...spanProps }
    const spanId = generateWorkerSpanId()
    const spanTraceId = traceId || generateWorkerTraceId()
    const startTime = Date.now()

    // Mutable span data that can be set by the user
    const customSpanData: Record<string, unknown> = {}

    // Send span start event
    try {
      postMessage({
        type: "span",
        event: "start",
        namespace: fullNamespace,
        spanId,
        traceId: spanTraceId,
        parentId: parentSpanId,
        startTime,
        props: mergedProps,
        spanData: {},
        timestamp: Date.now(),
      })
    } catch (err) {
      // postMessage failed (e.g. uncloneable props) — send a diagnostic fallback
      try {
        postMessage({
          type: "log",
          level: "error",
          namespace: fullNamespace,
          message: `postMessage failed for span start "${fullNamespace}": ${err instanceof Error ? err.message : String(err)}`,
          timestamp: Date.now(),
        })
      } catch {
        // Worker might be shutting down
      }
    }

    let ended = false

    const spanData: SpanData = createSpanDataProxy(
      () => ({
        id: spanId,
        traceId: spanTraceId,
        parentId: parentSpanId,
        startTime,
        endTime: ended ? Date.now() : null,
        duration: Date.now() - startTime,
      }),
      customSpanData,
    )

    function endSpan(): void {
      if (ended) return
      ended = true

      const endTime = Date.now()
      const duration = endTime - startTime

      try {
        postMessage({
          type: "span",
          event: "end",
          namespace: fullNamespace,
          spanId,
          traceId: spanTraceId,
          parentId: parentSpanId,
          startTime,
          endTime,
          duration,
          props: mergedProps,
          spanData: customSpanData,
          timestamp: Date.now(),
        })
      } catch (err) {
        // postMessage failed (e.g. uncloneable spanData) — send a diagnostic fallback
        try {
          postMessage({
            type: "log",
            level: "error",
            namespace: fullNamespace,
            message: `postMessage failed for span end "${fullNamespace}" (${duration}ms): ${err instanceof Error ? err.message : String(err)}`,
            timestamp: Date.now(),
          })
        } catch {
          // Worker might be shutting down
        }
      }
    }

    // Create child logger for the span
    const childLogger = createWorkerLogger(postMessage, fullNamespace, mergedProps, {
      parentSpanId: spanId,
      traceId: spanTraceId,
    })

    const spanLogger: SpanLogger = {
      ...childLogger,
      spanData,
      end: endSpan,
      [Symbol.dispose]: endSpan,
    }

    return spanLogger
  }

  const logger: Logger = {
    name: namespace,
    props: Object.freeze({ ...props }),
    spanData: null,

    trace: (msg, data) => log("trace", msg, data),
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (
      msgOrError: LazyMessage | Error,
      dataOrMsg?: Record<string, unknown> | string,
      extraData?: Record<string, unknown>,
    ) => {
      if (msgOrError instanceof Error) {
        if (typeof dataOrMsg === "string") {
          log("error", dataOrMsg, {
            ...extraData,
            error_type: msgOrError.name,
            error_message: msgOrError.message,
            error_stack: msgOrError.stack,
            error_code: (msgOrError as NodeJS.ErrnoException).code,
            error_cause: msgOrError.cause !== undefined ? serializeCause(msgOrError.cause) : undefined,
          })
        } else {
          log("error", msgOrError.message, {
            ...(dataOrMsg as Record<string, unknown>),
            error_type: msgOrError.name,
            error_stack: msgOrError.stack,
            error_code: (msgOrError as NodeJS.ErrnoException).code,
            error_cause: msgOrError.cause !== undefined ? serializeCause(msgOrError.cause) : undefined,
          })
        }
      } else {
        log("error", msgOrError, dataOrMsg as Record<string, unknown>)
      }
    },

    logger(childNamespace?: string, childProps?: Record<string, unknown>): ConditionalLogger {
      const fullNamespace = childNamespace ? `${namespace}:${childNamespace}` : namespace
      return createWorkerLogger(
        postMessage,
        fullNamespace,
        { ...props, ...childProps },
        options,
      ) as unknown as ConditionalLogger
    },

    span: createSpan,

    child(
      namespaceOrContext: Record<string, unknown> | string,
      childProps?: Record<string, unknown>,
    ): ConditionalLogger {
      if (typeof namespaceOrContext === "string") {
        return this.logger(namespaceOrContext, childProps)
      }
      return createWorkerLogger(
        postMessage,
        namespace,
        { ...props, ...namespaceOrContext },
        options,
      ) as unknown as ConditionalLogger
    },

    end(): void {
      // No-op for non-span logger
    },
  }

  return logger
}

// ============ Main Thread Side ============

export interface WorkerConsoleHandlerOptions {
  /** Default namespace if message doesn't include one */
  defaultNamespace?: string
  /** Custom logger to use (defaults to creating one with the namespace) */
  logger?: Logger
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
 *   } else {
 *     // Handle other message types
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

// ============ Full Logger Handler ============

export interface WorkerLogHandlerOptions {
  /** @deprecated Span output is now controlled by TRACE env var */
  enableSpans?: boolean
}

/**
 * Create a handler for worker logger messages (logs and spans).
 *
 * Use this on the main thread to receive and output messages from workers
 * that use createWorkerLogger.
 *
 * @param options - Handler options
 * @returns Handler function to call with worker messages
 *
 * @example
 * ```typescript
 * import { createWorkerLogHandler, isWorkerMessage } from "loggily/worker"
 *
 * const handleLog = createWorkerLogHandler()
 *
 * worker.onmessage = (e) => {
 *   if (isWorkerMessage(e.data)) {
 *     handleLog(e.data)
 *   } else {
 *     // Handle other message types
 *   }
 * }
 * ```
 */
export function createWorkerLogHandler(options: WorkerLogHandlerOptions = {}): (message: WorkerMessage) => void {
  const loggers = new Map<string, ConditionalLogger>()

  function getLogger(namespace: string): ConditionalLogger {
    let logger = loggers.get(namespace)
    if (!logger) {
      logger = createLogger(namespace)
      loggers.set(namespace, logger)
    }
    return logger
  }

  return (message: WorkerMessage) => {
    if (isWorkerConsoleMessage(message)) {
      const logger = getLogger(message.namespace || "worker")
      const { message: msg, data } = formatConsoleArgs(message.args)
      dispatchToLogger(logger, message.level, msg, data)
    } else if (isWorkerLogMessage(message)) {
      const logger = getLogger(message.namespace)
      dispatchToLogger(logger, message.level, message.message, message.data)
    } else if (isWorkerSpanMessage(message)) {
      if (message.event === "end") {
        const logger = getLogger(message.namespace)
        const span = logger.span?.(undefined, { ...message.props, ...message.spanData })
        span?.end()
      }
      // Start events are informational only on main thread
      // (the actual timing happens in the worker)
    }
  }
}

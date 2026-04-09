/**
 * loggily - Structured logging with spans
 *
 * Logger-first architecture: Span = Logger + Duration
 *
 * @example
 * const log = createLogger('myapp')
 *
 * // Simple logging
 * log.info('starting')
 *
 * // Lazy messages (function not called when level is disabled)
 * log.debug?.(() => `expensive: ${computeState()}`)
 *
 * // Child loggers with context fields
 * const reqLog = log.child({ requestId: 'abc' })
 * reqLog.info('handling request')  // includes requestId in every message
 *
 * // With timing (span)
 * {
 *   using task = log.span('import', { file: 'data.csv' })
 *   task.info('importing')
 *   task.spanData.count = 42  // Set span attributes
 *   // Auto-disposal on block exit → SPAN myapp:import (15ms)
 * }
 */

import { colors as pc } from "./colors.js"

// ============ Metrics ============

/** Data passed to span recorders on disposal */
export interface SpanRecord {
  readonly name: string
  readonly durationMs: number
}

/** Interface for span duration recording — implemented by createMetricsCollector() in metrics.ts */
export interface SpanRecorder {
  recordSpan(data: SpanRecord): void
}

/**
 * Ambient span recorder — auto-records when TRACE is active.
 * Set by metrics.ts on import; can be replaced for testing.
 * @internal
 */
export let _ambientRecorder: SpanRecorder | null = null
export function _setAmbientRecorder(recorder: SpanRecorder | null): void {
  _ambientRecorder = recorder
}

// ============ Runtime Detection ============

/** Cached process reference — undefined in browser/edge runtimes */
const _process = typeof process !== "undefined" ? process : undefined

/** Read an environment variable, returning undefined in non-Node runtimes */
function getEnv(key: string): string | undefined {
  return _process?.env?.[key]
}

/** Write to stderr with console.error fallback for non-Node runtimes */
function writeStderr(text: string): void {
  if (_process?.stderr?.write) {
    _process.stderr.write(text + "\n")
  } else {
    console.error(text)
  }
}

// ============ Types ============

/** Log levels that produce output */
export type OutputLogLevel = "trace" | "debug" | "info" | "warn" | "error"

/** All log levels including silent (for filtering) */
export type LogLevel = OutputLogLevel | "silent"

/** Message can be a string or a lazy function that returns a string */
export type LazyMessage = string | (() => string)

/** Span props can be an object or a lazy function (skipped entirely via ?. when tracing is off) */
export type LazyProps = Record<string, unknown> | (() => Record<string, unknown>)

/** Span data accessible via logger.spanData */
export interface SpanData {
  readonly id: string
  readonly traceId: string
  readonly parentId: string | null
  readonly startTime: number
  readonly endTime: number | null
  readonly duration: number | null
  /** Custom attributes - set via direct property assignment */
  [key: string]: unknown
}

/** Logger interface */
export interface Logger {
  /** Logger namespace (e.g., 'myapp:import') */
  readonly name: string
  /** Props inherited from parent + own props */
  readonly props: Readonly<Record<string, unknown>>
  /** Span data (non-null for span loggers, null for regular loggers) */
  readonly spanData: SpanData | null

  // Logging methods (accept string or lazy () => string)
  trace(message: LazyMessage, data?: Record<string, unknown>): void
  debug(message: LazyMessage, data?: Record<string, unknown>): void
  info(message: LazyMessage, data?: Record<string, unknown>): void
  warn(message: LazyMessage, data?: Record<string, unknown>): void
  error(message: LazyMessage, data?: Record<string, unknown>): void
  /** Error overload - extracts message, stack, code from Error */
  error(error: Error, data?: Record<string, unknown>): void

  // Create children
  /** Create child logger (extends namespace, inherits props) */
  logger(namespace?: string, props?: Record<string, unknown>): Logger
  /** Create child span (extends namespace, inherits props, adds timing). Props can be lazy. */
  span(namespace?: string, props?: LazyProps): SpanLogger

  /** Create child logger with context fields merged into every message */
  child(context: Record<string, unknown>): Logger
  /** @deprecated Use .logger() instead for namespace-based children */
  child(context: string): Logger

  /** End span manually (alternative to using keyword) */
  end(): void
}

/** Span logger - Logger with active span (spanData is non-null, implements Disposable) */
export interface SpanLogger extends Logger, Disposable {
  readonly spanData: SpanData & {
    /** Mutable attributes - set directly */
    [key: string]: unknown
  }
}

// ============ Writers ============

type LogWriter = (formatted: string, level: string) => void
const writers: LogWriter[] = []

/** Add a writer that receives all formatted log output. Returns unsubscribe. */
export function addWriter(writer: LogWriter): () => void {
  writers.push(writer)
  return () => {
    const idx = writers.indexOf(writer)
    if (idx !== -1) writers.splice(idx, 1)
  }
}

let suppressConsole = false

/** Suppress console output from the logger (writers still receive output). */
export function setSuppressConsole(value: boolean): void {
  suppressConsole = value
}

/** Output mode for writeLog */
export type OutputMode = "console" | "stderr" | "writers-only"
let outputMode: OutputMode = "console"

/** Set output mode for log messages (not spans — spans always use stderr). */
export function setOutputMode(mode: OutputMode): void {
  outputMode = mode
}

/** Get current output mode */
export function getOutputMode(): OutputMode {
  return outputMode
}

// ============ Configuration ============

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
}

// Initialize from environment
const envLogLevel = getEnv("LOG_LEVEL")?.toLowerCase()
let currentLogLevel: LogLevel =
  envLogLevel === "trace" ||
  envLogLevel === "debug" ||
  envLogLevel === "info" ||
  envLogLevel === "warn" ||
  envLogLevel === "error" ||
  envLogLevel === "silent"
    ? envLogLevel
    : "info"

// Span output control (TRACE=1 or TRACE=myapp,other)
const traceEnv = getEnv("TRACE")
let spansEnabled = traceEnv === "1" || traceEnv === "true"
let traceFilter: Set<string> | null = null
if (traceEnv && traceEnv !== "1" && traceEnv !== "true") {
  traceFilter = new Set(traceEnv.split(",").map((s) => s.trim()))
  spansEnabled = true
}

// Debug namespace filter (DEBUG=myapp or DEBUG=myapp,-myapp:noisy or DEBUG=*)
// Supports negative patterns with `-` prefix (like the `debug` npm package)

/** Parse a comma-separated namespace filter into include/exclude sets */
function parseNamespaceFilter(input: string[]): {
  includes: Set<string> | null
  excludes: Set<string> | null
} {
  const includeList: string[] = []
  const excludeList: string[] = []
  for (const part of input) {
    if (part.startsWith("-")) {
      excludeList.push(part.slice(1))
    } else {
      includeList.push(part)
    }
  }
  return {
    includes: includeList.length > 0 ? new Set(includeList) : null,
    excludes: excludeList.length > 0 ? new Set(excludeList) : null,
  }
}

const debugEnv = getEnv("DEBUG")
let debugIncludes: Set<string> | null = null
let debugExcludes: Set<string> | null = null
if (debugEnv) {
  const parts = debugEnv.split(",").map((s) => s.trim())
  const parsed = parseNamespaceFilter(parts)
  debugIncludes = parsed.includes
  // Normalize wildcard variants
  if (debugIncludes && [...debugIncludes].some((p) => p === "*" || p === "1" || p === "true")) {
    debugIncludes = new Set(["*"])
  }
  debugExcludes = parsed.excludes
  // Auto-lower log level to at least debug when DEBUG is set
  if (LOG_LEVEL_PRIORITY[currentLogLevel] > LOG_LEVEL_PRIORITY.debug) {
    currentLogLevel = "debug"
  }
}

/** Set minimum log level */
export function setLogLevel(level: LogLevel): void {
  currentLogLevel = level
}

/** Get current log level */
export function getLogLevel(): LogLevel {
  return currentLogLevel
}

/** Enable span output */
export function enableSpans(): void {
  spansEnabled = true
}

/** Disable span output */
export function disableSpans(): void {
  spansEnabled = false
}

/** Check if spans are enabled */
export function spansAreEnabled(): boolean {
  return spansEnabled
}

/**
 * Set trace filter for namespace-based span output control.
 * Only spans matching these namespace prefixes will be output.
 * @param namespaces - Array of namespace prefixes, or null to disable filtering
 */
export function setTraceFilter(namespaces: string[] | null): void {
  if (namespaces === null || namespaces.length === 0) {
    traceFilter = null
  } else {
    traceFilter = new Set(namespaces)
    spansEnabled = true
  }
}

/** Get current trace filter (null means no filtering) */
export function getTraceFilter(): string[] | null {
  return traceFilter ? [...traceFilter] : null
}

/**
 * Set debug namespace filter (like the `debug` npm package).
 * When set, only loggers matching these namespace prefixes produce output.
 * Supports negative patterns with `-` prefix (e.g., ["-km:noisy"]).
 * Also ensures log level is at least `debug`.
 * @param namespaces - Array of namespace prefixes (prefix with `-` to exclude), or null to disable
 */
export function setDebugFilter(namespaces: string[] | null): void {
  if (namespaces === null || namespaces.length === 0) {
    debugIncludes = null
    debugExcludes = null
  } else {
    const parsed = parseNamespaceFilter(namespaces)
    debugIncludes = parsed.includes
    debugExcludes = parsed.excludes
    if (LOG_LEVEL_PRIORITY[currentLogLevel] > LOG_LEVEL_PRIORITY.debug) {
      currentLogLevel = "debug"
    }
  }
}

/** Get current debug namespace filter (null means no filtering) */
export function getDebugFilter(): string[] | null {
  if (!debugIncludes && !debugExcludes) return null
  const result: string[] = []
  if (debugIncludes) result.push(...debugIncludes)
  if (debugExcludes) result.push(...[...debugExcludes].map((e) => `-${e}`))
  return result
}

// ============ Log Format ============

/** Output format: human-readable console or structured JSON */
export type LogFormat = "console" | "json"

// Initialize from LOG_FORMAT env var, falling back to auto-detect
const envLogFormat = getEnv("LOG_FORMAT")?.toLowerCase()
let currentLogFormat: LogFormat = envLogFormat === "json" ? "json" : envLogFormat === "console" ? "console" : "console"

/** Set log output format */
export function setLogFormat(format: LogFormat): void {
  currentLogFormat = format
}

/** Get current log output format */
export function getLogFormat(): LogFormat {
  return currentLogFormat
}

/** Determine whether to use JSON formatting for the current call */
function useJsonFormat(): boolean {
  return currentLogFormat === "json" || getEnv("NODE_ENV") === "production" || getEnv("TRACE_FORMAT") === "json"
}

// ============ ID Generation (delegated to tracing.ts) ============

import { generateSpanId, generateTraceId, resetIdCounters, shouldSample } from "./tracing.js"

// Reset for testing
export function resetIds(): void {
  resetIdCounters()
}

// ============ Context Propagation Hooks ============

// These are set by context.ts when enableContextPropagation() is called.
// Kept as nullable callbacks to avoid importing AsyncLocalStorage in browser.

/** Hook to get current span context tags (trace_id, span_id) for auto-tagging logs */
let _getContextTags: (() => Record<string, string>) | null = null

/** Hook to get parent span info from async context */
let _getContextParent: (() => { spanId: string; traceId: string } | null) | null = null

/** Hook to enter a span context (sets AsyncLocalStorage for the current async scope) */
let _enterContext: ((spanId: string, traceId: string, parentId: string | null) => void) | null = null

/** Hook to exit a span context (restores previous context snapshot) */
let _exitContext: ((spanId: string) => void) | null = null

/**
 * Register context propagation hooks (called by context.ts).
 * @internal
 */
export function _setContextHooks(hooks: {
  getContextTags: () => Record<string, string>
  getContextParent: () => { spanId: string; traceId: string } | null
  enterContext: (spanId: string, traceId: string, parentId: string | null) => void
  exitContext: (spanId: string) => void
}): void {
  _getContextTags = hooks.getContextTags
  _getContextParent = hooks.getContextParent
  _enterContext = hooks.enterContext
  _exitContext = hooks.exitContext
}

/**
 * Clear context propagation hooks (called by disableContextPropagation).
 * @internal
 */
export function _clearContextHooks(): void {
  _getContextTags = null
  _getContextParent = null
  _enterContext = null
  _exitContext = null
}

// ============ Formatting ============

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVEL_PRIORITY[level] >= LOG_LEVEL_PRIORITY[currentLogLevel]
}

function shouldTraceNamespace(namespace: string): boolean {
  if (!spansEnabled) return false
  if (!traceFilter) return true
  return matchesNamespaceSet(namespace, traceFilter)
}

/**
 * Safe JSON.stringify that handles bigint, circular refs, symbols, and Error objects.
 * Prevents crashes from non-serializable values in log data.
 */
function safeStringify(value: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString()
    if (typeof val === "symbol") return val.toString()
    if (val instanceof Error) return { message: val.message, stack: val.stack, name: val.name }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]"
      seen.add(val)
    }
    return val
  })
}

function formatConsole(namespace: string, level: string, message: string, data?: Record<string, unknown>): string {
  const time = pc.dim(new Date().toISOString().split("T")[1]?.split(".")[0] || "")

  let levelStr = ""
  switch (level) {
    case "trace":
      levelStr = pc.dim("TRACE")
      break
    case "debug":
      levelStr = pc.dim("DEBUG")
      break
    case "info":
      levelStr = pc.blue("INFO")
      break
    case "warn":
      levelStr = pc.yellow("WARN")
      break
    case "error":
      levelStr = pc.red("ERROR")
      break
    case "span":
      levelStr = pc.magenta("SPAN")
      break
  }

  const ns = pc.cyan(namespace)
  let output = `${time} ${levelStr} ${ns} ${message}`

  if (data && Object.keys(data).length > 0) {
    output += ` ${pc.dim(safeStringify(data))}`
  }

  return output
}

function formatJSON(namespace: string, level: string, message: string, data?: Record<string, unknown>): string {
  const entry = {
    time: new Date().toISOString(),
    level,
    name: namespace,
    msg: message,
    ...data,
  }
  return safeStringify(entry)
}

function matchesNamespaceSet(namespace: string, set: Set<string>): boolean {
  if (set.has("*")) return true
  for (const filter of set) {
    if (namespace === filter || namespace.startsWith(filter + ":")) {
      return true
    }
  }
  return false
}

function shouldDebugNamespace(namespace: string): boolean {
  if (!debugIncludes && !debugExcludes) return true
  // Excludes take priority
  if (debugExcludes && matchesNamespaceSet(namespace, debugExcludes)) {
    return false
  }
  // If includes are set, namespace must match
  if (debugIncludes) return matchesNamespaceSet(namespace, debugIncludes)
  return true
}

/** Resolve a lazy message: if it's a function, call it; otherwise return the string */
function resolveMessage(msg: LazyMessage): string {
  return typeof msg === "function" ? msg() : msg
}

function writeLog(
  namespace: string,
  level: OutputLogLevel,
  message: LazyMessage,
  data?: Record<string, unknown>,
): void {
  if (!shouldLog(level)) return
  if (!shouldDebugNamespace(namespace)) return

  // Resolve lazy message only after level/namespace checks pass
  const resolved = resolveMessage(message)

  // Auto-tag with trace/span context when context propagation is enabled
  const contextTags = _getContextTags?.()
  const mergedData = contextTags && Object.keys(contextTags).length > 0 ? { ...contextTags, ...data } : data

  const formatted = useJsonFormat()
    ? formatJSON(namespace, level, resolved, mergedData)
    : formatConsole(namespace, level, resolved, mergedData)

  for (const w of writers) w(formatted, level)

  if (suppressConsole || outputMode === "writers-only") return

  if (outputMode === "stderr") {
    writeStderr(formatted)
    return
  }

  // Default: use console methods (captured by Ink's patchConsole for TUI panel)
  switch (level) {
    case "trace":
    case "debug":
      console.debug(formatted)
      break
    case "info":
      console.info(formatted)
      break
    case "warn":
      console.warn(formatted)
      break
    case "error":
      console.error(formatted)
      break
  }
}

export function writeSpan(namespace: string, duration: number, attrs: Record<string, unknown>): void {
  if (!shouldTraceNamespace(namespace)) return
  if (!shouldDebugNamespace(namespace)) return

  const message = `(${duration}ms)`
  const formatted = useJsonFormat()
    ? formatJSON(namespace, "span", message, { duration, ...attrs })
    : formatConsole(namespace, "span", message, { duration, ...attrs })

  for (const w of writers) w(formatted, "span")
  if (!suppressConsole) writeStderr(formatted)
}

// ============ Shared SpanData Proxy ============

interface SpanDataFields {
  id: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime: number | null
  duration: number | null
}

/**
 * Create a proxy that exposes span metadata as readonly and custom attributes as writable.
 * Shared between core logger spans and worker logger spans.
 */
export function createSpanDataProxy(getFields: () => SpanDataFields, attrs: Record<string, unknown>): SpanData {
  const READONLY_KEYS = new Set(["id", "traceId", "parentId", "startTime", "endTime", "duration"])
  return new Proxy(attrs, {
    get(_target, prop) {
      if (READONLY_KEYS.has(prop as string)) {
        return getFields()[prop as keyof SpanDataFields]
      }
      return attrs[prop as string]
    },
    set(_target, prop, value) {
      if (READONLY_KEYS.has(prop as string)) {
        return false
      }
      attrs[prop as string] = value
      return true
    },
  }) as SpanData
}

// ============ Implementation ============

interface MutableSpanData {
  id: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime: number | null
  duration: number | null
  attrs: Record<string, unknown>
}

function createLoggerImpl(
  name: string,
  props: Record<string, unknown>,
  spanMeta: MutableSpanData | null,
  parentSpanId: string | null,
  traceId: string | null,
  traceSampled: boolean = true,
): Logger {
  const log = (level: OutputLogLevel, msgOrError: LazyMessage | Error, data?: Record<string, unknown>): void => {
    if (msgOrError instanceof Error) {
      const err = msgOrError
      writeLog(name, level, err.message, {
        ...props,
        ...data,
        error_type: err.name,
        error_stack: err.stack,
        error_code: (err as { code?: string }).code,
      })
    } else {
      writeLog(name, level, msgOrError, { ...props, ...data })
    }
  }

  const logger: Logger = {
    name,
    props: Object.freeze({ ...props }),

    get spanData(): SpanData | null {
      if (!spanMeta) return null
      return createSpanDataProxy(
        () => ({
          id: spanMeta.id,
          traceId: spanMeta.traceId,
          parentId: spanMeta.parentId,
          startTime: spanMeta.startTime,
          endTime: spanMeta.endTime,
          duration: spanMeta.endTime !== null ? spanMeta.endTime - spanMeta.startTime : Date.now() - spanMeta.startTime,
        }),
        spanMeta.attrs,
      )
    },

    trace: (msg, data) => log("trace", msg, data),
    debug: (msg, data) => log("debug", msg, data),
    info: (msg, data) => log("info", msg, data),
    warn: (msg, data) => log("warn", msg, data),
    error: (msgOrError, data) => log("error", msgOrError as string, data),

    logger(namespace?: string, childProps?: Record<string, unknown>): Logger {
      const childName = namespace ? `${name}:${namespace}` : name
      const mergedProps = { ...props, ...childProps }
      return createLoggerImpl(childName, mergedProps, null, parentSpanId, traceId, traceSampled)
    },

    span(namespace?: string, childProps?: LazyProps): SpanLogger {
      const childName = namespace ? `${name}:${namespace}` : name
      const resolvedChildProps = typeof childProps === "function" ? childProps() : childProps
      const mergedProps = { ...props, ...resolvedChildProps }
      const newSpanId = generateSpanId()

      // Resolve parent from context propagation if not explicitly set
      let resolvedParentId = parentSpanId
      let resolvedTraceId = traceId

      if (!resolvedParentId && _getContextParent) {
        const ctxParent = _getContextParent()
        if (ctxParent) {
          resolvedParentId = ctxParent.spanId
          resolvedTraceId = resolvedTraceId || ctxParent.traceId
        }
      }

      // Determine trace ID — generate new one if starting a new trace
      const isNewTrace = !resolvedTraceId
      const finalTraceId = resolvedTraceId || generateTraceId()

      // Head-based sampling: inherit from parent, or decide at trace creation
      const sampled = isNewTrace ? shouldSample() : traceSampled

      const newSpanData: MutableSpanData = {
        id: newSpanId,
        traceId: finalTraceId,
        parentId: resolvedParentId,
        startTime: Date.now(),
        endTime: null,
        duration: null,
        attrs: {},
      }

      const spanLogger = createLoggerImpl(
        childName,
        mergedProps,
        newSpanData,
        newSpanId,
        finalTraceId,
        sampled,
      ) as SpanLogger

      // Enter span context for async propagation (if enabled)
      _enterContext?.(newSpanId, finalTraceId, resolvedParentId)

      // Add disposal
      ;(spanLogger as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose] = () => {
        if (newSpanData.endTime !== null) return // Already disposed

        newSpanData.endTime = Date.now()
        newSpanData.duration = newSpanData.endTime - newSpanData.startTime

        // Collect span data if collection is active
        if (collectSpans) {
          collectedSpans.push(
            createSpanDataProxy(
              () => ({
                id: newSpanData.id,
                traceId: newSpanData.traceId,
                parentId: newSpanData.parentId,
                startTime: newSpanData.startTime,
                endTime: newSpanData.endTime,
                duration: newSpanData.duration,
              }),
              { ...newSpanData.attrs },
            ),
          )
        }

        // Exit span context (restore previous context snapshot)
        _exitContext?.(newSpanId)

        // Record to ambient recorder (auto-active when TRACE is on, set by metrics.ts)
        _ambientRecorder?.recordSpan({ name: childName, durationMs: newSpanData.duration })

        // Only emit span if sampled
        if (sampled) {
          writeSpan(childName, newSpanData.duration, {
            span_id: newSpanData.id,
            trace_id: newSpanData.traceId,
            parent_id: newSpanData.parentId,
            ...mergedProps,
            ...newSpanData.attrs,
          })
        }
      }

      return spanLogger
    },

    child(context: string | Record<string, unknown>): Logger {
      if (typeof context === "string") {
        // Deprecated string overload - use .logger() instead
        return this.logger(context)
      }
      // Context object overload: merge context fields into props
      return createLoggerImpl(name, { ...props, ...context }, null, parentSpanId, traceId, traceSampled)
    },

    end(): void {
      if (spanMeta?.endTime === null) {
        ;(this as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose]?.()
      }
    },
  }

  return logger
}

/**
 * Create a plain logger for a component (internal use).
 * For application code, use createLogger() instead which returns undefined for disabled levels.
 */
function createPlainLogger(name: string, props?: Record<string, unknown>): Logger {
  return createLoggerImpl(name, props || {}, null, null, null)
}

// ============ Collected Spans (for analysis) ============

const collectedSpans: SpanData[] = []
let collectSpans = false

/** Enable span collection for analysis */
export function startCollecting(): void {
  collectSpans = true
  collectedSpans.length = 0
}

/** Stop collecting and return collected spans */
export function stopCollecting(): SpanData[] {
  collectSpans = false
  return [...collectedSpans]
}

/** Get collected spans */
export function getCollectedSpans(): SpanData[] {
  return [...collectedSpans]
}

/** Clear collected spans */
export function clearCollectedSpans(): void {
  collectedSpans.length = 0
}

// ============ Conditional Logger (Zero-Overhead Pattern) ============

/**
 * Logger with optional methods — returns undefined for disabled levels.
 * Use with optional chaining: `log.debug?.("msg")` for zero-overhead when disabled.
 *
 * Defined as an explicit interface (not Omit<Logger,...>) so that
 * oxlint's type-aware mode can resolve it without advanced type inference.
 */
export interface ConditionalLogger {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  readonly spanData: SpanData | null

  trace?: (message: LazyMessage, data?: Record<string, unknown>) => void
  debug?: (message: LazyMessage, data?: Record<string, unknown>) => void
  info?: (message: LazyMessage, data?: Record<string, unknown>) => void
  warn?: (message: LazyMessage, data?: Record<string, unknown>) => void
  error?: {
    (message: LazyMessage, data?: Record<string, unknown>): void
    (error: Error, data?: Record<string, unknown>): void
  }

  logger(namespace?: string, props?: Record<string, unknown>): Logger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(context: Record<string, unknown>): Logger
  child(context: string): Logger
  end(): void
}

/**
 * Create a logger for a component.
 * Returns undefined for disabled levels - use with optional chaining for zero overhead.
 *
 * Log levels (most → least verbose): trace < debug < info < warn < error < silent
 * Default level: info (trace and debug disabled)
 *
 * @example
 * const log = createLogger('myapp')
 *
 * // All methods support ?. for zero-overhead when disabled
 * log.trace?.(`very verbose: ${expensiveDebug()}`)  // Skipped at info level
 * log.debug?.(`debug: ${getState()}`)               // Skipped at info level
 * log.info?.('starting')                            // Enabled at info level
 * log.warn?.('deprecated')                          // Enabled at info level
 * log.error?.('failed')                             // Enabled at info level
 *
 * // With -q flag or LOG_LEVEL=warn:
 * log.info?.('starting')  // Now skipped - info < warn
 *
 * // With initial props
 * const log = createLogger('myapp', { version: '1.0' })
 *
 * // Create spans
 * {
 *   using task = log.span('import', { file: 'data.csv' })
 *   task.info?.('importing')
 *   task.spanData.count = 42
 * }
 */
export function createLogger(name: string, props?: Record<string, unknown>): ConditionalLogger {
  const baseLog = createPlainLogger(name, props)

  return new Proxy(baseLog as ConditionalLogger, {
    get(target, prop: string) {
      if (prop in LOG_LEVEL_PRIORITY && prop !== "silent") {
        const current = LOG_LEVEL_PRIORITY[currentLogLevel]
        if (LOG_LEVEL_PRIORITY[prop as keyof typeof LOG_LEVEL_PRIORITY] < current) {
          return undefined
        }
      }
      return (target as unknown as Record<string, unknown>)[prop]
    },
  })
}

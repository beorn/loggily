/**
 * loggily v2 — Structured logging with spans
 *
 * One import. Objects configure. Arrays branch. Values write.
 *
 * @example
 * const log = createLogger('myapp')
 * log.info?.('starting')
 *
 * @example
 * const log = createLogger('myapp', [
 *   { level: 'debug', ns: '-sql' },
 *   console,
 *   { file: '/tmp/app.log', level: 'info', format: 'json' },
 * ])
 * log.info?.('server started', { port: 3000 })
 */

import {
  type Event,
  type LogEvent,
  type SpanEvent,
  type Pipeline,
  type Stage,
  type LogLevel,
  type OutputLogLevel,
  type LogFormat,
  type NsFilter,
  type ConfigElement,
  LOG_LEVEL_PRIORITY,
  buildPipeline,
  safeStringify,
  serializeCause,
  readEnvLevel,
  readEnvLevelForNamespace,
  readEnvNs,
  readEnvFormat,
  readEnvTrace,
  writeToConsole,
  formatConsoleEvent,
  formatJSONEvent,
} from "./pipeline.js"

export type { Event, LogEvent, SpanEvent, Stage, LogLevel, OutputLogLevel, LogFormat, ConfigElement }
export { LOG_LEVEL_PRIORITY, safeStringify }

// ============ Metrics ============

export interface SpanRecord {
  readonly name: string
  readonly durationMs: number
}

export interface SpanRecorder {
  recordSpan(data: SpanRecord): void
}

// ============ Types ============

export type LazyMessage = string | (() => string)
export type LazyProps = Record<string, unknown> | (() => Record<string, unknown>)

export interface SpanData {
  readonly id: string
  readonly traceId: string
  readonly parentId: string | null
  readonly startTime: number
  readonly endTime: number | null
  readonly duration: number | null
  [key: string]: unknown
}

export interface Logger extends Disposable {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  readonly level: LogLevel

  dispatch(event: Event): void

  trace(message: LazyMessage, data?: Record<string, unknown>): void
  debug(message: LazyMessage, data?: Record<string, unknown>): void
  info(message: LazyMessage, data?: Record<string, unknown>): void
  warn(message: LazyMessage, data?: Record<string, unknown>): void
  error(message: LazyMessage, data?: Record<string, unknown>): void
  error(error: Error, data?: Record<string, unknown>): void
  error(error: Error, message: string, data?: Record<string, unknown>): void

  /** @deprecated Use .child() */
  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(namespace: string, props?: Record<string, unknown>): ConditionalLogger
  child(context: Record<string, unknown>): ConditionalLogger
  end(): void
}

export interface SpanLogger extends ConditionalLogger, Disposable {
  readonly spanData: SpanData & { [key: string]: unknown }
}

// ============ ConditionalLogger ============

export interface ConditionalLogger extends Disposable {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  readonly level: LogLevel

  dispatch(event: Event): void

  trace?: (message: LazyMessage, data?: Record<string, unknown>) => void
  debug?: (message: LazyMessage, data?: Record<string, unknown>) => void
  info?: (message: LazyMessage, data?: Record<string, unknown>) => void
  warn?: (message: LazyMessage, data?: Record<string, unknown>) => void
  error?: {
    (message: LazyMessage, data?: Record<string, unknown>): void
    (error: Error, data?: Record<string, unknown>): void
    (error: Error, message: string, data?: Record<string, unknown>): void
  }

  /** @deprecated Use .child() */
  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span?(namespace?: string, props?: LazyProps): SpanLogger
  child(namespace: string, props?: Record<string, unknown>): ConditionalLogger
  child(context: Record<string, unknown>): ConditionalLogger
  end(): void
}

// ============ ID Generation ============

import {
  generateSpanId,
  generateTraceId,
  resetIdCounters,
  shouldSample,
  setIdFormat,
  setSampleRate,
} from "./tracing.js"
import type { IdFormat } from "./tracing.js"

export function resetIds(): void {
  resetIdCounters()
}

// ============ Context Propagation Hooks ============

let _getContextTags: (() => Record<string, string>) | null = null
let _getContextParent: (() => { spanId: string; traceId: string } | null) | null = null
let _enterContext: ((spanId: string, traceId: string, parentId: string | null) => void) | null = null
let _exitContext: ((spanId: string) => void) | null = null

/** @internal */
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

/** @internal */
export function _clearContextHooks(): void {
  _getContextTags = null
  _getContextParent = null
  _enterContext = null
  _exitContext = null
}

// ============ SpanData Proxy ============

interface SpanDataFields {
  id: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime: number | null
  duration: number | null
}

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

// ============ Span Collection ============

const collectedSpans: SpanData[] = []
let collectSpans = false

export function startCollecting(): void {
  collectSpans = true
  collectedSpans.length = 0
}

export function stopCollecting(): SpanData[] {
  collectSpans = false
  return [...collectedSpans]
}

export function getCollectedSpans(): SpanData[] {
  return [...collectedSpans]
}

export function clearCollectedSpans(): void {
  collectedSpans.length = 0
}

// ============ Implementation ============

function resolveMessage(msg: LazyMessage): string {
  return typeof msg === "function" ? msg() : msg
}

interface MutableSpanData {
  id: string
  traceId: string
  parentId: string | null
  startTime: number
  endTime: number | null
  duration: number | null
  attrs: Record<string, unknown>
}

function createLoggerImpl(name: string, props: Record<string, unknown>, pipeline: Pipeline): Logger {
  const emitLog = (
    level: OutputLogLevel,
    msgOrError: LazyMessage | Error,
    dataOrMsg?: Record<string, unknown> | string,
    extraData?: Record<string, unknown>,
  ): void => {
    let message: string
    let data: Record<string, unknown> | undefined

    if (msgOrError instanceof Error) {
      const err = msgOrError
      const contextTags = _getContextTags?.() ?? {}
      if (typeof dataOrMsg === "string") {
        message = dataOrMsg
        data = {
          ...contextTags,
          ...props,
          ...extraData,
          error_type: err.name,
          error_message: err.message,
          error_stack: err.stack,
          error_code: (err as { code?: string }).code,
          error_cause: err.cause !== undefined ? serializeCause(err.cause) : undefined,
        }
      } else {
        message = err.message
        data = {
          ...contextTags,
          ...props,
          ...(dataOrMsg as Record<string, unknown>),
          error_type: err.name,
          error_stack: err.stack,
          error_code: (err as { code?: string }).code,
          error_cause: err.cause !== undefined ? serializeCause(err.cause) : undefined,
        }
      }
    } else {
      message = resolveMessage(msgOrError)
      const contextTags = _getContextTags?.()
      data =
        contextTags && Object.keys(contextTags).length > 0
          ? { ...contextTags, ...props, ...(dataOrMsg as Record<string, unknown>) }
          : Object.keys(props).length > 0 || dataOrMsg
            ? { ...props, ...(dataOrMsg as Record<string, unknown>) }
            : undefined
    }

    const event: LogEvent = {
      kind: "log",
      time: Date.now(),
      namespace: name,
      level,
      message,
      props: data,
    }
    pipeline.dispatch(event)
  }

  const logger: Logger = {
    name,
    props: Object.freeze({ ...props }),

    get level(): LogLevel {
      return pipeline.level
    },

    dispatch(event: Event): void {
      pipeline.dispatch(event)
    },

    [Symbol.dispose](): void {
      pipeline.dispose()
    },

    trace: (msg, data) => emitLog("trace", msg, data),
    debug: (msg, data) => emitLog("debug", msg, data),
    info: (msg, data) => emitLog("info", msg, data),
    warn: (msg, data) => emitLog("warn", msg, data),
    error: (
      msgOrError: LazyMessage | Error,
      dataOrMsg?: Record<string, unknown> | string,
      extraData?: Record<string, unknown>,
    ) => emitLog("error", msgOrError, dataOrMsg, extraData),

    /** @deprecated Use .child() instead */
    logger(namespace?: string, childProps?: Record<string, unknown>): ConditionalLogger {
      return this.child(namespace ?? "", childProps)
    },

    span(_namespace?: string, _childProps?: LazyProps): SpanLogger {
      throw new Error(
        "loggily: span() requires the withSpans() plugin. Use pipe(baseCreateLogger, withSpans()) or the default createLogger.",
      )
    },

    child(
      namespaceOrContext?: string | Record<string, unknown>,
      childProps?: Record<string, unknown>,
    ): ConditionalLogger {
      if (typeof namespaceOrContext === "string") {
        const childName = namespaceOrContext ? `${name}:${namespaceOrContext}` : name
        const mergedProps = { ...props, ...childProps }
        return wrapConditional(createLoggerImpl(childName, mergedProps, pipeline), () => pipeline.level)
      }
      // Object -> context fields, same namespace
      return wrapConditional(
        createLoggerImpl(name, { ...props, ...namespaceOrContext }, pipeline),
        () => pipeline.level,
      )
    },

    end(): void {
      // no-op for non-span loggers
    },
  }

  return logger
}

// ============ ConditionalLogger Proxy ============

function wrapConditional(logger: Logger, getLevel: () => LogLevel): ConditionalLogger {
  return new Proxy(logger as ConditionalLogger, {
    get(target, prop: string | symbol) {
      if (typeof prop === "string" && prop in LOG_LEVEL_PRIORITY && prop !== "silent") {
        if (LOG_LEVEL_PRIORITY[prop as keyof typeof LOG_LEVEL_PRIORITY] < LOG_LEVEL_PRIORITY[getLevel()]) {
          return undefined
        }
      }
      // span is optional on ConditionalLogger: return undefined if base impl is the error-thrower
      if (prop === "span") {
        const val = (target as unknown as Record<string | symbol, unknown>)[prop]
        // If span is the default error-throwing stub, return undefined (making it optional)
        if (val === baseSpanStub) return undefined
        return val
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop]
    },
  })
}

// Sentinel reference for detecting the base span stub
const baseSpanStub = function baseSpanStub(_namespace?: string, _childProps?: LazyProps): SpanLogger {
  throw new Error(
    "loggily: span() requires the withSpans() plugin. Use pipe(baseCreateLogger, withSpans()) or the default createLogger.",
  )
}

// ============ withSpans Plugin ============

/**
 * Plugin: adds span creation capability to loggers.
 * Without this plugin, `.span` is undefined on ConditionalLogger.
 * Included by default in `createLogger`.
 */
export function withSpans(): LoggerPlugin {
  return (factory, _ctx) => {
    return (name, configOrProps?) => {
      const logger = factory(name, configOrProps)
      return augmentWithSpans(logger, null, null, true)
    }
  }
}

interface SpanState {
  parentSpanId: string | null
  traceId: string | null
  traceSampled: boolean
}

function augmentWithSpans(
  logger: ConditionalLogger,
  parentSpanId: string | null,
  traceId: string | null,
  traceSampled: boolean,
): ConditionalLogger {
  const spanState: SpanState = { parentSpanId, traceId, traceSampled }

  return new Proxy(logger, {
    get(target, prop: string | symbol) {
      if (prop === "span") {
        return createSpanMethod(target, spanState)
      }
      if (prop === "child") {
        return function child(
          namespaceOrContext?: string | Record<string, unknown>,
          childProps?: Record<string, unknown>,
        ): ConditionalLogger {
          const childLogger = target.child(namespaceOrContext as string, childProps)
          // Child loggers inherit span state (parent/trace context)
          return augmentWithSpans(childLogger, spanState.parentSpanId, spanState.traceId, spanState.traceSampled)
        }
      }
      if (prop === "logger") {
        return function logger(namespace?: string, childProps?: Record<string, unknown>): ConditionalLogger {
          const childLogger = target.logger(namespace, childProps)
          return augmentWithSpans(childLogger, spanState.parentSpanId, spanState.traceId, spanState.traceSampled)
        }
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop]
    },
  })
}

function createSpanMethod(
  logger: ConditionalLogger,
  spanState: SpanState,
): (namespace?: string, childProps?: LazyProps) => SpanLogger {
  return (namespace?: string, childProps?: LazyProps): SpanLogger => {
    const childName = namespace ? `${logger.name}:${namespace}` : logger.name
    const resolvedChildProps = typeof childProps === "function" ? childProps() : childProps
    const mergedProps = { ...logger.props, ...resolvedChildProps }
    const newSpanId = generateSpanId()

    let resolvedParentId = spanState.parentSpanId
    let resolvedTraceId = spanState.traceId

    if (!resolvedParentId && _getContextParent) {
      const ctxParent = _getContextParent()
      if (ctxParent) {
        resolvedParentId = ctxParent.spanId
        resolvedTraceId = resolvedTraceId || ctxParent.traceId
      }
    }

    const isNewTrace = !resolvedTraceId
    const finalTraceId = resolvedTraceId || generateTraceId()
    const sampled = isNewTrace ? shouldSample() : spanState.traceSampled

    const newSpanData: MutableSpanData = {
      id: newSpanId,
      traceId: finalTraceId,
      parentId: resolvedParentId,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      attrs: {},
    }

    // Create a child logger for the span to emit logs through
    const childLogger = logger.child(namespace ?? "", resolvedChildProps)
    // Augment the child with span capability, setting this span as parent
    const spanAugmented = augmentWithSpans(childLogger, newSpanId, finalTraceId, sampled)

    _enterContext?.(newSpanId, finalTraceId, resolvedParentId)

    const disposeSpan = () => {
      if (newSpanData.endTime !== null) return

      newSpanData.endTime = Date.now()
      newSpanData.duration = newSpanData.endTime - newSpanData.startTime

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

      _exitContext?.(newSpanId)
      if (sampled) {
        const spanEvent: SpanEvent = {
          kind: "span",
          time: newSpanData.endTime,
          namespace: childName,
          name: childName,
          duration: newSpanData.duration,
          props: {
            ...mergedProps,
            ...newSpanData.attrs,
          },
          spanId: newSpanData.id,
          traceId: newSpanData.traceId,
          parentId: newSpanData.parentId,
        }
        logger.dispatch(spanEvent)
      }
    }

    const spanDataProxy = createSpanDataProxy(
      () => ({
        id: newSpanData.id,
        traceId: newSpanData.traceId,
        parentId: newSpanData.parentId,
        startTime: newSpanData.startTime,
        endTime: newSpanData.endTime,
        duration:
          newSpanData.endTime !== null
            ? newSpanData.endTime - newSpanData.startTime
            : Date.now() - newSpanData.startTime,
      }),
      newSpanData.attrs,
    )

    // Build the SpanLogger by overlaying span-specific properties onto the augmented child.
    // Allow Symbol.dispose to be overridden (withMetrics wraps it).
    let currentDispose = disposeSpan
    const spanLogger = new Proxy(spanAugmented as unknown as SpanLogger, {
      get(target, prop: string | symbol) {
        if (prop === "spanData") return spanDataProxy
        if (prop === Symbol.dispose) return currentDispose
        if (prop === "end") {
          return () => {
            if (newSpanData.endTime === null) {
              currentDispose()
            }
          }
        }
        if (prop === "name") return childName
        if (prop === "props") return Object.freeze({ ...mergedProps })
        return (target as unknown as Record<string | symbol, unknown>)[prop]
      },
      set(_target, prop: string | symbol, value: unknown) {
        if (prop === Symbol.dispose) {
          currentDispose = value as () => void
          return true
        }
        return false
      },
    })

    return spanLogger
  }
}

// ============ Public API ============

// ============ Base createLogger ============

/**
 * Base createLogger — requires a config array.
 * Use the default `createLogger` export (with `withEnvDefaults`) for zero-config.
 *
 * Note: loggers from baseCreateLogger do NOT have `.span()` capability.
 * Use `pipe(baseCreateLogger, withSpans())` or the default `createLogger` for spans.
 */
export function baseCreateLogger(
  name: string,
  configOrProps?: ConfigElement[] | Record<string, unknown>,
): ConditionalLogger {
  let pipeline: Pipeline
  let props: Record<string, unknown> = {}

  if (Array.isArray(configOrProps)) {
    pipeline = buildPipeline(configOrProps)
  } else if (configOrProps && typeof configOrProps === "object") {
    props = configOrProps as Record<string, unknown>
    pipeline = buildPipeline(["console"])
  } else {
    pipeline = buildPipeline(["console"])
  }

  const logger = createLoggerImpl(name, props, pipeline)
  // Replace the span method with the sentinel stub so wrapConditional can detect it
  ;(logger as unknown as Record<string, unknown>).span = baseSpanStub
  return wrapConditional(logger, () => pipeline.level)
}

// ============ Compose ============

export type LoggerFactory = (
  name: string,
  configOrProps?: ConfigElement[] | Record<string, unknown>,
) => ConditionalLogger

export interface PluginCtx {
  [key: string]: unknown
}

export type LoggerPlugin = (factory: LoggerFactory, ctx: PluginCtx) => LoggerFactory

export function pipe(base: LoggerFactory, ...plugins: LoggerPlugin[]): LoggerFactory {
  const ctx: PluginCtx = {}
  return plugins.reduce((factory, plugin) => plugin(factory, ctx), base)
}

// ============ withEnvDefaults Plugin ============

const _process = typeof process !== "undefined" ? process : undefined
const _env = _process?.env ?? ({} as Record<string, string | undefined>)

// Env config — read fresh each dispatch (process.env access is ~ns, parsing is trivial)
function currentLevel(): LogLevel {
  return readEnvLevel()
}
function currentNs(): NsFilter | null {
  return readEnvNs()
}
function currentFormat(): LogFormat {
  return readEnvFormat()
}
function currentTrace(): { enabled: boolean; filter: NsFilter | null } {
  return readEnvTrace()
}

// Runtime state for legacy addWriter/setSuppressConsole
const _writers: Array<(formatted: string, level: string) => void> = []
let _suppressConsole = false

// File writer factory — set by index.ts (avoids node:fs in core.ts for browser compat)
let _logFileWriterFactory: ((path: string) => { write: (s: string) => void; close: () => void }) | null = null
/** @internal */
export function _setLogFileWriterFactory(factory: typeof _logFileWriterFactory): void {
  _logFileWriterFactory = factory
}

/**
 * Plugin: read defaults from environment variables (LOG_LEVEL, DEBUG, LOG_FORMAT, TRACE, LOG_FILE).
 * Included by default. Omit to disable env-var behavior entirely.
 *
 * When no config array is given, provides console output + env-var-based config.
 * When a config array IS given, env vars are already used as defaults by buildPipeline.
 * Legacy setters (setLogLevel, addWriter, etc.) affect loggers created without explicit config.
 */
export function withEnvDefaults(): LoggerPlugin {
  return (factory, _ctx) => (name, configOrProps?) => {
    // Apply tracing env vars (once per logger creation, idempotent)
    const envIdFormat = _env.TRACE_ID_FORMAT?.toLowerCase()
    if (envIdFormat === "simple" || envIdFormat === "w3c") {
      setIdFormat(envIdFormat as IdFormat)
    }
    const envSampleRate = _env.TRACE_SAMPLE_RATE
    if (envSampleRate !== undefined) {
      const rate = Number.parseFloat(envSampleRate)
      if (!Number.isNaN(rate) && rate >= 0 && rate <= 1) {
        setSampleRate(rate)
      }
    }

    // Explicit config array — pass through, buildPipeline reads env defaults
    if (Array.isArray(configOrProps)) return factory(name, configOrProps)

    // No config array — use env-dynamic pipeline.
    // Pass a config array through the factory so all upstream plugins get applied,
    // with a stage that delegates to the env pipeline for dynamic dispatch.
    const envPipeline = createEnvPipeline()
    const envStage: ConfigElement = (event: Event) => {
      envPipeline.dispatch(event)
      return null // consume the event (env pipeline handles all output)
    }

    // Props are passed as the first config element to include them in log output
    if (configOrProps && typeof configOrProps === "object") {
      // Object props — create logger with props + env pipeline
      // We need to pass props AND a config array. But factory only accepts one or the other.
      // Solution: create via factory with config array, then the child() with props.
      const logger = factory(name, [{ level: "trace" as LogLevel }, envStage])
      return applyNamespaceGating(logger.child(configOrProps as Record<string, unknown>))
    }

    return applyNamespaceGating(factory(name, [{ level: "trace" as LogLevel }, envStage]))
  }
}

/**
 * Wrap a logger so that conditional method gating is namespace-aware.
 * When DEBUG=myapp:db, only loggers whose namespace matches get debug enabled.
 * Without this, all loggers get debug because readEnvLevel() bumps globally.
 */
function applyNamespaceGating(logger: ConditionalLogger): ConditionalLogger {
  return new Proxy(logger, {
    get(target, prop: string | symbol) {
      if (typeof prop === "string" && prop in LOG_LEVEL_PRIORITY && prop !== "silent") {
        const nsLevel = readEnvLevelForNamespace(target.name)
        if (LOG_LEVEL_PRIORITY[prop as keyof typeof LOG_LEVEL_PRIORITY] < LOG_LEVEL_PRIORITY[nsLevel]) {
          return undefined
        }
      }
      return (target as unknown as Record<string | symbol, unknown>)[prop]
    },
  })
}

function createEnvPipeline(): Pipeline {
  const disposables: (() => void)[] = []
  const logFile = _env.LOG_FILE
  let fileSink: ((event: Event) => void) | null = null
  if (logFile && _logFileWriterFactory) {
    const writer = _logFileWriterFactory(logFile)
    fileSink = (event: Event) => {
      const fmt = currentFormat() === "json" ? formatJSONEvent : formatConsoleEvent
      writer.write(fmt(event))
    }
    disposables.push(() => writer.close())
  }

  const dispatch = (event: Event): void => {
    if (event.kind === "log" && LOG_LEVEL_PRIORITY[event.level] < LOG_LEVEL_PRIORITY[currentLevel()]) return
    if (event.kind === "span") {
      const trace = currentTrace()
      if (!trace.enabled) return
      if (trace.filter && !trace.filter(event.namespace)) return
    }
    const ns = currentNs()
    if (ns && !ns(event.namespace)) return

    const formatter = currentFormat() === "json" ? formatJSONEvent : formatConsoleEvent
    const text = formatter(event)
    const lvl = event.kind === "log" ? event.level : "span"

    for (const w of _writers) w(text, lvl)
    if (!_suppressConsole) writeToConsole(text, event)
    fileSink?.(event)
  }

  return {
    dispatch,
    get level() {
      return currentLevel()
    },
    dispose: () => {
      for (const d of disposables) d()
    },
  }
}

/** Default createLogger — includes withEnvDefaults + withSpans. */
export const createLogger: LoggerFactory = pipe(baseCreateLogger, withEnvDefaults(), withSpans())

/** Test helper — all levels, console output. */
export function createTestLogger(name: string): ConditionalLogger {
  return pipe(baseCreateLogger, withSpans())(name, [{ level: "trace" }, "console"])
}

// ============ Legacy Setters ============

/** @deprecated Use config array */
export function setLogLevel(level: LogLevel): void {
  _env.LOG_LEVEL = level
}
export function getLogLevel(): LogLevel {
  return currentLevel()
}
export function enableSpans(): void {
  _env.TRACE = "1"
}
export function disableSpans(): void {
  delete _env.TRACE
}
export function spansAreEnabled(): boolean {
  return !!_env.TRACE
}
export function setTraceFilter(namespaces: string[] | null): void {
  if (!namespaces || namespaces.length === 0) delete _env.TRACE
  else _env.TRACE = namespaces.join(",")
}
export function getTraceFilter(): string[] | null {
  return _env.TRACE ? _env.TRACE.split(",") : null
}
export function setDebugFilter(namespaces: string[] | null): void {
  if (!namespaces || namespaces.length === 0) delete _env.DEBUG
  else _env.DEBUG = namespaces.join(",")
}
export function getDebugFilter(): string[] | null {
  return _env.DEBUG ? _env.DEBUG.split(",") : null
}
export function setLogFormat(format: LogFormat): void {
  _env.LOG_FORMAT = format
}
export function getLogFormat(): LogFormat {
  return currentFormat()
}
export function setSuppressConsole(value: boolean): void {
  _suppressConsole = value
}
export type OutputMode = "console" | "stderr" | "writers-only"
export function setOutputMode(_mode: OutputMode): void {
  throw new Error(
    'loggily: setOutputMode() is removed in v2. Use config arrays: omit console from array for writers-only, use "stderr" for stderr mode.',
  )
}
export function getOutputMode(): OutputMode {
  return "console"
}
export function addWriter(writer: (formatted: string, level: string) => void): () => void {
  _writers.push(writer)
  return () => {
    const i = _writers.indexOf(writer)
    if (i !== -1) _writers.splice(i, 1)
  }
}
export function writeSpan(namespace: string, duration: number, attrs: Record<string, unknown>): void {
  createEnvPipeline().dispatch({
    kind: "span",
    time: Date.now(),
    namespace,
    name: namespace,
    duration,
    props: attrs,
    spanId: (attrs.span_id as string) ?? "",
    traceId: (attrs.trace_id as string) ?? "",
    parentId: (attrs.parent_id as string | null) ?? null,
  })
}

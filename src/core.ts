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
  LOG_LEVEL_PRIORITY,
  buildPipeline,
  defaultPipeline,
  runtimeState,
  safeStringify,
} from "./pipeline.js"

export type { Event, LogEvent, SpanEvent, Stage, LogLevel, OutputLogLevel, LogFormat }
export { LOG_LEVEL_PRIORITY, safeStringify }

// ============ Metrics ============

export interface SpanRecord {
  readonly name: string
  readonly durationMs: number
}

export interface SpanRecorder {
  recordSpan(data: SpanRecord): void
}

/** @internal */
export let _ambientRecorder: SpanRecorder | null = null
export function _setAmbientRecorder(recorder: SpanRecorder | null): void {
  _ambientRecorder = recorder
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

export interface Logger {
  readonly name: string
  readonly props: Readonly<Record<string, unknown>>
  readonly spanData: SpanData | null

  trace(message: LazyMessage, data?: Record<string, unknown>): void
  debug(message: LazyMessage, data?: Record<string, unknown>): void
  info(message: LazyMessage, data?: Record<string, unknown>): void
  warn(message: LazyMessage, data?: Record<string, unknown>): void
  error(message: LazyMessage, data?: Record<string, unknown>): void
  error(error: Error, data?: Record<string, unknown>): void
  error(error: Error, message: string, data?: Record<string, unknown>): void

  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(context: Record<string, unknown>): ConditionalLogger
  /** @deprecated Use .logger() instead for namespace-based children */
  child(context: string): ConditionalLogger
  end(): void
}

export interface SpanLogger extends Logger, Disposable {
  readonly spanData: SpanData & { [key: string]: unknown }
}

// ============ ConditionalLogger ============

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
    (error: Error, message: string, data?: Record<string, unknown>): void
  }

  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(context: Record<string, unknown>): ConditionalLogger
  child(context: string): ConditionalLogger
  end(): void
}

// ============ ID Generation ============

import { generateSpanId, generateTraceId, resetIdCounters, shouldSample } from "./tracing.js"

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

function createLoggerImpl(
  name: string,
  props: Record<string, unknown>,
  pipeline: Pipeline,
  spanMeta: MutableSpanData | null,
  parentSpanId: string | null,
  traceId: string | null,
  traceSampled: boolean = true,
): Logger {
  const emitLog = (level: OutputLogLevel, msgOrError: LazyMessage | Error, dataOrMsg?: Record<string, unknown> | string, extraData?: Record<string, unknown>): void => {
    let message: string
    let data: Record<string, unknown> | undefined

    if (msgOrError instanceof Error) {
      const err = msgOrError
      if (typeof dataOrMsg === "string") {
        message = dataOrMsg
        data = {
          ...props,
          ...extraData,
          error_type: err.name,
          error_message: err.message,
          error_stack: err.stack,
          error_code: (err as { code?: string }).code,
        }
      } else {
        message = err.message
        data = {
          ...props,
          ...(dataOrMsg as Record<string, unknown>),
          error_type: err.name,
          error_stack: err.stack,
          error_code: (err as { code?: string }).code,
        }
      }
    } else {
      message = resolveMessage(msgOrError)
      const contextTags = _getContextTags?.()
      data = contextTags && Object.keys(contextTags).length > 0
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

    trace: (msg, data) => emitLog("trace", msg, data),
    debug: (msg, data) => emitLog("debug", msg, data),
    info: (msg, data) => emitLog("info", msg, data),
    warn: (msg, data) => emitLog("warn", msg, data),
    error: (msgOrError: LazyMessage | Error, dataOrMsg?: Record<string, unknown> | string, extraData?: Record<string, unknown>) =>
      emitLog("error", msgOrError, dataOrMsg, extraData),

    logger(namespace?: string, childProps?: Record<string, unknown>): ConditionalLogger {
      const childName = namespace ? `${name}:${namespace}` : name
      const mergedProps = { ...props, ...childProps }
      return wrapConditional(
        createLoggerImpl(childName, mergedProps, pipeline, null, parentSpanId, traceId, traceSampled),
        () => pipeline.level,
      )
    },

    span(namespace?: string, childProps?: LazyProps): SpanLogger {
      const childName = namespace ? `${name}:${namespace}` : name
      const resolvedChildProps = typeof childProps === "function" ? childProps() : childProps
      const mergedProps = { ...props, ...resolvedChildProps }
      const newSpanId = generateSpanId()

      let resolvedParentId = parentSpanId
      let resolvedTraceId = traceId

      if (!resolvedParentId && _getContextParent) {
        const ctxParent = _getContextParent()
        if (ctxParent) {
          resolvedParentId = ctxParent.spanId
          resolvedTraceId = resolvedTraceId || ctxParent.traceId
        }
      }

      const isNewTrace = !resolvedTraceId
      const finalTraceId = resolvedTraceId || generateTraceId()
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
        pipeline,
        newSpanData,
        newSpanId,
        finalTraceId,
        sampled,
      ) as SpanLogger

      _enterContext?.(newSpanId, finalTraceId, resolvedParentId)

      ;(spanLogger as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose] = () => {
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
        _ambientRecorder?.recordSpan({ name: childName, durationMs: newSpanData.duration })

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
          pipeline.dispatch(spanEvent)
        }
      }

      return spanLogger
    },

    child(context: string | Record<string, unknown>): ConditionalLogger {
      if (typeof context === "string") {
        return this.logger(context)
      }
      return wrapConditional(
        createLoggerImpl(name, { ...props, ...context }, pipeline, null, parentSpanId, traceId, traceSampled),
        () => pipeline.level,
      )
    },

    end(): void {
      if (spanMeta?.endTime === null) {
        ;(this as unknown as { [Symbol.dispose]: () => void })[Symbol.dispose]?.()
      }
    },
  }

  return logger
}

// ============ ConditionalLogger Proxy ============

function wrapConditional(logger: Logger, getLevel: () => LogLevel): ConditionalLogger {
  return new Proxy(logger as ConditionalLogger, {
    get(target, prop: string) {
      if (prop in LOG_LEVEL_PRIORITY && prop !== "silent") {
        if (LOG_LEVEL_PRIORITY[prop as keyof typeof LOG_LEVEL_PRIORITY] < LOG_LEVEL_PRIORITY[getLevel()]) {
          return undefined
        }
      }
      return (target as unknown as Record<string, unknown>)[prop]
    },
  })
}

// ============ Public API ============

/**
 * Create a logger.
 *
 * @param name - Logger namespace (e.g., 'myapp', 'myapp:db')
 * @param config - Optional config array. Objects configure, arrays branch, values write.
 *
 * @example
 * // Zero config (reads LOG_LEVEL, DEBUG, LOG_FORMAT from env)
 * const log = createLogger('myapp')
 *
 * @example
 * // Configured pipeline
 * const log = createLogger('myapp', [
 *   { level: 'debug', ns: '-sql' },
 *   console,
 *   { file: '/tmp/app.log', level: 'info', format: 'json' },
 * ])
 */
export function createLogger(name: string, config?: unknown[]): ConditionalLogger {
  const pipeline = config ? buildPipeline(config) : defaultPipeline()
  const logger = createLoggerImpl(name, {}, pipeline, null, null, null)
  return wrapConditional(logger, () => pipeline.level)
}

// ============ Compose (Logger Plugin Composition) ============

export type LoggerFactory = (name: string, config?: unknown[]) => ConditionalLogger
export type LoggerPlugin = (factory: LoggerFactory) => LoggerFactory

/**
 * Compose a custom createLogger with plugins.
 *
 * @example
 * import { createLogger as base, compose } from "loggily"
 * import withSentry from "@sentry/loggily"
 *
 * const createLogger = compose(base, withSentry({ dsn: "..." }))
 * const log = createLogger("myapp")
 */
export function compose(base: LoggerFactory, ...plugins: LoggerPlugin[]): LoggerFactory {
  return plugins.reduce((factory, plugin) => plugin(factory), base)
}

// ============ Legacy API ============
// Level/format/ns/trace map to env vars (read fresh by defaultPipeline).
// Writers/suppress are runtime state (can't be env vars).

// _process cached for browser safety (same pattern as pipeline.ts)
const _process = typeof process !== "undefined" ? process : undefined
const _env = _process?.env ?? ({} as Record<string, string | undefined>)

/** @deprecated Use createLogger config array: createLogger("x", [{ level }, console]) */
export function setLogLevel(level: LogLevel): void { _env.LOG_LEVEL = level }

/** @deprecated Level is per-logger in v2 */
export function getLogLevel(): LogLevel { return (_env.LOG_LEVEL as LogLevel) ?? "info" }

/** @deprecated Use TRACE=1 env var */
export function enableSpans(): void { _env.TRACE = "1" }

/** @deprecated */
export function disableSpans(): void { delete _env.TRACE }

/** @deprecated */
export function spansAreEnabled(): boolean { return !!_env.TRACE }

/** @deprecated Use TRACE=namespace env var */
export function setTraceFilter(namespaces: string[] | null): void {
  if (!namespaces || namespaces.length === 0) { delete _env.TRACE }
  else { _env.TRACE = namespaces.join(",") }
}

/** @deprecated */
export function getTraceFilter(): string[] | null {
  return _env.TRACE ? _env.TRACE.split(",") : null
}

/** @deprecated Use DEBUG=namespace env var or { ns } in config array */
export function setDebugFilter(namespaces: string[] | null): void {
  if (!namespaces || namespaces.length === 0) { delete _env.DEBUG }
  else { _env.DEBUG = namespaces.join(",") }
}

/** @deprecated */
export function getDebugFilter(): string[] | null {
  return _env.DEBUG ? _env.DEBUG.split(",") : null
}

/** @deprecated Use { format } in config array */
export function setLogFormat(format: LogFormat): void { _env.LOG_FORMAT = format }

/** @deprecated */
export function getLogFormat(): LogFormat { return (_env.LOG_FORMAT as LogFormat) ?? "console" }

/** @deprecated Omit console from config array instead */
export function setSuppressConsole(value: boolean): void { runtimeState.suppressConsole = value }

export type OutputMode = "console" | "stderr" | "writers-only"

/** @deprecated Use config array */
export function setOutputMode(_mode: OutputMode): void {}

/** @deprecated */
export function getOutputMode(): OutputMode { return "console" }

/** @deprecated Pass writers in config array instead */
export function addWriter(writer: (formatted: string, level: string) => void): () => void {
  runtimeState.writers.push(writer)
  return () => {
    const idx = runtimeState.writers.indexOf(writer)
    if (idx !== -1) runtimeState.writers.splice(idx, 1)
  }
}

/** @deprecated Spans dispatch through the pipeline automatically */
export function writeSpan(namespace: string, duration: number, attrs: Record<string, unknown>): void {
  const event: SpanEvent = {
    kind: "span",
    time: Date.now(),
    namespace,
    name: namespace,
    duration,
    props: attrs,
    spanId: (attrs.span_id as string) ?? "",
    traceId: (attrs.trace_id as string) ?? "",
    parentId: (attrs.parent_id as string | null) ?? null,
  }
  defaultPipeline().dispatch(event)
}

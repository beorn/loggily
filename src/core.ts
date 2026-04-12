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
  LOG_LEVEL_PRIORITY,
  buildPipeline,
  safeStringify,
  readEnvLevel,
  readEnvNs,
  readEnvFormat,
  readEnvTrace,
  writeToConsole,
  formatConsoleEvent,
  formatJSONEvent,
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

  /** @deprecated Use .child() */
  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(namespace: string, props?: Record<string, unknown>): ConditionalLogger
  child(context: Record<string, unknown>): ConditionalLogger
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

  /** @deprecated Use .child() */
  logger(namespace?: string, props?: Record<string, unknown>): ConditionalLogger
  span(namespace?: string, props?: LazyProps): SpanLogger
  child(namespace: string, props?: Record<string, unknown>): ConditionalLogger
  child(context: Record<string, unknown>): ConditionalLogger
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
    error: (
      msgOrError: LazyMessage | Error,
      dataOrMsg?: Record<string, unknown> | string,
      extraData?: Record<string, unknown>,
    ) => emitLog("error", msgOrError, dataOrMsg, extraData),

    /** @deprecated Use .child() instead */
    logger(namespace?: string, childProps?: Record<string, unknown>): ConditionalLogger {
      return this.child(namespace ?? "", childProps)
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

    child(namespaceOrContext?: string | Record<string, unknown>, childProps?: Record<string, unknown>): ConditionalLogger {
      if (typeof namespaceOrContext === "string") {
        const childName = namespaceOrContext ? `${name}:${namespaceOrContext}` : name
        const mergedProps = { ...props, ...childProps }
        return wrapConditional(
          createLoggerImpl(childName, mergedProps, pipeline, null, parentSpanId, traceId, traceSampled),
          () => pipeline.level,
        )
      }
      // Object → context fields, same namespace
      return wrapConditional(
        createLoggerImpl(name, { ...props, ...namespaceOrContext }, pipeline, null, parentSpanId, traceId, traceSampled),
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

// ============ Base createLogger ============

/**
 * Base createLogger — requires a config array.
 * Use the default `createLogger` export (with `withEnvDefaults`) for zero-config.
 */
function baseCreateLogger(name: string, configOrProps?: unknown[] | Record<string, unknown>): ConditionalLogger {
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

  const logger = createLoggerImpl(name, props, pipeline, null, null, null)
  return wrapConditional(logger, () => pipeline.level)
}

// ============ Compose ============

export type LoggerFactory = (name: string, configOrProps?: unknown[] | Record<string, unknown>) => ConditionalLogger
export type LoggerPlugin = (factory: LoggerFactory) => LoggerFactory

export function pipe(base: LoggerFactory, ...plugins: LoggerPlugin[]): LoggerFactory {
  return plugins.reduce((factory, plugin) => plugin(factory), base)
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
  return (factory) => (name, configOrProps?) => {
    // Explicit config array — pass through, buildPipeline reads env defaults
    if (Array.isArray(configOrProps)) return factory(name, configOrProps)

    // No config array — dynamic pipeline from env vars + runtime state
    const props =
      configOrProps && typeof configOrProps === "object" ? (configOrProps as Record<string, unknown>) : undefined

    const pipeline = createEnvPipeline()
    const logger = createLoggerImpl(name, props ?? {}, pipeline, null, null, null)
    return wrapConditional(logger, () => {
      return currentLevel()
    })
  }
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

/** Default createLogger — includes withEnvDefaults. */
export const createLogger: LoggerFactory = pipe(baseCreateLogger, withEnvDefaults())

/** Test helper — all levels, console output. */
export function createTestLogger(name: string): ConditionalLogger {
  return baseCreateLogger(name, [{ level: "trace" }, "console"])
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
export function setOutputMode(_mode: OutputMode): void {}
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

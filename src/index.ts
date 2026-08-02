/**
 * loggily v2 — Structured logging with spans
 *
 * One import. Objects configure. Arrays branch. Values write.
 */

export {
  // Core API
  createLogger,
  baseCreateLogger,
  createTestLogger,
  pipe,
  type LoggerFactory,
  type LoggerPlugin,
  type PluginCtx,
  // Plugins
  withSpans,
  withEnvDefaults,
  withConfigMetrics,
  // Types
  type ConditionalLogger,
  type Logger,
  type SpanLogger,
  type SpannedLogger,
  type SpanData,
  type LazyMessage,
  type LazyProps,
  type Event,
  type LogEvent,
  type SpanEvent,
  type Stage,
  type LogLevel,
  type OutputLogLevel,
  type LogFormat,
  type OutputMode,
  // Constants
  LOG_LEVEL_PRIORITY,
  // Utilities
  safeStringify,
  resetIds,
  // Span collection
  startCollecting,
  stopCollecting,
  getCollectedSpans,
  clearCollectedSpans,
  // Span metrics
  type SpanRecord,
  type SpanRecorder,
  // Internal (used by context.ts)
  _setContextHooks,
  _clearContextHooks,
  createSpanDataProxy,
  // Deprecated v1 API (maps to env vars for backwards compat)
  setLogLevel,
  getLogLevel,
  enableSpans,
  disableSpans,
  spansAreEnabled,
  setTraceFilter,
  getTraceFilter,
  setDebugFilter,
  getDebugFilter,
  setLogFormat,
  getLogFormat,
  setSuppressConsole,
  setOutputMode,
  getOutputMode,
  addWriter,
  type WriterFn,
  writeSpan,
} from "./core.js"

export { withRedaction, type RedactionOptions } from "./redaction.js"

export {
  createFileWriter,
  type FileWriter,
  type FileWriterOptions,
} from "./file-writer.js"

// Wire file writer into core for LOG_FILE env var support
import { createFileWriter as _cfw } from "./file-writer.js"
import { _setLogFileWriterFactory } from "./core.js"
_setLogFileWriterFactory(_cfw)

export {
  setIdFormat,
  getIdFormat,
  type IdFormat,
  traceparent,
  type TraceparentOptions,
  setSampleRate,
  getSampleRate,
} from "./tracing.js"

// Re-export pipeline builder and utilities for power users
export {
  buildPipeline,
  type Pipeline,
  resolveVerbosityLevel,
  serializeCause,
} from "./pipeline.js"

// Re-export config types for typed pipeline construction
export type {
  ConfigElement,
  ConfigObject,
  FileDescriptor,
  Writable,
} from "./pipeline.js"

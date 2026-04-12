/**
 * loggily v2 — Structured logging with spans
 *
 * One import. Objects configure. Arrays branch. Values write.
 */

export {
  // Core API
  createLogger,
  createTestLogger,
  compose,
  type LoggerFactory,
  type LoggerPlugin,
  // Types
  type ConditionalLogger,
  type Logger,
  type SpanLogger,
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
  // Internal (used by context.ts and metrics.ts)
  _setAmbientRecorder,
  _ambientRecorder,
  _setContextHooks,
  _clearContextHooks,
  createSpanDataProxy,
  // Deprecated v1 API (throws with migration instructions)
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
  writeSpan,
} from "./core.js"

export { createFileWriter, type FileWriter, type FileWriterOptions } from "./file-writer.js"

export {
  setIdFormat,
  getIdFormat,
  type IdFormat,
  traceparent,
  type TraceparentOptions,
  setSampleRate,
  getSampleRate,
} from "./tracing.js"

// Re-export pipeline builder for power users
export { buildPipeline, defaultPipeline, type Pipeline } from "./pipeline.js"

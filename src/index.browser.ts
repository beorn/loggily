/**
 * loggily v2 browser entry point.
 *
 * Re-exports the full logger API except createFileWriter (which requires node:fs).
 * Bundlers resolve this via the "browser" condition in package.json exports.
 */

export {
  // Core API
  createLogger,
  baseCreateLogger,
  createTestLogger,
  pipe,
  withSpans,
  withEnvDefaults,
  withConfigMetrics,
  type LoggerFactory,
  type LoggerPlugin,
  type PluginCtx,

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

// Tracing utilities (runtime-agnostic, work in browser)
export {
  setIdFormat,
  getIdFormat,
  type IdFormat,
  traceparent,
  type TraceparentOptions,
  setSampleRate,
  getSampleRate,
} from "./tracing.js"

// Pipeline builder for power users
export { buildPipeline, type Pipeline } from "./pipeline.js"

// Re-export config types for typed pipeline construction
export type {
  ConfigElement,
  ConfigObject,
  FileDescriptor,
  Writable,
} from "./pipeline.js"

// File writer types (exported for type compatibility, but the function throws)
export type { FileWriterOptions, FileWriter } from "./file-writer.js"

/** @throws Always — createFileWriter is not available in browser environments */
export function createFileWriter(): never {
  throw new Error(
    "createFileWriter is not available in browser environments. Use a writable sink in the config array instead.",
  )
}

/**
 * loggily/otel — OpenTelemetry bridge
 *
 * Maps loggily LogEvent/SpanEvent to OpenTelemetry SDK calls.
 * Requires @opentelemetry/api as a peer dependency.
 *
 * Usage:
 *   import * as otelApi from "@opentelemetry/api"
 *   import { toOtel } from "loggily/otel"
 *   const log = createLogger("myapp", [toOtel({ api: otelApi }), console])
 */

import type { Event, LogEvent, SpanEvent, Stage } from "./pipeline.js"

// OpenTelemetry API types (peer dep — imported at runtime)
interface OtelApi {
  logs?: {
    getLoggerProvider(): {
      getLogger(name: string): {
        emit(record: {
          severityNumber: number
          severityText: string
          body: string
          attributes: Record<string, unknown>
          timestamp: number[]
        }): void
      }
    }
  }
  trace?: {
    getTracerProvider(): {
      getTracer(name: string): {
        startSpan(
          name: string,
          options?: {
            startTime: number[]
            attributes: Record<string, unknown>
          },
        ): {
          end(endTime?: number[]): void
          setAttribute(key: string, value: unknown): void
          setStatus(status: { code: number; message?: string }): void
        }
      }
    }
  }
}

const SEVERITY_MAP: Record<string, { number: number; text: string }> = {
  trace: { number: 1, text: "TRACE" },
  debug: { number: 5, text: "DEBUG" },
  info: { number: 9, text: "INFO" },
  warn: { number: 13, text: "WARN" },
  error: { number: 17, text: "ERROR" },
}

function msToHrTime(ms: number): [number, number] {
  const seconds = Math.floor(ms / 1000)
  const nanos = (ms % 1000) * 1_000_000
  return [seconds, nanos]
}

export interface OtelBridgeOptions {
  /** The @opentelemetry/api module. Pass the import to avoid require() in ESM. */
  api?: OtelApi
  /** Logger name for OTLP LogRecords (default: "loggily") */
  loggerName?: string
  /** Tracer name for OTLP Spans (default: "loggily") */
  tracerName?: string
  /** Whether to forward log events (default: true) */
  logs?: boolean
  /** Whether to forward span events (default: true) */
  spans?: boolean
}

/**
 * Create a Stage that forwards loggily events to OpenTelemetry.
 *
 * Pass the @opentelemetry/api module via options.api:
 *
 * ```ts
 * import * as otelApi from "@opentelemetry/api"
 * const log = createLogger("myapp", [toOtel({ api: otelApi }), console])
 * ```
 *
 * Events pass through unchanged (the stage is transparent).
 */
export function toOtel(options: OtelBridgeOptions = {}): Stage {
  const {
    api: otelApi = null,
    loggerName = "loggily",
    tracerName = "loggily",
    logs: forwardLogs = true,
    spans: forwardSpans = true,
  } = options

  function forwardLog(event: LogEvent): void {
    const logsApi = otelApi?.logs
    if (!logsApi) return

    const severity = SEVERITY_MAP[event.level] ?? SEVERITY_MAP.info!
    const logger = logsApi.getLoggerProvider().getLogger(loggerName)
    logger.emit({
      severityNumber: severity.number,
      severityText: severity.text,
      body: event.message,
      attributes: {
        "loggily.namespace": event.namespace,
        ...event.props,
      },
      timestamp: msToHrTime(event.time),
    })
  }

  function forwardSpan(event: SpanEvent): void {
    const traceApi = otelApi?.trace
    if (!traceApi) return

    const tracer = traceApi.getTracerProvider().getTracer(tracerName)
    const startTime = msToHrTime(event.time - event.duration)
    const span = tracer.startSpan(event.name, {
      startTime,
      attributes: {
        "loggily.namespace": event.namespace,
        "loggily.span_id": event.spanId,
        "loggily.trace_id": event.traceId,
        ...event.props,
      },
    })
    if (event.parentId) {
      span.setAttribute("loggily.parent_id", event.parentId)
    }
    span.end(msToHrTime(event.time))
  }

  return (event: Event): Event => {
    if (forwardLogs && event.kind === "log") forwardLog(event)
    if (forwardSpans && event.kind === "span") forwardSpan(event)
    return event // transparent — pass through
  }
}

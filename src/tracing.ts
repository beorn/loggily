/**
 * Distributed tracing utilities for loggily.
 *
 * Provides W3C-compatible trace/span ID generation, traceparent header formatting,
 * and head-based sampling. All features are opt-in and don't break the existing API.
 */

import type { SpanData } from "./core.js"

// ============ ID Format ============

/** Supported ID formats */
export type IdFormat = "simple" | "w3c"

let currentIdFormat: IdFormat = "simple"

/**
 * Set the ID format for new spans and traces.
 * - "simple": sp_1, sp_2, tr_1, tr_2 (default, lightweight)
 * - "w3c": 32-char hex trace ID, 16-char hex span ID (W3C Trace Context compatible)
 *
 * @deprecated Use the `TRACE_ID_FORMAT` env var or `{ idFormat: "w3c" }` in the config array instead.
 */
export function setIdFormat(format: IdFormat): void {
  currentIdFormat = format
}

/**
 * Get the current ID format.
 *
 * @deprecated Use the `TRACE_ID_FORMAT` env var or `{ idFormat: "w3c" }` in the config array instead.
 */
export function getIdFormat(): IdFormat {
  return currentIdFormat
}

// Simple format counters (used by core.ts via the generator functions)
let simpleSpanCounter = 0
let simpleTraceCounter = 0

/** Generate a hex string of the given byte length using crypto.randomUUID */
function randomHex(bytes: number): string {
  // crypto.randomUUID() gives us 32 hex chars (128 bits) after removing dashes
  // For 16 bytes (32 hex chars) we use one UUID, for 8 bytes (16 hex chars) we take a slice
  const uuid = crypto.randomUUID().replace(/-/g, "")
  return uuid.slice(0, bytes * 2)
}

/** Generate a span ID according to the current format */
export function generateSpanId(): string {
  if (currentIdFormat === "w3c") {
    return randomHex(8) // 16-char hex
  }
  return `sp_${(++simpleSpanCounter).toString(36)}`
}

/** Generate a trace ID according to the current format */
export function generateTraceId(): string {
  if (currentIdFormat === "w3c") {
    return randomHex(16) // 32-char hex
  }
  return `tr_${(++simpleTraceCounter).toString(36)}`
}

/** Reset ID counters (for testing) */
export function resetIdCounters(): void {
  simpleSpanCounter = 0
  simpleTraceCounter = 0
}

// ============ W3C Traceparent ============

/** Options for traceparent header formatting */
export interface TraceparentOptions {
  /** Whether this span is sampled. Defaults to true for backwards compatibility. */
  sampled?: boolean
}

/**
 * Format a W3C traceparent header from span data.
 *
 * Format: `{version}-{trace-id}-{span-id}-{trace-flags}`
 * - version: "00" (current W3C spec version)
 * - trace-id: 32 hex chars (128 bits)
 * - span-id: 16 hex chars (64 bits)
 * - trace-flags: "01" (sampled) or "00" (not sampled)
 *
 * Works with both simple and W3C ID formats. Simple IDs are zero-padded to spec length.
 *
 * @param spanData - Span data with id and traceId
 * @param options - Optional settings (sampled flag). Defaults to sampled=true.
 * @returns W3C traceparent header string
 *
 * @example
 * ```typescript
 * const span = log.span("http-request")
 * const header = traceparent(span.spanData)
 * // → "00-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1a2b3c4d5e6f7a8b-01"
 * fetch(url, { headers: { traceparent: header } })
 * ```
 */
export function traceparent(spanData: SpanData, options?: TraceparentOptions): string {
  const traceId = padHex(spanData.traceId, 32)
  const spanId = padHex(spanData.id, 16)
  const flags = (options?.sampled ?? true) ? "01" : "00"
  return `00-${traceId}-${spanId}-${flags}`
}

/** Pad or hash an ID to the specified hex length */
function padHex(id: string, length: number): string {
  // If it's already the right length and looks like hex, use as-is
  if (id.length === length && /^[0-9a-f]+$/.test(id)) {
    return id
  }

  // For simple IDs (sp_1, tr_1), create a deterministic hex representation
  // by encoding the string as hex bytes, zero-padded to the target length
  let hex = ""
  for (let i = 0; i < id.length; i++) {
    hex += id.charCodeAt(i).toString(16).padStart(2, "0")
  }
  // Pad or truncate to target length
  return hex.padStart(length, "0").slice(-length)
}

// ============ Sampling ============

let sampleRate = 1.0

/**
 * Set the head-based sampling rate for new traces.
 * Applied at trace creation — all spans within a sampled trace are kept.
 *
 * @deprecated Use the `TRACE_SAMPLE_RATE` env var or `{ sampleRate: 0.1 }` in the config array instead.
 * @param rate - Sampling rate from 0.0 (sample nothing) to 1.0 (sample everything, default)
 */
export function setSampleRate(rate: number): void {
  if (rate < 0 || rate > 1) {
    throw new Error(`Sample rate must be between 0.0 and 1.0, got ${rate}`)
  }
  sampleRate = rate
}

/**
 * Get the current sampling rate.
 *
 * @deprecated Use the `TRACE_SAMPLE_RATE` env var or `{ sampleRate: 0.1 }` in the config array instead.
 */
export function getSampleRate(): number {
  return sampleRate
}

/**
 * Determine whether a new trace should be sampled.
 * Called at trace creation time (head-based sampling).
 */
export function shouldSample(): boolean {
  if (sampleRate >= 1.0) return true
  if (sampleRate <= 0.0) return false
  return Math.random() < sampleRate
}

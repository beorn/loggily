/**
 * AsyncLocalStorage-based context propagation for loggily — Node.js/Bun only.
 *
 * Separated from core logger to allow tree-shaking in browser bundles.
 * When enabled, new spans automatically parent to the current context span,
 * and writeLog() auto-tags with trace_id/span_id from context.
 *
 * @example
 * ```typescript
 * import { enableContextPropagation, getCurrentSpan } from "loggily/context"
 *
 * enableContextPropagation()
 *
 * const log = createLogger("myapp")
 * {
 *   using span = log.span("request")
 *   // All logs and child spans within this async context
 *   // automatically inherit trace_id and span_id
 *   log.info("inside span") // auto-tagged with trace_id, span_id
 *
 *   const current = getCurrentSpan()
 *   // current === { spanId: "sp_1", traceId: "tr_1", parentId: null }
 * }
 * ```
 */

import { AsyncLocalStorage } from "node:async_hooks"
import { _setContextHooks, _clearContextHooks } from "./core.js"

// ============ Types ============

/** Minimal span context stored in AsyncLocalStorage */
export interface SpanContext {
  readonly spanId: string
  readonly traceId: string
  readonly parentId: string | null
}

// ============ State ============

let storage: AsyncLocalStorage<SpanContext> | null = null
let contextEnabled = false

/**
 * Map from spanId → the SpanContext that was active when the span was entered.
 * Used to restore the exact previous context on exit, avoiding corruption
 * from non-LIFO end() ordering.
 */
const previousContexts = new Map<string, SpanContext | null>()

// ============ API ============

/**
 * Enable AsyncLocalStorage-based context propagation.
 * Once enabled, new spans automatically parent to the current context span,
 * and log messages are auto-tagged with trace_id/span_id.
 *
 * **Node.js/Bun only** — not available in browser environments.
 */
export function enableContextPropagation(): void {
  if (!storage) {
    storage = new AsyncLocalStorage<SpanContext>()
  }
  contextEnabled = true

  // Register hooks with core.ts
  _setContextHooks({
    getContextTags,
    getContextParent() {
      const span = getCurrentSpan()
      if (!span) return null
      return { spanId: span.spanId, traceId: span.traceId }
    },
    enterContext: enterSpanContext,
    exitContext: exitSpanContext,
  })
}

/**
 * Disable context propagation.
 * Existing spans continue to work, but new spans won't auto-parent.
 */
export function disableContextPropagation(): void {
  contextEnabled = false
  _clearContextHooks()
}

/** Check if context propagation is enabled */
export function isContextPropagationEnabled(): boolean {
  return contextEnabled
}

/**
 * Get the current span context from AsyncLocalStorage.
 * Returns null if no span is active in the current async context,
 * or if context propagation is not enabled.
 */
export function getCurrentSpan(): SpanContext | null {
  if (!contextEnabled || !storage) return null
  return storage.getStore() ?? null
}

/**
 * Enter a span context for the remainder of the current synchronous execution
 * and any async operations started from it. Used by the logger when creating
 * spans with `using` — since `using` doesn't wrap user code in a callback,
 * `enterWith()` is the right primitive.
 *
 * Captures the full previous SpanContext snapshot so it can be restored
 * exactly on exit, even with non-LIFO end() ordering.
 *
 * @internal
 */
export function enterSpanContext(
  spanId: string,
  traceId: string,
  parentId: string | null,
): void {
  if (!contextEnabled || !storage) return

  // Capture the full previous context before overwriting
  const previous = storage.getStore() ?? null
  previousContexts.set(spanId, previous)

  storage.enterWith({ spanId, traceId, parentId })
}

/**
 * Restore the previous span context (called when a span ends).
 * Restores the exact SpanContext snapshot captured at enter time,
 * preventing corruption from non-LIFO end() ordering.
 *
 * @internal
 */
export function exitSpanContext(spanId: string): void {
  if (!contextEnabled || !storage) return

  const previous = previousContexts.get(spanId)
  previousContexts.delete(spanId)

  if (previous) {
    storage.enterWith(previous)
  } else {
    // No previous context — exit entirely
    storage.enterWith(undefined as unknown as SpanContext)
  }
}

/**
 * Run a function within a span context.
 * Used for explicit context scoping (e.g., in request handlers).
 *
 * @param context - The span context to set
 * @param fn - The function to run within the context
 * @returns The return value of fn
 */
export function runInSpanContext<T>(context: SpanContext, fn: () => T): T {
  if (!contextEnabled || !storage) return fn()
  return storage.run(context, fn)
}

/**
 * Get the context tags (trace_id, span_id) for the current async context.
 * Used by writeLog() to auto-tag log messages.
 * Returns empty object if context propagation is disabled or no span is active.
 */
export function getContextTags(): Record<string, string> {
  const span = getCurrentSpan()
  if (!span) return {}
  return {
    trace_id: span.traceId,
    span_id: span.spanId,
  }
}

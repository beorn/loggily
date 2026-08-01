import type { LoggerPlugin } from "./core.js"
import type { Event, Stage } from "./pipeline.js"

export interface RedactionOptions {
  /** Replacement written in place of a secret. Defaults to `[REDACTED]`. */
  replacement?: string
}

const SECRET_KEY_NAMES = new Set([
  "token",
  "secret",
  "password",
  "api_key",
  "authorization",
  "cookie",
])
const CORRELATION_KEY_NAMES = new Set([
  "correlationid",
  "generation",
  "launchid",
  "parentid",
  "requestid",
  "sessionid",
  "spanid",
  "traceid",
])

/**
 * Redact structured events before they can reach outputs, forwarding stages,
 * or branches. Compose before `withEnvDefaults()` so the redaction stage is
 * prepended ahead of its consuming env stage.
 */
export function withRedaction(options: RedactionOptions = {}): LoggerPlugin {
  const stage = createRedactionStage(options)
  return (factory) => (name, configOrProps?) => {
    if (Array.isArray(configOrProps))
      return factory(name, [stage, ...configOrProps])

    // A bare base factory needs an explicit pipeline to host the stage. Props
    // remain logger context through child(), exactly as baseCreateLogger's
    // object overload would have applied them.
    const logger = factory(name, [stage, "console"])
    return configOrProps === undefined ? logger : logger.child(configOrProps)
  }
}

function createRedactionStage(options: RedactionOptions): Stage {
  const replacement = options.replacement ?? "[REDACTED]"
  return (event) => redactEvent(event, replacement)
}

function redactEvent(event: Event, replacement: string): Event {
  const seen = new WeakMap<object, unknown>()
  const props =
    event.props === undefined
      ? undefined
      : redactValue(event.props, replacement, seen, true)
  const userArgs =
    event.userArgs === undefined
      ? undefined
      : redactValue(event.userArgs, replacement, seen, true)

  if (event.kind === "span") {
    return {
      ...event,
      ...(props === undefined
        ? {}
        : { props: props as Record<string, unknown> }),
      ...(userArgs === undefined ? {} : { userArgs: userArgs as unknown[] }),
    }
  }
  return {
    ...event,
    message: redactText(event.message, replacement),
    ...(props === undefined ? {} : { props: props as Record<string, unknown> }),
    ...(userArgs === undefined ? {} : { userArgs: userArgs as unknown[] }),
  }
}

function redactValue(
  value: unknown,
  replacement: string,
  seen: WeakMap<object, unknown>,
  redactStringValues: boolean,
): unknown {
  if (typeof value === "string")
    return redactStringValues ? redactText(value, replacement) : value
  if (
    value === null ||
    (typeof value !== "object" && typeof value !== "function")
  )
    return value

  const existing = seen.get(value)
  if (existing !== undefined) return existing

  if (typeof value === "function") {
    return redactFunction(
      value as (...args: unknown[]) => unknown,
      replacement,
      seen,
    )
  }
  if (value instanceof Error) return redactError(value, replacement, seen)
  if (value instanceof Date) {
    const clone = new Date(value.getTime())
    seen.set(value, clone)
    return clone
  }
  if (value instanceof RegExp) {
    const clone = new RegExp(value.source, value.flags)
    seen.set(value, clone)
    return clone
  }
  if (value instanceof Map) {
    const clone = new Map<unknown, unknown>()
    seen.set(value, clone)
    for (const [key, entry] of value) {
      clone.set(
        redactValue(key, replacement, seen, true),
        redactValue(entry, replacement, seen, true),
      )
    }
    return clone
  }
  if (value instanceof Set) {
    const clone = new Set<unknown>()
    seen.set(value, clone)
    for (const entry of value)
      clone.add(redactValue(entry, replacement, seen, true))
    return clone
  }
  if (Array.isArray(value)) {
    const clone: unknown[] = []
    seen.set(value, clone)
    for (const entry of value)
      clone.push(redactValue(entry, replacement, seen, true))
    return clone
  }

  const clone: Record<string, unknown> = Object.create(
    Object.getPrototypeOf(value),
  ) as Record<string, unknown>
  seen.set(value, clone)
  for (const key of Object.keys(value)) {
    if (isSecretKey(key)) {
      clone[key] = replacement
      continue
    }
    clone[key] = redactValue(
      (value as Record<string, unknown>)[key],
      replacement,
      seen,
      !isCorrelationKey(key),
    )
  }
  return clone
}

function redactFunction(
  value: (...args: unknown[]) => unknown,
  replacement: string,
  seen: WeakMap<object, unknown>,
): (...args: unknown[]) => unknown {
  const clone = function (this: unknown, ...args: unknown[]): unknown {
    return Reflect.apply(value, this, args)
  }
  Object.setPrototypeOf(clone, Object.getPrototypeOf(value))
  seen.set(value, clone)
  for (const key of Object.keys(value)) {
    ;(clone as unknown as Record<string, unknown>)[key] = isSecretKey(key)
      ? replacement
      : redactValue(
          (value as unknown as Record<string, unknown>)[key],
          replacement,
          seen,
          !isCorrelationKey(key),
        )
  }
  return clone
}

function redactError(
  error: Error,
  replacement: string,
  seen: WeakMap<object, unknown>,
): Error {
  const clone = Object.create(Object.getPrototypeOf(error)) as Error
  seen.set(error, clone)
  clone.name = error.name
  clone.message = redactText(error.message, replacement)
  if (error.stack !== undefined)
    clone.stack = redactText(error.stack, replacement)
  if (error.cause !== undefined)
    clone.cause = redactValue(error.cause, replacement, seen, true)
  for (const key of Object.keys(error)) {
    if (key === "cause") continue
    if (isSecretKey(key)) clone[key as keyof Error] = replacement as never
    else {
      ;(clone as unknown as Record<string, unknown>)[key] = redactValue(
        (error as unknown as Record<string, unknown>)[key],
        replacement,
        seen,
        !isCorrelationKey(key),
      )
    }
  }
  return clone
}

function isSecretKey(key: string): boolean {
  const normalized = key
    .replace(/([a-z0-9])([A-Z])/gu, "$1_$2")
    .replaceAll(/[^a-z0-9]+/giu, "_")
    .toLowerCase()
  return (
    SECRET_KEY_NAMES.has(normalized) ||
    /(?:^|_)(?:token|secret|password|authorization|cookie)$/u.test(
      normalized,
    ) ||
    /_key$/u.test(normalized)
  )
}

function isCorrelationKey(key: string): boolean {
  return CORRELATION_KEY_NAMES.has(
    key.replaceAll(/[^a-z0-9]/giu, "").toLowerCase(),
  )
}

function redactText(text: string, replacement: string): string {
  return text
    .replaceAll(/\bBearer\s+[A-Za-z0-9._~+/-]+=*/giu, () => replacement)
    .replaceAll(/\bsk-[A-Za-z0-9_-]{8,}\b/gu, () => replacement)
    .replaceAll(/\b[A-Za-z0-9_-]{40,}\b/gu, () => replacement)
}

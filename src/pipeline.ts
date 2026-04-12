import { colors as pc } from "./colors.js"
import { createFileWriter } from "./file-writer.js"

// ============ Types ============

export type OutputLogLevel = "trace" | "debug" | "info" | "warn" | "error"
export type LogLevel = OutputLogLevel | "silent"
export type LogFormat = "console" | "json"

export type LogEvent = {
  kind: "log"
  time: number
  namespace: string
  level: OutputLogLevel
  message: string
  props?: Record<string, unknown>
}

export type SpanEvent = {
  kind: "span"
  time: number
  namespace: string
  name: string
  duration: number
  props?: Record<string, unknown>
  spanId: string
  traceId: string
  parentId: string | null
}

export type Event = LogEvent | SpanEvent
export type Stage = (event: Event) => Event | null | void

// ============ Level Priority ============

export const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  trace: 0,
  debug: 1,
  info: 2,
  warn: 3,
  error: 4,
  silent: 5,
}

// ============ Runtime Detection ============

const _process = typeof process !== "undefined" ? process : undefined

function getEnv(key: string): string | undefined {
  return _process?.env?.[key]
}

function writeStderr(text: string): void {
  if (_process?.stderr?.write) {
    _process.stderr.write(text + "\n")
  } else {
    console.error(text)
  }
}

// ============ Formatting ============

export function safeStringify(value: unknown): string {
  const seen = new WeakSet()
  return JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") return val.toString()
    if (typeof val === "symbol") return val.toString()
    if (val instanceof Error) return { message: val.message, stack: val.stack, name: val.name }
    if (typeof val === "object" && val !== null) {
      if (seen.has(val)) return "[Circular]"
      seen.add(val)
    }
    return val
  })
}

function formatConsoleEvent(event: Event): string {
  const time = pc.dim(new Date(event.time).toISOString().split("T")[1]?.split(".")[0] || "")
  const ns = pc.cyan(event.namespace)

  if (event.kind === "span") {
    const message = `(${event.duration}ms)`
    let output = `${time} ${pc.magenta("SPAN")} ${ns} ${message}`
    if (event.props && Object.keys(event.props).length > 0) {
      output += ` ${pc.dim(safeStringify(event.props))}`
    }
    return output
  }

  let levelStr: string
  switch (event.level) {
    case "trace":
      levelStr = pc.dim("TRACE")
      break
    case "debug":
      levelStr = pc.dim("DEBUG")
      break
    case "info":
      levelStr = pc.blue("INFO")
      break
    case "warn":
      levelStr = pc.yellow("WARN")
      break
    case "error":
      levelStr = pc.red("ERROR")
      break
  }

  let output = `${time} ${levelStr} ${ns} ${event.message}`
  if (event.props && Object.keys(event.props).length > 0) {
    output += ` ${pc.dim(safeStringify(event.props))}`
  }
  return output
}

function formatJSONEvent(event: Event): string {
  if (event.kind === "span") {
    return safeStringify({
      time: new Date(event.time).toISOString(),
      level: "span",
      name: event.namespace,
      msg: `(${event.duration}ms)`,
      duration: event.duration,
      span_id: event.spanId,
      trace_id: event.traceId,
      parent_id: event.parentId,
      ...event.props,
    })
  }

  return safeStringify({
    time: new Date(event.time).toISOString(),
    level: event.level,
    name: event.namespace,
    msg: event.message,
    ...event.props,
  })
}

// ============ Namespace Filter ============

export type NsFilter = (namespace: string) => boolean

function matchesPattern(namespace: string, pattern: string): boolean {
  if (pattern === "*") return true
  return namespace === pattern || namespace.startsWith(pattern + ":")
}

export function parseNsFilter(ns: string | string[]): NsFilter {
  const patterns = typeof ns === "string" ? ns.split(",").map((s) => s.trim()) : ns
  const includes: string[] = []
  const excludes: string[] = []

  for (const p of patterns) {
    if (p.startsWith("-")) {
      excludes.push(p.slice(1))
    } else {
      includes.push(p)
    }
  }

  return (namespace: string): boolean => {
    for (const exc of excludes) {
      if (matchesPattern(namespace, exc)) return false
    }
    if (includes.length > 0) {
      for (const inc of includes) {
        if (matchesPattern(namespace, inc)) return true
      }
      return false
    }
    return true
  }
}

// ============ Sinks ============

function createConsoleSink(format: LogFormat): (event: Event) => void {
  const formatter = format === "json" ? formatJSONEvent : formatConsoleEvent
  return (event: Event) => {
    const text = formatter(event)
    if (event.kind === "span") {
      writeStderr(text)
      return
    }
    switch (event.level) {
      case "trace":
      case "debug":
        console.debug(text)
        break
      case "info":
        console.info(text)
        break
      case "warn":
        console.warn(text)
        break
      case "error":
        console.error(text)
        break
    }
  }
}

function createFileSink(path: string, format: LogFormat): { write: (event: Event) => void; dispose: () => void } {
  const writer = createFileWriter(path)
  const formatter = format === "json" ? formatJSONEvent : formatConsoleEvent
  return {
    write: (event: Event) => writer.write(formatter(event)),
    dispose: () => writer.close(),
  }
}

function createWritableSink(writable: { write: (s: string) => unknown }, format: LogFormat): (event: Event) => void {
  const formatter = format === "json" ? formatJSONEvent : formatConsoleEvent
  return (event: Event) => writable.write(formatter(event) + "\n")
}

// ============ Pipeline ============

export interface Pipeline {
  dispatch: (event: Event) => void
  level: LogLevel
  dispose: () => void
}

interface Output {
  levelPriority: number
  nsFilter: NsFilter | null
  write: (event: Event) => void
  dispose?: () => void
}

// ============ Discrimination ============

const VALID_CONFIG_KEYS = new Set(["level", "ns", "format"])
const SINK_KEYS = new Set(["file", "otel"])

function isPojo(obj: unknown): obj is Record<string, unknown> {
  if (typeof obj !== "object" || obj === null) return false
  const proto = Object.getPrototypeOf(obj)
  return proto === Object.prototype || proto === null
}

function isWritable(obj: unknown): obj is { write: (s: string) => unknown } {
  return (
    typeof obj === "object" &&
    obj !== null &&
    "write" in obj &&
    typeof (obj as Record<string, unknown>).write === "function" &&
    !isPojo(obj)
  )
}

function isValidLogLevel(val: unknown): val is LogLevel {
  return typeof val === "string" && val in LOG_LEVEL_PRIORITY
}

// ============ Build Pipeline ============

interface ScopeConfig {
  level: LogLevel
  ns: NsFilter | null
  format: LogFormat
}

export function buildPipeline(elements: unknown[], parentConfig?: Partial<ScopeConfig>): Pipeline {
  const config: ScopeConfig = {
    level: parentConfig?.level ?? readEnvLevel(),
    ns: parentConfig?.ns ?? readEnvNs(),
    format: parentConfig?.format ?? readEnvFormat(),
  }

  const stages: Stage[] = []
  const outputs: Output[] = []
  const branches: Pipeline[] = []
  const disposables: (() => void)[] = []

  for (const element of elements) {
    if (Array.isArray(element)) {
      const branch = buildPipeline(element, { ...config })
      branches.push(branch)
      disposables.push(() => branch.dispose())
      continue
    }

    if (typeof element === "function" && element !== (console as unknown)) {
      stages.push(element as Stage)
      continue
    }

    if (element === console) {
      outputs.push({
        levelPriority: LOG_LEVEL_PRIORITY[config.level],
        nsFilter: config.ns,
        write: createConsoleSink(config.format),
      })
      continue
    }

    if (isWritable(element)) {
      outputs.push({
        levelPriority: LOG_LEVEL_PRIORITY[config.level],
        nsFilter: config.ns,
        write: createWritableSink(element, config.format),
      })
      continue
    }

    if (isPojo(element)) {
      const obj = element
      const keys = Object.keys(obj)

      const hasSinkKey = keys.some((k) => SINK_KEYS.has(k))
      const hasUnknownKey = keys.some((k) => !VALID_CONFIG_KEYS.has(k) && !SINK_KEYS.has(k))

      if (hasUnknownKey) {
        const unknown = keys.find((k) => !VALID_CONFIG_KEYS.has(k) && !SINK_KEYS.has(k))
        throw new Error(
          `loggily: unknown config key "${unknown}" in config object. Valid keys: ${[...VALID_CONFIG_KEYS, ...SINK_KEYS].join(", ")}`,
        )
      }

      if (hasSinkKey) {
        if (typeof obj.file === "string") {
          const outputLevel = isValidLogLevel(obj.level) ? obj.level : config.level
          const outputNs = obj.ns ? parseNsFilter(obj.ns as string | string[]) : config.ns
          const outputFormat = (obj.format as LogFormat) ?? config.format
          const sink = createFileSink(obj.file, outputFormat)
          disposables.push(sink.dispose)
          outputs.push({
            levelPriority: LOG_LEVEL_PRIORITY[outputLevel],
            nsFilter: outputNs,
            write: sink.write,
            dispose: sink.dispose,
          })
        }
        continue
      }

      if (isValidLogLevel(obj.level)) config.level = obj.level
      if (obj.ns !== undefined) config.ns = parseNsFilter(obj.ns as string | string[])
      if (obj.format === "console" || obj.format === "json") config.format = obj.format
      continue
    }

    throw new Error(
      `loggily: unsupported config element of type "${typeof element}". ` +
        "Config arrays accept: objects (config), arrays (branches), functions (stages), console, or writables ({ write }).",
    )
  }

  const dispatch = (event: Event): void => {
    let e: Event = event
    for (const stage of stages) {
      const result = stage(e)
      if (result === null) return
      if (result !== undefined) e = result
    }
    for (const output of outputs) {
      if (e.kind === "log" && LOG_LEVEL_PRIORITY[e.level] < output.levelPriority) continue
      if (output.nsFilter && !output.nsFilter(e.namespace)) continue
      output.write(e)
    }
    for (const branch of branches) {
      branch.dispatch(e)
    }
  }

  return {
    dispatch,
    level: config.level,
    dispose: () => {
      for (const d of disposables) d()
    },
  }
}

// ============ Shared Runtime State ============

export interface RuntimeState {
  suppressConsole: boolean
  writers: Array<(formatted: string, level: string) => void>
}

export const runtimeState: RuntimeState = {
  suppressConsole: false,
  writers: [],
}

export function defaultPipeline(): Pipeline {
  const rt = runtimeState

  const disposables: (() => void)[] = []

  let fileSink: ((event: Event) => void) | null = null
  const logFile = getEnv("LOG_FILE")
  if (logFile) {
    const sink = createFileSink(logFile, "json")
    fileSink = sink.write
    disposables.push(sink.dispose)
  }

  const dispatch = (event: Event): void => {
    // Re-read level dynamically so legacy setters (setLogLevel etc.) work on existing loggers
    const currentLevel = readEnvLevel()
    if (event.kind === "log") {
      if (LOG_LEVEL_PRIORITY[event.level] < LOG_LEVEL_PRIORITY[currentLevel]) return
    } else if (event.kind === "span") {
      const trace = readEnvTrace()
      if (!trace.enabled) return
      if (trace.filter && !trace.filter(event.namespace)) return
    }
    const currentNs = readEnvNs()
    if (currentNs && !currentNs(event.namespace)) return

    const currentFormat = readEnvFormat()
    const useJson = currentFormat === "json" || getEnv("NODE_ENV") === "production" || getEnv("TRACE_FORMAT") === "json"
    const formatter = useJson ? formatJSONEvent : formatConsoleEvent

    if (rt.writers.length > 0) {
      const formatted = formatter(event)
      const lvl = event.kind === "log" ? event.level : "span"
      for (const w of rt.writers) w(formatted, lvl)
    }

    if (rt.suppressConsole) {
      fileSink?.(event)
      return
    }

    const text = formatter(event)
    if (event.kind === "span") {
      writeStderr(text)
    } else {
      switch (event.level) {
        case "trace":
        case "debug":
          console.debug(text)
          break
        case "info":
          console.info(text)
          break
        case "warn":
          console.warn(text)
          break
        case "error":
          console.error(text)
          break
      }
    }
    fileSink?.(event)
  }

  return {
    dispatch,
    get level() {
      return readEnvLevel()
    },
    dispose: () => {
      for (const d of disposables) d()
    },
  }
}

// ============ Env Var Readers ============

function readEnvLevel(): LogLevel {
  const env = getEnv("LOG_LEVEL")?.toLowerCase()
  let level: LogLevel =
    env === "trace" || env === "debug" || env === "info" || env === "warn" || env === "error" || env === "silent"
      ? env
      : "info"

  const debugEnv = getEnv("DEBUG")
  if (debugEnv && LOG_LEVEL_PRIORITY[level] > LOG_LEVEL_PRIORITY.debug) {
    level = "debug"
  }

  return level
}

function readEnvNs(): NsFilter | null {
  const debugEnv = getEnv("DEBUG")
  if (!debugEnv) return null

  const parts = debugEnv.split(",").map((s) => s.trim())
  return parseNsFilter(parts)
}

function readEnvFormat(): LogFormat {
  const envFormat = getEnv("LOG_FORMAT")?.toLowerCase()
  if (envFormat === "json") return "json"
  if (envFormat === "console") return "console"
  if (getEnv("TRACE_FORMAT") === "json") return "json"
  if (getEnv("NODE_ENV") === "production") return "json"
  return "console"
}

function readEnvTrace(): { enabled: boolean; filter: NsFilter | null } {
  const traceEnv = getEnv("TRACE")
  if (!traceEnv) return { enabled: false, filter: null }
  if (traceEnv === "1" || traceEnv === "true") return { enabled: true, filter: null }
  const prefixes = traceEnv.split(",").map((s) => s.trim())
  return {
    enabled: true,
    filter: (namespace: string) => {
      for (const prefix of prefixes) {
        if (matchesPattern(namespace, prefix)) return true
      }
      return false
    },
  }
}

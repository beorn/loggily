/**
 * One exception shape (ADR-0031 decision 2, #31167): every Error a record carries is written as OpenTelemetry's
 * exception attributes, by one builder, with no flat error_* field and no nested Error object.
 *
 * @failure A logged Error loses its stack or causes, two shapes reach disk, an Error under a secret key leaks through
 *   the new attributes, or a worker console Error arrives as a plain object without exception.*
 * @level l1
 * @consumer #31167 one logging path; @cto ruling d25c4014 (fixed amendments 1-4)
 * @testonly none
 */
import { describe, test, expect, vi } from "vitest"
import {
  baseCreateLogger,
  pipe,
  withRedaction,
  type Event,
} from "../src/index.ts"
import {
  createWorkerLogHandler,
  forwardConsole,
  restoreConsole,
  type WorkerConsoleMessage,
} from "../src/worker.ts"
import { formatJSONEvent } from "../src/pipeline.ts"
import { createConsoleMock } from "./helpers.ts"

const OLD_KEYS = ["error_type", "error_message", "error_stack", "error_code", "error_cause"]

/** A logger whose events land in `seen` after redaction, as every output and forwarding stage would see them. */
function capture(redacted = true): { log: ReturnType<typeof baseCreateLogger>; seen: Event[] } {
  const seen: Event[] = []
  const stage = (event: Event) => {
    seen.push(event)
    return event
  }
  const factory = redacted ? pipe(baseCreateLogger, withRedaction()) : baseCreateLogger
  return { log: factory("app", [{ level: "trace" }, stage]), seen }
}

function onlyProps(seen: Event[]): Record<string, unknown> {
  expect(seen).toHaveLength(1)
  return seen[0]!.props ?? {}
}

function codedError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code })
}

describe("log.<level>(err) writes the OTel exception attributes", () => {
  test("type, message, stack, error.type and the top frame; no old key", () => {
    const { log, seen } = capture(false)
    const err = new TypeError("bad input")
    log.error!(err)
    const props = onlyProps(seen)
    expect(props["exception.type"]).toBe("TypeError")
    expect(props["exception.message"]).toBe("bad input")
    expect(props["exception.stacktrace"]).toBe(err.stack)
    expect(props["error.type"]).toBe("TypeError")
    expect(typeof props["code.file.path"]).toBe("string")
    expect(props["code.file.path"]).toContain("exception-shape.test.ts")
    expect(Number.isInteger(props["code.line.number"])).toBe(true)
    for (const key of OLD_KEYS) expect(props).not.toHaveProperty(key)
  })

  test("with a message: the record keeps the message and the exception keeps the error's own", () => {
    const { log, seen } = capture(false)
    log.error!(new Error("disk full"), "save failed", { file: "a.md" })
    expect(seen[0]!.kind === "log" && seen[0]!.message).toBe("save failed")
    const props = onlyProps(seen)
    expect(props["exception.message"]).toBe("disk full")
    expect(props.file).toBe("a.md")
  })

  test("a nonempty string code is error.type; exception.type stays the name", () => {
    const { log, seen } = capture(false)
    log.error!(codedError("no such file", "ENOENT"))
    const props = onlyProps(seen)
    expect(props["error.type"]).toBe("ENOENT")
    expect(props["exception.type"]).toBe("Error")
  })

  test("a code is kept in the text too, for the exception and for each cause", () => {
    const { log, seen } = capture(false)
    const cause = codedError("connection refused", "ECONNREFUSED")
    log.error!(Object.assign(new Error("request failed", { cause }), { code: "ETIMEDOUT" }))
    const text = String(seen[0]!.props?.["exception.stacktrace"])
    expect(text).toContain("  code: ETIMEDOUT")
    expect(text).toContain(`Caused by: ${cause.stack}\n  code: ECONNREFUSED`)
  })

  test("an empty or non-string code falls back to the name", () => {
    const { log, seen } = capture(false)
    log.error!(Object.assign(new RangeError("x"), { code: "" }))
    log.error!(Object.assign(new RangeError("y"), { code: 42 }))
    expect(seen.map((event) => event.props?.["error.type"])).toEqual(["RangeError", "RangeError"])
  })

  test("causes are text in the stacktrace, three deep, and a non-Error cause keeps its details", () => {
    const { log, seen } = capture(false)
    const deepest = new Error("level 4")
    const third = new Error("level 3", { cause: deepest })
    const second = new Error("network unreachable", { cause: third })
    const first = new Error("DNS failed", { cause: second })
    const top = new Error("timeout", { cause: first })
    log.error!(top)
    log.error!(new Error("refused", { cause: { reason: "quota", remaining: 0 } }))
    const [chained, plain] = seen.map((event) => String(event.props?.["exception.stacktrace"]))
    expect(chained).toContain("Caused by: Error: DNS failed")
    expect(chained).toContain("Caused by: Error: network unreachable")
    expect(chained).toContain("Caused by: Error: level 3")
    expect(chained).not.toContain("level 4")
    expect(plain).toContain('Caused by: {"reason":"quota","remaining":0}')
  })

  test("a cause cycle ends at the depth bound", () => {
    const { log, seen } = capture(false)
    const a = new Error("a")
    const b = new Error("b", { cause: a })
    ;(a as { cause?: unknown }).cause = b
    log.error!(a)
    expect(String(seen[0]!.props?.["exception.stacktrace"]).match(/Caused by:/g)).toHaveLength(3)
  })

  test("a stack with no parsable frame omits the code.* fields, never writes them empty", () => {
    const { log, seen } = capture(false)
    const err = new Error("no frames")
    err.stack = "Error: no frames\n    at <anonymous>"
    log.error!(err)
    const props = onlyProps(seen)
    expect(props).not.toHaveProperty("code.file.path")
    expect(props).not.toHaveProperty("code.line.number")
    expect(props).not.toHaveProperty("code.function.name")
  })

  test("the JSON line on disk carries the attributes flat", () => {
    const { log, seen } = capture(false)
    log.error!(codedError("gone", "ECONNRESET"), "send failed")
    const line = JSON.parse(formatJSONEvent(seen[0]!)) as Record<string, unknown>
    expect(line.msg).toBe("send failed")
    expect(line["exception.type"]).toBe("Error")
    expect(line["error.type"]).toBe("ECONNRESET")
    for (const key of OLD_KEYS) expect(line).not.toHaveProperty(key)
  })
})

describe("an Error passed inside the data object", () => {
  test("the first own top-level Error becomes the exception, on a copy of the caller's data", () => {
    const { log, seen } = capture(false)
    const error = codedError("socket closed", "ECONNRESET")
    const data = { error, peer: "hab1" }
    log.warn!("request failed", data)
    const props = onlyProps(seen)
    expect(props["exception.message"]).toBe("socket closed")
    expect(props["error.type"]).toBe("ECONNRESET")
    expect(props).not.toHaveProperty("error")
    expect(props.peer).toBe("hab1")
    expect(data).toEqual({ error, peer: "hab1" })
  })

  test("an explicit Error argument wins over one in the data", () => {
    const { log, seen } = capture(false)
    log.error!(new Error("the real one"), "failed", { other: new Error("bystander") })
    const props = onlyProps(seen)
    expect(props["exception.message"]).toBe("the real one")
    expect(String(props.other)).toContain("Error: bystander")
  })

  test("a second or deeper Error keeps its stack and causes as text", () => {
    const { log, seen } = capture(false)
    const second = new Error("second", { cause: new Error("second's cause") })
    const nested = new Error("nested")
    log.warn!("two errors", { first: new Error("first"), second, wrapper: { nested } })
    const line = JSON.parse(formatJSONEvent(seen[0]!)) as Record<string, unknown>
    expect(line["exception.message"]).toBe("first")
    expect(line.second).toBe(`${second.stack}\nCaused by: ${(second.cause as Error).stack}`)
    expect((line.wrapper as Record<string, unknown>).nested).toBe(nested.stack)
  })

  test("safeStringify keeps its BigInt, Symbol and circular handling", () => {
    const { log, seen } = capture(false)
    const loop: Record<string, unknown> = { name: "loop" }
    loop.self = loop
    log.info!("values", { big: 10n, sym: Symbol("s"), loop })
    const line = JSON.parse(formatJSONEvent(seen[0]!)) as Record<string, unknown>
    expect(line.big).toBe("10")
    expect(line.sym).toBe("Symbol(s)")
    expect((line.loop as Record<string, unknown>).self).toBe("[Circular]")
  })
})

describe("redaction keeps its boundary", () => {
  test("an Error under a secret key is redacted by its key, never promoted into exception.*", () => {
    const { log, seen } = capture()
    log.warn!("login failed", { password: new Error("ordinary-private-value") })
    const serialized = JSON.stringify(seen)
    expect(serialized).not.toContain("ordinary-private-value")
    expect(seen[0]!.props).not.toHaveProperty("exception.message")
    expect(seen[0]!.props?.password).toBe("[REDACTED]")
  })

  test("token patterns are redacted in the message, a cause and the code path", () => {
    const { log, seen } = capture()
    const err = new Error("call failed Bearer abc.def.ghi", { cause: new Error("upstream sk-cause-secret-1") })
    err.stack = `Error: call failed Bearer abc.def.ghi\n    at run (/srv/ghp_${"a".repeat(36)}/job.ts:3:9)`
    log.error!(err)
    const serialized = JSON.stringify(seen)
    expect(serialized).not.toMatch(/abc\.def\.ghi|sk-cause-secret-1|ghp_a{36}/u)
    expect(String(seen[0]!.props?.["code.file.path"])).toContain("[REDACTED]")
  })

  test("the console route still gets the redacted Error itself", () => {
    const { log, seen } = capture()
    log.warn!("failed", { error: new Error("Bearer console-secret") })
    const userArgs = seen[0]!.kind === "log" ? seen[0]!.userArgs : undefined
    expect(userArgs?.[0]).toBeInstanceOf(Error)
    expect(JSON.stringify(seen)).not.toContain("console-secret")
  })
})

describe("a worker console Error", () => {
  /** Run console calls inside forwardConsole and return the messages as the main thread receives them (cloned). */
  function fromWorker(run: () => void): WorkerConsoleMessage[] {
    const posted: WorkerConsoleMessage[] = []
    forwardConsole((message) => posted.push(structuredClone(message)), "job")
    try {
      run()
    } finally {
      restoreConsole()
    }
    return posted
  }

  /** The JSON lines the main thread's default logger writes for those messages. */
  function mainThreadLines(messages: WorkerConsoleMessage[]): Record<string, unknown>[] {
    const previous = process.env.LOG_FORMAT
    process.env.LOG_FORMAT = "json"
    const consoleMock = createConsoleMock()
    try {
      const handle = createWorkerLogHandler()
      for (const message of messages) handle(message)
      return consoleMock.output.map((row) => JSON.parse(row.message) as Record<string, unknown>)
    } finally {
      vi.restoreAllMocks()
      if (previous === undefined) delete process.env.LOG_FORMAT
      else process.env.LOG_FORMAT = previous
    }
  }

  test("crosses the thread boundary as the canonical attributes; other arguments keep their place", () => {
    const err = codedError("cannot write", "EACCES")
    const [line] = mainThreadLines(fromWorker(() => console.error("write failed", err, { attempt: 2 })))
    expect(line!["exception.type"]).toBe("Error")
    expect(line!["exception.message"]).toBe("cannot write")
    expect(line!["error.type"]).toBe("EACCES")
    expect(line!["exception.stacktrace"]).toBe(`${err.stack}\n  code: EACCES`)
    expect(line!.attempt).toBe(2)
    expect(String(line!.msg)).toContain("write failed")
    expect(String(line!.msg)).toContain("Error: cannot write")
    for (const key of OLD_KEYS) expect(line).not.toHaveProperty(key)
  })

  test("an ordinary object with name/message/stack keys is never read as an exception", () => {
    const [line] = mainThreadLines(
      fromWorker(() => console.warn("plain", { name: "Box", message: "not an error", stack: "fake" })),
    )
    expect(line).not.toHaveProperty("exception.type")
  })

  test("causes go through the same builder and token patterns are redacted on the main side", () => {
    const messages = fromWorker(() =>
      console.error(new Error("outer", { cause: new Error("inner Bearer worker.token.x") })),
    )
    const [line] = mainThreadLines(messages)
    expect(String(line!["exception.stacktrace"])).toContain("Caused by: Error: inner")
    expect(JSON.stringify(line)).not.toContain("worker.token.x")
  })
})

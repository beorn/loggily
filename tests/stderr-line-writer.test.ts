/**
 * @failure A loggily byte bound for fd 2 that bypasses the stderr line writer is a direct write, and a
 *          direct write parks the process on a stalled stderr reader (km 25947). With a writer set, every
 *          terminal sink kind and level, spans, the "stderr" output by name and by stream and the
 *          pipeline guard's own report must reach the writer while console.*, process.stdout.write
 *          and process.stderr.write see no call; unsetting it restores the direct path.
 * @level l1
 * @consumer @km/daemon/25947-bd-close-blocks-daemon
 * @testonly none
 */
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createTerminalConsoleSink } from "../src/console-sinks.ts"
import {
  buildPipeline,
  getStderrLineWriter,
  setStderrLineWriter,
} from "../src/pipeline.ts"
import type { Event, OutputLogLevel } from "../src/pipeline.ts"

const LEVELS: OutputLogLevel[] = ["trace", "debug", "info", "warn", "error"]
const CONSOLE_METHODS = [
  "log",
  "info",
  "debug",
  "warn",
  "error",
  "trace",
  "dir",
  "table",
] as const

function logEvent(level: OutputLogLevel): Event {
  return {
    kind: "log",
    time: 0,
    namespace: "myapp",
    level,
    message: `payload-${level}`,
    userArgs: [],
  }
}

function spanEvent(): Event {
  return {
    kind: "span",
    time: 0,
    namespace: "payload-spanmarker",
    name: "op",
    duration: 7,
    spanId: "sp_1",
    traceId: "tr_1",
    parentId: null,
    userArgs: [],
  }
}

const EVENTS: Event[] = [...LEVELS.map(logEvent), spanEvent()]

let direct: string[]
let lines: string[]

beforeEach(() => {
  direct = []
  lines = []
  for (const name of CONSOLE_METHODS) {
    vi.spyOn(console, name).mockImplementation(() => {
      direct.push(`console.${name}`)
    })
  }
  vi.spyOn(process.stdout, "write").mockImplementation(() => {
    direct.push("process.stdout.write")
    return true
  })
  vi.spyOn(process.stderr, "write").mockImplementation(() => {
    direct.push("process.stderr.write")
    return true
  })
  expect(setStderrLineWriter((line) => lines.push(line))).toBeNull()
})

afterEach(() => {
  setStderrLineWriter(null)
  vi.restoreAllMocks()
})

function expectEveryLevelAndNoDirectCall(withSpan: boolean): void {
  expect(direct, "a direct console or stream call escaped the writer").toEqual(
    [],
  )
  const text = lines.join("\n")
  for (const level of LEVELS) expect(text).toContain(`payload-${level}`)
  if (withSpan) expect(text).toContain("payload-spanmarker")
  for (const line of lines) expect(line).not.toContain("\n")
}

describe("every fd 2 path goes through the stderr line writer", () => {
  test.each(["console", "json"] as const)(
    "terminal console sink, %s format: five levels and a span",
    (format) => {
      const sink = createTerminalConsoleSink(format)
      for (const event of EVENTS) sink(event)
      expectEveryLevelAndNoDirectCall(true)
      expect(lines).toHaveLength(EVENTS.length)
    },
  )

  test.each(["console", "json"] as const)(
    'the "stderr" output by name, %s format',
    (format) => {
      const pipeline = buildPipeline([{ level: "trace", format }, "stderr"])
      for (const event of EVENTS) pipeline.dispatch(event)
      pipeline.dispose()
      expectEveryLevelAndNoDirectCall(false)
    },
  )

  test("the process's own stderr stream given as an output", () => {
    const pipeline = buildPipeline([{ level: "trace" }, process.stderr])
    for (const event of EVENTS) pipeline.dispatch(event)
    pipeline.dispose()
    expectEveryLevelAndNoDirectCall(false)
  })

  test("the console output by name", () => {
    const pipeline = buildPipeline([{ level: "trace" }, "console"])
    for (const event of EVENTS) pipeline.dispatch(event)
    pipeline.dispose()
    expectEveryLevelAndNoDirectCall(false)
  })

  test("the pipeline guard reports a broken stage through the writer", () => {
    const pipeline = buildPipeline([
      { level: "trace" },
      () => {
        throw new Error("always broken")
      },
    ])
    pipeline.dispatch(logEvent("info"))
    pipeline.dispose()
    expect(direct).toEqual([])
    expect(
      lines.filter((line) => line.includes("loggily: stage")),
    ).toHaveLength(1)
  })

  test("unsetting the writer returns it and restores the direct path", () => {
    const previous = getStderrLineWriter()
    expect(previous).not.toBeNull()
    expect(setStderrLineWriter(null)).toBe(previous)
    createTerminalConsoleSink()(logEvent("error"))
    expect(direct).toEqual(["console.error"])
    expect(lines).toEqual([])
  })
})

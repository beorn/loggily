/**
 * Tests for dispatch-loop guarding: a logger must never throw into its host.
 *
 * Contract:
 * - A throwing STAGE drops the event (fail-closed — a broken redaction stage
 *   must not leak unprocessed events) and is reported once, not per event.
 * - A throwing OUTPUT is isolated: other outputs and branches still receive
 *   the event. After 3 consecutive failures the output is disabled with a
 *   final notice; a success in between resets the counter.
 * - A throwing BRANCH dispatch is isolated from outputs and other branches.
 * - Reports go directly to stderr (never back through the pipeline — no
 *   recursion).
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"

import { buildPipeline } from "../src/pipeline.ts"
import type { Event, LogEvent } from "../src/pipeline.ts"

function logEvent(message: string): LogEvent {
  return { kind: "log", time: Date.now(), namespace: "t", level: "info", message }
}

let stderrSpy: ReturnType<typeof vi.spyOn>

beforeEach(() => {
  stderrSpy = vi
    .spyOn(process.stderr, "write")
    .mockImplementation(() => true)
})

afterEach(() => {
  stderrSpy.mockRestore()
})

const stderrText = () =>
  stderrSpy.mock.calls.map((c) => String(c[0])).join("")

describe("dispatch guard — stages", () => {
  test("throwing stage does not throw into the host and drops the event", () => {
    const seen: Event[] = []
    const pipeline = buildPipeline([
      { level: "trace" },
      (e) => {
        if (e.kind === "log" && e.message === "boom") throw new Error("stage broke")
        return e
      },
      { write: (e: Event) => void seen.push(e) },
    ])

    expect(() => pipeline.dispatch(logEvent("boom"))).not.toThrow()
    // fail-closed: the event that broke the stage is dropped
    expect(seen).toHaveLength(0)
    // subsequent events still flow
    pipeline.dispatch(logEvent("ok"))
    expect(seen.map((e) => (e as LogEvent).message)).toEqual(["ok"])
  })

  test("stage failure is reported once per stage, not once per event", () => {
    const pipeline = buildPipeline([
      { level: "trace" },
      () => {
        throw new Error("always broken")
      },
    ])
    pipeline.dispatch(logEvent("a"))
    pipeline.dispatch(logEvent("b"))
    pipeline.dispatch(logEvent("c"))
    const reports = stderrText().match(/loggily: stage/g) ?? []
    expect(reports).toHaveLength(1)
  })
})

describe("dispatch guard — outputs", () => {
  test("throwing output is isolated; other outputs still receive the event", () => {
    const seen: Event[] = []
    const pipeline = buildPipeline([
      { level: "trace" },
      {
        write: () => {
          throw new Error("sink broke")
        },
      },
      { write: (e: Event) => void seen.push(e) },
    ])

    expect(() => pipeline.dispatch(logEvent("hello"))).not.toThrow()
    expect(seen).toHaveLength(1)
  })

  test("output disabled after 3 consecutive failures with a final notice", () => {
    let attempts = 0
    const seen: Event[] = []
    const pipeline = buildPipeline([
      { level: "trace" },
      {
        write: () => {
          attempts++
          throw new Error("sink broke")
        },
      },
      { write: (e: Event) => void seen.push(e) },
    ])

    for (let i = 0; i < 5; i++) pipeline.dispatch(logEvent(`e${i}`))
    // 3 strikes, then disabled — no further write attempts
    expect(attempts).toBe(3)
    // healthy output unaffected throughout
    expect(seen).toHaveLength(5)
    expect(stderrText()).toMatch(/disabled/)
  })

  test("a success resets the consecutive-failure counter", () => {
    let attempts = 0
    let failNext = true
    const pipeline = buildPipeline([
      { level: "trace" },
      {
        write: () => {
          attempts++
          if (failNext) throw new Error("flaky sink")
        },
      },
    ])

    // fail, fail, success, fail, fail, fail → disabled only after the
    // post-success run of 3
    failNext = true
    pipeline.dispatch(logEvent("1"))
    pipeline.dispatch(logEvent("2"))
    failNext = false
    pipeline.dispatch(logEvent("3"))
    failNext = true
    pipeline.dispatch(logEvent("4"))
    pipeline.dispatch(logEvent("5"))
    pipeline.dispatch(logEvent("6"))
    pipeline.dispatch(logEvent("7")) // disabled by now — not attempted
    expect(attempts).toBe(6)
  })
})

describe("dispatch guard — branches", () => {
  test("a throwing branch stage does not affect sibling outputs", () => {
    const seen: Event[] = []
    const pipeline = buildPipeline([
      { level: "trace" },
      [
        { level: "trace" },
        () => {
          throw new Error("branch broke")
        },
      ],
      { write: (e: Event) => void seen.push(e) },
    ])

    expect(() => pipeline.dispatch(logEvent("hello"))).not.toThrow()
    expect(seen).toHaveLength(1)
  })
})

/**
 * @failure Forced CLI exits can drop buffered stdout or stderr while reporting
 *          success. A drain that rejects early also lets a sibling stream lose
 *          its final output; a duplicate Node error event must not become an
 *          unhandled exception after the original failure was observed.
 * @level   l1 — Node writable-stream completion and error events
 * @consumer Node CLIs that must finish their final output before a forced exit
 */

import { EventEmitter } from "node:events"
import { describe, expect, test } from "vitest"
import { drainOutput } from "../src/index.ts"

type EndCallback = (error?: Error | null) => void

class ControlledWritable extends EventEmitter {
  ends = 0
  #callback: EndCallback | undefined

  end(callback: EndCallback): this {
    this.ends += 1
    this.#callback = callback
    return this
  }

  complete(): void {
    this.#callback?.()
  }

  failFromCallback(error: Error): void {
    this.#callback?.(error)
  }

  emitFailure(error?: Error): void {
    this.emit("error", error)
  }
}

class ListenerRegistrationFailure {
  ends = 0

  constructor(readonly failure: unknown) {}

  on(): never {
    throw this.failure
  }

  end(): this {
    this.ends += 1
    return this
  }
}

function writable(stream: object): NodeJS.WritableStream {
  return stream as unknown as NodeJS.WritableStream
}

describe("drainOutput", () => {
  test("settles both streams and preserves the first callback or event failure until its sibling drains", async () => {
    const stdout = new ControlledWritable()
    const stderr = new ControlledWritable()
    const successful = drainOutput([writable(stdout), writable(stderr)])
    let successSettled = false
    void successful.then(() => {
      successSettled = true
    })

    expect(stdout.ends).toBe(1)
    expect(stderr.ends).toBe(1)
    stdout.complete()
    await Promise.resolve()
    expect(successSettled).toBe(false)
    stderr.complete()
    await expect(successful).resolves.toBeUndefined()
    expect(stdout.listenerCount("error")).toBe(0)
    expect(stderr.listenerCount("error")).toBe(0)

    const slowFirst = new ControlledWritable()
    const failingSecond = new ControlledWritable()
    const callbackFailure = new Error("stdout pipe failed")
    const callbackRejected = drainOutput([
      writable(slowFirst),
      writable(failingSecond),
    ])
    let callbackSettled = false
    void callbackRejected.then(
      () => {
        callbackSettled = true
      },
      () => {
        callbackSettled = true
      },
    )

    failingSecond.failFromCallback(callbackFailure)
    expect(() => failingSecond.emitFailure(callbackFailure)).not.toThrow()
    await Promise.resolve()
    expect(callbackSettled).toBe(false)
    slowFirst.complete()
    await expect(callbackRejected).rejects.toBe(callbackFailure)

    const secondSlowFirst = new ControlledWritable()
    const eventFailingSecond = new ControlledWritable()
    const eventRejected = drainOutput([
      writable(secondSlowFirst),
      writable(eventFailingSecond),
    ])
    let eventSettled = false
    void eventRejected.then(
      () => {
        eventSettled = true
      },
      () => {
        eventSettled = true
      },
    )

    eventFailingSecond.emitFailure()
    await Promise.resolve()
    expect(eventSettled).toBe(false)
    secondSlowFirst.complete()
    await expect(eventRejected).rejects.toBeUndefined()
    expect(() => eventFailingSecond.emitFailure()).not.toThrow()
  })

  test("preserves a listener-registration failure until the other selected stream drains", async () => {
    const registrationFailure = new Error("stream rejects error listener")
    const invalid = new ListenerRegistrationFailure(registrationFailure)
    const slow = new ControlledWritable()
    const draining = drainOutput([writable(invalid), writable(slow)])
    let settled = false
    void draining.then(
      () => {
        settled = true
      },
      () => {
        settled = true
      },
    )

    expect(invalid.ends).toBe(0)
    expect(slow.ends).toBe(1)
    await Promise.resolve()
    expect(settled).toBe(false)
    slow.complete()
    await expect(draining).rejects.toBe(registrationFailure)
  })
})

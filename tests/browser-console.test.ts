/**
 * Browser / structured console sink tests — km-loggily.browser-console
 *
 * The console sink used to pre-format events into a single ANSI string and
 * push it with `console.info(text)`. That breaks in browsers (ANSI garbage)
 * and loses DevTools features (expandable objects, source locations, CSS
 * colors).
 *
 * After this change:
 *   - Terminal sink: multi-arg spread — `console.info(ansiPrefix, message, ...userArgs)`
 *     so util.format keeps objects expandable in Node DevTools.
 *   - Browser sink: `%c` CSS format specifiers for level+namespace colors,
 *     then user message, then raw user args — so DevTools renders colored
 *     prefix and keeps objects expandable/clickable.
 *   - Both: arrow functions (not `Function.prototype.bind.call`) so the
 *     caller's source location is preserved and `console.info` can be mocked.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"
import { createLogger, type Event } from "../src/index.ts"
import {
  createBrowserConsoleSink,
  createTerminalConsoleSink,
} from "../src/console-sinks.ts"

describe("console sinks receive structured args (not pre-formatted strings)", () => {
  describe("terminal sink", () => {
    let spy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      spy = vi.spyOn(console, "info").mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    test("passes multiple args to console.info (not a single pre-formatted string)", () => {
      const sink = createTerminalConsoleSink()
      const event: Event = {
        kind: "log",
        time: 0,
        namespace: "myapp",
        level: "info",
        message: "hello world",
        props: { requestId: "abc" },
        userArgs: [{ requestId: "abc" }],
      }
      sink(event)
      expect(spy).toHaveBeenCalledOnce()
      const args = spy.mock.calls[0]!
      // The prefix string carries level + namespace; the message and user
      // objects travel as separate args so util.format leaves them as
      // inspectable objects.
      expect(args.length).toBeGreaterThanOrEqual(3)
      const prefix = String(args[0])
      expect(prefix).toContain("INFO")
      expect(prefix).toContain("myapp")
      // User args passed raw (not merged into a stringified props blob)
      expect(args.some((a) => a && typeof a === "object" && "requestId" in a)).toBe(true)
    })

    test("message is a separate arg from the prefix", () => {
      const sink = createTerminalConsoleSink()
      sink({
        kind: "log",
        time: 0,
        namespace: "myapp",
        level: "info",
        message: "hello",
        userArgs: [],
      })
      const args = spy.mock.calls[0]!
      // Prefix (levels+ns), then message
      expect(String(args[0])).not.toContain("hello")
      expect(args).toContain("hello")
    })
  })

  describe("browser sink", () => {
    let spy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      spy = vi.spyOn(console, "info").mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    test("uses %c CSS format specifiers for colored level + namespace", () => {
      const sink = createBrowserConsoleSink()
      sink({
        kind: "log",
        time: 0,
        namespace: "myapp",
        level: "info",
        message: "hello",
        userArgs: [],
      })
      const args = spy.mock.calls[0]!
      const template = String(args[0])
      // %c pairs: at least one for level, one for namespace
      const pctC = (template.match(/%c/g) ?? []).length
      expect(pctC).toBeGreaterThanOrEqual(2)
      // And no ANSI escapes leaking through
      expect(template).not.toMatch(/\x1b\[/)
    })

    test("CSS strings follow each %c in arg order", () => {
      const sink = createBrowserConsoleSink()
      sink({
        kind: "log",
        time: 0,
        namespace: "myapp",
        level: "error",
        message: "boom",
        userArgs: [],
      })
      const args = spy.mock.calls[0]!
      const template = String(args[0])
      const pctC = (template.match(/%c/g) ?? []).length
      // Style args follow template: args[1..pctC] should be CSS strings
      for (let i = 1; i <= pctC; i++) {
        expect(typeof args[i]).toBe("string")
        expect(String(args[i])).toMatch(/color:|font-weight:/)
      }
    })

    test("user args are spread after the formatted prefix (preserves object expandability)", () => {
      const sink = createBrowserConsoleSink()
      const data = { requestId: "abc", nested: { a: 1 } }
      sink({
        kind: "log",
        time: 0,
        namespace: "myapp",
        level: "info",
        message: "request",
        userArgs: [data],
      })
      const args = spy.mock.calls[0]!
      // The original object reference must be present (not a JSON string of it)
      expect(args.some((a) => a === data)).toBe(true)
      // And not JSON-blobbed into the prefix
      expect(String(args[0])).not.toContain("requestId")
    })

    test("routes by level: debug→console.debug, warn→console.warn, error→console.error", () => {
      const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {})
      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
      const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {})
      const sink = createBrowserConsoleSink()
      sink({
        kind: "log",
        time: 0,
        namespace: "n",
        level: "debug",
        message: "d",
        userArgs: [],
      })
      sink({
        kind: "log",
        time: 0,
        namespace: "n",
        level: "warn",
        message: "w",
        userArgs: [],
      })
      sink({
        kind: "log",
        time: 0,
        namespace: "n",
        level: "error",
        message: "e",
        userArgs: [],
      })
      expect(debugSpy).toHaveBeenCalledOnce()
      expect(warnSpy).toHaveBeenCalledOnce()
      expect(errorSpy).toHaveBeenCalledOnce()
    })
  })

  describe("arrow functions preserve caller location (console mockable)", () => {
    test("sink functions are mockable after import — console.info re-read at call time", () => {
      // If the sink captured console.info via .bind() at creation time, a
      // later spyOn would NOT intercept calls. Arrows re-read `console.info`
      // on every call, so mocks installed after sink creation still fire.
      const sink = createTerminalConsoleSink()
      const spy = vi.spyOn(console, "info").mockImplementation(() => {})
      sink({
        kind: "log",
        time: 0,
        namespace: "n",
        level: "info",
        message: "m",
        userArgs: [],
      })
      expect(spy).toHaveBeenCalledOnce()
      vi.restoreAllMocks()
    })
  })

  describe("end-to-end: createLogger wiring", () => {
    let spy: ReturnType<typeof vi.spyOn>

    beforeEach(() => {
      spy = vi.spyOn(console, "info").mockImplementation(() => {})
    })
    afterEach(() => {
      vi.restoreAllMocks()
    })

    test("log.info(msg, data) reaches console.info as multi-arg (data stays an object)", () => {
      const log = createLogger("app", [{ level: "debug" }, "console"])
      const data = { user: "alice", count: 42 }
      log.info?.("greeting", data)
      expect(spy).toHaveBeenCalledOnce()
      const args = spy.mock.calls[0]!
      // At least: [prefix, message, ...props]. The user's data object must
      // appear as an object, not a JSON-stringified blob inside the prefix.
      expect(args.length).toBeGreaterThanOrEqual(2)
      expect(args.some((a) => a && typeof a === "object")).toBe(true)
    })
  })
})

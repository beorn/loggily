import { describe, expect, test } from "vitest"
import { resolveVerbosityLevel } from "../src/index.ts"

describe("resolveVerbosityLevel", () => {
  test.each([
    ["warn", 0, 0, "warn"],
    ["warn", 1, 0, "info"],
    ["warn", 2, 0, "debug"],
    ["warn", 3, 0, "trace"],
    ["warn", 0, 1, "error"],
    ["warn", 0, 2, "fatal"],
    ["warn", 0, 3, "silent"],
    ["error", 0, 1, "fatal"],
    ["error", 0, 2, "silent"],
    ["fatal", 1, 0, "error"],
    ["warn", 4, 0, "trace"],
    ["warn", 0, 4, "silent"],
    ["warn", 1, 1, "warn"],
    ["debug", 1, 0, "trace"],
  ] as const)(
    "shifts %s by verbose=%d quiet=%d to %s",
    (base, verbose, quiet, expected) => {
      expect(resolveVerbosityLevel(base, verbose, quiet)).toBe(expected)
    },
  )
})

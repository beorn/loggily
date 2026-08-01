/**
 * Universal runtime compatibility tests for loggily.
 *
 * Verifies that the core logger works when Node.js globals (process, fs) are unavailable,
 * as they would be in browser/edge/Deno environments.
 */

import { describe, test, expect, beforeEach, afterEach, vi } from "vitest"

describe("universal runtime compatibility", () => {
  describe("core module (no fs dependency)", () => {
    test("core.ts does not import node:fs", async () => {
      const coreSource = await Bun.file(
        new URL("../src/core.ts", import.meta.url).pathname,
      ).text()
      expect(coreSource).not.toContain('from "fs"')
      expect(coreSource).not.toContain('from "node:fs"')
      expect(coreSource).not.toContain("require(")
    })

    test("index.browser.ts does not import node:fs or file-writer", async () => {
      const browserSource = await Bun.file(
        new URL("../src/index.browser.ts", import.meta.url).pathname,
      ).text()
      expect(browserSource).not.toContain('from "node:fs"')
      // Type-only imports from file-writer are fine (erased at compile time)
      // But no runtime imports from file-writer
      const runtimeImportLines = browserSource
        .split("\n")
        .filter(
          (line: string) =>
            line.includes("file-writer") &&
            !line.includes("type {") &&
            !line.includes("type{") &&
            !line.trim().startsWith("//"),
        )
      expect(runtimeImportLines).toEqual([])
      // But it should re-export from core
      expect(browserSource).toContain("./core.js")
    })

    test("withRedaction has no runtime imports and is exported by the browser entry", async () => {
      const redactionSource = await Bun.file(
        new URL("../src/redaction.ts", import.meta.url).pathname,
      ).text()
      const browserSource = await Bun.file(
        new URL("../src/index.browser.ts", import.meta.url).pathname,
      ).text()
      const runtimeImports = redactionSource
        .split("\n")
        .filter(
          (line) =>
            /^import\s/u.test(line.trim()) &&
            !/^import\s+type\b/u.test(line.trim()),
        )

      expect(runtimeImports).toEqual([])
      expect(redactionSource).not.toMatch(/(?:node:|file-writer)/u)
      expect(browserSource).toContain('from "./redaction.js"')
      const browser = await import("../src/index.browser.ts")
      expect(browser.withRedaction).toBeTypeOf("function")
    })
  })

  describe("browser entry createFileWriter stub", () => {
    test("throws with helpful message", async () => {
      const { createFileWriter } = await import("../src/index.browser.ts")
      expect(() => createFileWriter()).toThrow("not available in browser")
    })
  })

  describe("file-writer separation", () => {
    test("file-writer.ts imports from node:fs", async () => {
      const fwSource = await Bun.file(
        new URL("../src/file-writer.ts", import.meta.url).pathname,
      ).text()
      expect(fwSource).toContain('from "node:fs"')
    })

    test("index.ts re-exports createFileWriter from file-writer", async () => {
      const indexSource = await Bun.file(
        new URL("../src/index.ts", import.meta.url).pathname,
      ).text()
      expect(indexSource).toContain("./file-writer.js")
      expect(indexSource).toContain("createFileWriter")
    })
  })

  describe("getEnv guard", () => {
    test("process.env reads use getEnv helper (no bare process.env)", async () => {
      const coreSource = await Bun.file(
        new URL("../src/core.ts", import.meta.url).pathname,
      ).text()
      // Should not have bare process.env reads (except in the getEnv function itself and _process init)
      const lines = coreSource.split("\n")
      const bareProcessEnvLines = lines.filter(
        (line, i) =>
          line.includes("process.env") &&
          !line.includes("_process") &&
          !line.includes("getEnv") &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*"),
      )
      expect(bareProcessEnvLines).toEqual([])
    })
  })

  describe("writeStderr guard", () => {
    test("no bare process.stderr.write calls in core", async () => {
      const coreSource = await Bun.file(
        new URL("../src/core.ts", import.meta.url).pathname,
      ).text()
      const lines = coreSource.split("\n")
      const bareStderrLines = lines.filter(
        (line) =>
          line.includes("process.stderr") &&
          !line.includes("_process") &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*"),
      )
      expect(bareStderrLines).toEqual([])
    })
  })

  describe("no bare process references in core", () => {
    test("all process usage goes through _process guard", async () => {
      const coreSource = await Bun.file(
        new URL("../src/core.ts", import.meta.url).pathname,
      ).text()
      const lines = coreSource.split("\n")
      const bareProcessLines = lines.filter(
        (line) =>
          // Match bare `process.` but not `_process.` or `typeof process`
          /(?<![_\w])process\./.test(line) &&
          !line.includes("_process") &&
          !line.includes("typeof process") &&
          !line.trim().startsWith("//") &&
          !line.trim().startsWith("*"),
      )
      expect(bareProcessLines).toEqual([])
    })
  })
})

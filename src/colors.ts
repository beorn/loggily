/**
 * Vendored ANSI color functions — replaces picocolors dependency.
 * Supports NO_COLOR, FORCE_COLOR, and TTY detection.
 */

const _process = typeof process !== "undefined" ? process : undefined

const enabled =
  _process?.env?.["FORCE_COLOR"] !== undefined &&
  _process?.env?.["FORCE_COLOR"] !== "0"
    ? true
    : _process?.env?.["NO_COLOR"] !== undefined
      ? false
      : (_process?.stdout?.isTTY ?? false)

function wrap(open: string, close: string): (str: string) => string {
  if (!enabled) return (str) => str
  return (str) => open + str + close
}

export const colors = {
  dim: wrap("\x1b[2m", "\x1b[22m"),
  blue: wrap("\x1b[34m", "\x1b[39m"),
  yellow: wrap("\x1b[33m", "\x1b[39m"),
  red: wrap("\x1b[31m", "\x1b[39m"),
  magenta: wrap("\x1b[35m", "\x1b[39m"),
  cyan: wrap("\x1b[36m", "\x1b[39m"),
}

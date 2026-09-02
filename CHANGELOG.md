# Changelog

## Unreleased

- **`debug`-package globs match** — a pattern with a `*` that is neither the
  bare `*` nor a trailing `:*` (`DEBUG='yrd*'`) fell through to the literal
  branch of the matcher, so it named a namespace called `yrd*` and matched
  nothing; and because an include list that matches nothing admits nothing at
  any level, it silently blanked every row, ERROR rows included, while the docs
  promised `debug`-compatible patterns (measured 2026-09-01 on a merge-queue
  pass log that came back empty). `*` now matches any run of characters
  anywhere in a pattern, as in `debug`: `yrd*` admits `yrd`, `yrd:cli` and
  `yrdx`; `app:*:query` admits `app:db:query`. Bare names, `name:*` and `*`
  are unchanged.

- **Console output goes to stderr** — the terminal console sink routed `info`
  and `debug` through `console.info` and `console.debug`, which Node writes to
  STDOUT. Diagnostics therefore shared the stream that carries a command's
  answer: one INFO line and `cmd --json | jq` reads a SyntaxError instead of a
  result. Every level now reaches stderr — `console.warn` for `warn`,
  `console.error` for the rest, those being the only two stderr-writing console
  methods — so `warn` and `error` are unchanged and `trace`, `debug` and `info`
  move. The level is still rendered in the prefix (`INFO`, `DEBUG`).
  The BROWSER sink is deliberately unchanged: DevTools has no stdout/stderr
  split, and `console.info`/`console.debug` are what drive its level filter and
  `%c` rendering.

  **Migration.** Code that asserts which console METHOD a level uses should
  assert `console.error`, or read the level from the rendered prefix. Consumers
  that suppressed the console sink to keep stdout clean — a private
  `routeLogsToStderr()`, or an unconditional `setSuppressConsole(true)` in a
  process whose stdout is a protocol — can drop the workaround and get their
  diagnostics back on stderr.

- **Removed `.logger()`** — use `.child()`. Mechanically equivalent — the
  alias was a one-line delegate to `.child()`. Removed so child-logger
  creation has one canonical method, not two.
- **Removed the `SpannedLogger` type** — use `ConditionalLogger`.
  `SpannedLogger` was a pure type alias (`type SpannedLogger =
ConditionalLogger`), unreferenced anywhere in the codebase and never
  exported from the browser entry point.
- **Identifier-safe redaction** — ordinary mixed-case paths, branch names,
  session ids, and other opaque identifiers are no longer classified as
  credentials by shape alone. Known Bearer, `sk-…`, AWS access-key, and
  32-character hex forms remain redacted, as do values under credential-bearing
  structured keys.
- **Default redaction plugin** — `createLogger()` now composes
  `withRedaction()` through the existing
  logger-plugin pipeline and replaces common credential keys and recognized
  credential forms before stages, branches, console, file, or global-writer
  outputs. It handles circular structured data, errors, raw arguments, and
  spans in both Node and browser builds without mutating source events. Custom
  factories built from `baseCreateLogger()` can opt in with the same plugin.

## 0.10.2

- **`createFileWriter` std-stream paths** — `/dev/stdout`, `/dev/stderr`,
  `/dev/fd/N`, `/proc/self/fd/N` now bind the already-open descriptor
  instead of `openSync(path, "a")`, which works on macOS but throws ENXIO
  on Linux whenever the stream is a pipe (CI runners). Fixes the
  `DEBUG_LOG=/dev/stderr` diagnostic recipe under CI; borrowed std fds are
  never closed by `close()`.

## 0.10.0

- **Removed `addWriterFor`** — use `addWriter({ ns: pattern }, writer)`.
  Mechanically equivalent — the alias was a one-line delegate. All
  consumers migrated in 0.9.0; removed here so the API surface has one
  way to register a writer, not two.

## 0.9.0

- **`addWriter` unified overload** — `addWriter(writer)` (catch-all) and
  `addWriter({ ns, level }, writer)` (scoped) are now one primitive. The
  config object accepts `ns` (DEBUG-style glob, including arrays + excludes)
  and `level` (records below the level skip the writer). One mental model
  for catch-all + namespace-scoped + level-scoped registration.
- **`addWriterFor` deprecated** — kept as a one-line alias delegating to
  `addWriter({ ns: pattern }, writer)`. Removed in 0.10.0.

## 0.8.0

- **OpenTelemetry bridge** — new `loggily/otel` subpath with `toOtel()` stage
- **Metrics** — `{ metrics: true }` in config creates a collector on `log.metrics` (p50/p95/p99)
- **Writable default flipped** — `{ write }` objects receive raw Events by default; Node streams auto-detect to strings
- **Config-based tracing** — `TRACE_ID_FORMAT`, `TRACE_SAMPLE_RATE` env vars and `{ idFormat, sampleRate }` config keys replace global setters
- **Worker rewrite** — `workerTransportStage(postMessage)` replaces custom protocol
- **Plugin decomposition** — `withSpans()` extracted as composable plugin; `PluginCtx` for inter-plugin communication
- **Console.bind** — restores browser DevTools source locations
- **Error.cause** — serialized automatically (up to 3 levels)
- **Namespace-aware gating** — `DEBUG=myapp:db` enables debug only for matching namespaces
- **Removed** ambient metrics collector (side-effect import)
- **Deprecated** `setIdFormat()`, `setSampleRate()`, `spanStats()`, `spanSummary()`
- **Docs** — new domain loggily.dev, Destinations guide, OTEL/Metrics pages

## 0.7.0

- Pipeline-based config arrays
- Typed `ConfigElement` union
- `withEnvDefaults()` composable plugin
- Legacy API deprecation (setLogLevel, enableSpans, etc.)

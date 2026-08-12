# Changelog

## Unreleased

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

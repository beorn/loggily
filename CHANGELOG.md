# Changelog

All notable changes to Loggily will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.7.0] - 2026-04-12

### Added

- **Pipeline API** — `createLogger(name, config?)` with a polymorphic config array. Objects configure, arrays branch, values write.
- **New types**: `LogEvent`, `SpanEvent`, `Event`, `Stage`, `Pipeline`, `LoggerFactory`, `LoggerPlugin`
- **`buildPipeline()` / `defaultPipeline()`** exported for power users
- **`compose()`** for building custom `createLogger` with plugins
- **Config array discrimination**: object = config (`level`, `ns`, `format`, `file`), array = branch, function = stage, `console`/writable = output
- **Error method overloads**: `log.error(err, "msg", data?)` for Pino-style migration
- **Custom stages**: `(event: Event) => Event | null | void` for transform/filter pipelines

### Changed

- **`createLogger` signature**: second arg is now a config array, not a props object. Use `.child({ props })` instead of `createLogger(name, props)`.
- **Namespace filter**: use `ns` key (not `name`) in config objects
- **Default pipeline**: re-reads env vars dynamically on each dispatch so legacy setters (`setLogLevel`, `enableSpans`, etc.) still work

### Deprecated

- Legacy global setters (`setLogLevel`, `enableSpans`, `setDebugFilter`, `setTraceFilter`, `setLogFormat`, `setOutputMode`, `setSuppressConsole`, `addWriter`, `writeSpan`). They still work — level/format/ns/trace map to env vars, writers/suppress to runtime state — but will be removed in a future major version. Migrate to config arrays.

### Documentation

- Comprehensive API update across 17 doc files (guide, API reference, migration guides)
- Comparison page rewritten — factual compatibility statements, no negative comparisons
- Added `LogEvent`/`SpanEvent`/`Stage`/`Pipeline` type docs

## [0.5.0] - 2026-04-09

### Added

- **Metrics API** — `SpanRecorder`, `LazyProps`, ambient recording, `withMetrics()` for composable instrumentation alongside spans
- **Ecosystem glossary cross-linking** in docs — vitepress-enrich integration
- **SEO + social meta** — sitemap, robots.txt, OG image, JSON-LD schemas
- **Footer** — author info and ecosystem cross-links

### Documentation

- Navigation submenus for Guide and API
- Bjorn → Bjørn corrections, removed km references from public docs
- Switched OG image from SVG to PNG for social platform compatibility

## [0.4.0]–[0.4.2] — undocumented in this file

These versions shipped between 0.3.0 and 0.5.0 with incremental fixes and tracing improvements. See git log for details:

```bash
git log v0.3.0..v0.4.2 --oneline
```

## [0.3.0] - 2026-03-13

### Added

- **Lightweight tracing** -- W3C-compatible trace/span ID generation, `traceparent()` header formatting, head-based sampling
- `setIdFormat()` / `getIdFormat()` -- Switch between `"simple"` (sp_1, tr_1) and `"w3c"` (hex) ID formats
- `traceparent(spanData, options?)` -- Format W3C traceparent headers with configurable sampled flag
- `setSampleRate()` / `getSampleRate()` -- Head-based sampling for traces
- **Context propagation** -- `enableContextPropagation()` via AsyncLocalStorage (`loggily/context`)
- `getCurrentSpan()` / `runInSpanContext()` -- Access and scope span context
- Auto-tagging of log messages with `trace_id` and `span_id` when context propagation is active
- Vendored ANSI colors (replaced picocolors dependency) -- zero external dependencies

### Fixed

- Span collection API now correctly collects spans on disposal
- `formatConsole()` uses `safeStringify()` -- no longer throws on circular refs, bigint, or symbols
- `formatJSON()` uses shared `safeStringify()` -- handles bigint, symbols, and Error objects
- Worker span forwarding preserves original worker IDs and timing instead of creating new spans
- Worker `postMessage` failures send diagnostic fallback messages instead of silently dropping logs
- Worker console handlers use `safeStringify()` -- no longer throw on BigInt or circular refs
- `traceparent()` accepts `{ sampled }` option instead of always marking traces as sampled
- File writer preserves buffer on `writeSync` failure (buffer cleared only after successful write)
- `close()` always runs cleanup (closeSync + removeListener) even when flush throws
- Non-LIFO `end()` calls no longer corrupt AsyncLocalStorage context

### Changed

- `exitSpanContext()` now captures and restores exact previous context snapshots
- `writeSpan()` exported for internal cross-module use (worker span forwarding)
- Extracted duplicated console message formatting in worker handlers into shared helpers

## [0.2.0] - 2026-03-04

### Added

- **Lazy messages** -- Pass `() => string` functions that are only called when the level is enabled
- **Child context loggers** -- `log.child({ requestId: "abc" })` creates a logger with structured context fields in every message
- **LOG_FORMAT env var** -- `LOG_FORMAT=json` explicitly enables structured JSON output
- `setLogFormat()` / `getLogFormat()` -- Programmatic log format control
- `setDebugFilter()` / `getDebugFilter()` -- Programmatic namespace filtering (like `DEBUG` env var)
- **File writer** -- `createFileWriter(path, opts?)` for buffered file output with auto-flush
- **Writer system** -- `addWriter(fn)` to subscribe to all formatted log output
- `setOutputMode()` / `getOutputMode()` -- Control output destination (`console`, `stderr`, `writers-only`)
- `setSuppressConsole()` -- Suppress console output while writers still receive
- Comprehensive test suite (153 tests)

### Changed

- `createLogger()` now returns a `ConditionalLogger` directly (no separate function needed)
- Improved documentation with full API reference and comparison guides

## [0.1.0] - 2026-01-15

### Added

- Initial release
- `createLogger(name, props?)` -- Create structured logger
- Logger methods: `trace`, `debug`, `info`, `warn`, `error`
- Child loggers with `.logger(namespace, props?)`
- Span timing with `.span(namespace, props?)` and `using` keyword support
- `SpanData` with id, traceId, parentId, startTime, endTime, duration
- Custom span attributes via `span.spanData.key = value`
- Configuration via environment variables: `LOG_LEVEL`, `TRACE`, `TRACE_FORMAT`
- Programmatic configuration: `setLogLevel`, `getLogLevel`, `enableSpans`, `disableSpans`, `spansAreEnabled`
- `setTraceFilter()` / `getTraceFilter()` -- Namespace-based span output control
- Dual output format: pretty console (dev) and JSON (production)
- Worker thread support: `createWorkerLogger`, `createWorkerLogHandler`, `forwardConsole`
- Span collection for testing: `startCollecting`, `stopCollecting`, `getCollectedSpans`, `clearCollectedSpans`
- `resetIds()` for deterministic tests

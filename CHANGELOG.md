# Changelog

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

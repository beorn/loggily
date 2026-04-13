# Tracing

Import from `loggily` (main entry).

## ID Format

| Format     | Span ID        | Trace ID       | Use Case             |
| ---------- | -------------- | -------------- | -------------------- |
| `"simple"` | `sp_1`, `sp_2` | `tr_1`, `tr_2` | Development, testing |
| `"w3c"`    | 16-char hex    | 32-char hex    | Distributed tracing  |

### Via env var (recommended)

```bash
TRACE_ID_FORMAT=w3c bun run app
```

### Via config object

```typescript
const log = createLogger("myapp", [{ level: "debug", idFormat: "w3c" }, console])
const span = log.span("request")
// span.spanData.id    → "a1b2c3d4e5f6a7b8"
// span.spanData.traceId → "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6"
```

### Via setters (deprecated)

```typescript
// @deprecated — use TRACE_ID_FORMAT env var or { idFormat } config instead
function setIdFormat(format: IdFormat): void
function getIdFormat(): IdFormat

type IdFormat = "simple" | "w3c"
```

## traceparent

```typescript
function traceparent(spanData: SpanData, options?: TraceparentOptions): string

interface TraceparentOptions {
  /** Whether this span is sampled. Defaults to true. */
  sampled?: boolean
}
```

Format a [W3C traceparent](https://www.w3.org/TR/trace-context/#traceparent-header) header.

```typescript
const span = log.span("http-request")
const header = traceparent(span.spanData)
// → "00-a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6-1a2b3c4d5e6f7a8b-01"

fetch(url, { headers: { traceparent: header } })

// Mark as not sampled
traceparent(span.spanData, { sampled: false })
// → "00-...-...-00"
```

Works with both `"simple"` and `"w3c"` ID formats. Simple IDs are zero-padded to spec length.

## Sampling

Head-based sampling: the decision is made when a trace starts and inherited by all child spans.

- Rate must be between 0.0 and 1.0 (throws otherwise)
- Child spans always inherit the parent's sampling decision
- Unsampled spans still have valid `spanData` -- only output is suppressed

### Via env var (recommended)

```bash
TRACE_SAMPLE_RATE=0.1 bun run app   # Sample 10% of traces
```

### Via config object

```typescript
const log = createLogger("myapp", [{ level: "debug", sampleRate: 0.1 }, console])
```

### Via setters (deprecated)

```typescript
// @deprecated — use TRACE_SAMPLE_RATE env var or { sampleRate } config instead
function setSampleRate(rate: number): void
function getSampleRate(): number
```

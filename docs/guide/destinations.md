# Destinations

Loggily's pipeline sends events anywhere — no plugins needed. These are copy-paste recipes.

## OpenTelemetry (Jaeger, Grafana, Datadog)

Built-in via `loggily/otel`. Any OTLP-compatible backend works:

```typescript
import * as otelApi from "@opentelemetry/api"
import { toOtel } from "loggily/otel"

const log = createLogger("myapp", [
  toOtel({ api: otelApi }), // forwards logs + spans to OTLP
  console, // also prints to console
])
```

Datadog, Grafana, and Jaeger all accept OTLP natively.

## Sentry

Capture errors as Sentry exceptions:

```typescript
import * as Sentry from "@sentry/node"

const log = createLogger("myapp", [
  (event) => {
    if (event.kind === "log" && event.level === "error") {
      Sentry.captureException(event.props?.error ?? new Error(event.message))
    }
    return event
  },
  console,
])
```

## Pino Transports

Object-mode writable sinks are compatible with the Pino transport interface — Events are raw objects by default:

```typescript
import { pino } from "pino"

const pinoTransport = pino.transport({ target: "pino-pretty" })

const log = createLogger("myapp", [pinoTransport, console])
```

## Elasticsearch / OpenSearch

Post JSON events directly:

```typescript
const log = createLogger("myapp", [
  {
    write: (event) => {
      fetch("http://localhost:9200/logs/_doc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...event, "@timestamp": new Date(event.time).toISOString() }),
      })
    },
  },
  console,
])
```

## AWS CloudWatch

```typescript
import { CloudWatchLogsClient, PutLogEventsCommand } from "@aws-sdk/client-cloudwatch-logs"

const cw = new CloudWatchLogsClient({})

const log = createLogger("myapp", [
  {
    write: (event) => {
      cw.send(
        new PutLogEventsCommand({
          logGroupName: "/app/myapp",
          logStreamName: "main",
          logEvents: [{ timestamp: event.time, message: JSON.stringify(event) }],
        }),
      )
    },
  },
  console,
])
```

## Prometheus

Prometheus is pull-based — it scrapes a `/metrics` endpoint. Expose loggily's span metrics:

```typescript
import { createServer } from "node:http"

const log = createLogger("myapp", [{ metrics: true }, console])

createServer((req, res) => {
  if (req.url === "/metrics") {
    const lines: string[] = []
    for (const [name, s] of log.metrics.all()) {
      const safe = name.replace(/[^a-zA-Z0-9_]/g, "_")
      lines.push(`span_duration_p50{name="${name}"} ${s.p50}`)
      lines.push(`span_duration_p95{name="${name}"} ${s.p95}`)
      lines.push(`span_duration_p99{name="${name}"} ${s.p99}`)
      lines.push(`span_count{name="${name}"} ${s.count}`)
    }
    res.writeHead(200, { "Content-Type": "text/plain" })
    res.end(lines.join("\n"))
  }
}).listen(9090)
```

## File (JSON)

Built-in:

```typescript
const log = createLogger("myapp", [
  { file: "/var/log/app.log", format: "json" },
  [{ level: "error" }, { file: "/var/log/errors.log", format: "json" }],
  console,
])
```

## Webhooks / HTTP

```typescript
const log = createLogger("myapp", [
  {
    write: (event) => {
      if (event.kind === "log" && event.level === "error") {
        fetch("https://hooks.slack.com/services/...", {
          method: "POST",
          body: JSON.stringify({ text: `🚨 ${event.namespace}: ${event.message}` }),
        })
      }
    },
  },
  console,
])
```

## Multiple Destinations

Combine any of the above — they're just array elements:

```typescript
const log = createLogger("myapp", [
  toOtel({ api: otelApi }),                                    // OTLP backend
  pinoTransport,                                               // Pino transport
  { file: "/var/log/app.log", format: "json" },                // file
  (event) => { if (event.level === "error") Sentry.captureException(...); return event },
  console,
])
```

# Chapter 33 — Observability with @effect/opentelemetry

> **Package(s):** `@effect/opentelemetry`
> **Patterns introduced:** [`Effect.withSpan` / `annotateCurrentSpan` — distributed tracing](../../research/02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing), [`Metric.counter` / `gauge` / `histogram` / `summary`](../../research/02-patterns-catalog.md#metriccounter--gauge--histogram--summary), [`Logger.make` / `withMinimumLogLevel` and `Effect.log*` family](../../research/02-patterns-catalog.md#loggermake--withminimumloglevel-and-effectlog-family)
> **Reads from:** Chapter 23 (Platform on Node.js), Chapter 09 (Layer), Chapter 17 (Fibers and structured concurrency)
> **Reads into:** Chapter 45 (Part III overview — worked example uses telemetry for cache events)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Production TypeScript services need three observability signals: distributed traces to understand latency, metrics to track aggregate counts and distributions, and structured logs to record discrete events. Each has a standard ecosystem: OpenTelemetry for traces and metrics, JSON-structured logs for aggregators like Datadog or Loki.

The problem is wiring them together from plain async/await TypeScript. Each signal requires its own imperative setup code, and they do not compose cleanly:

```ts
import { NodeTracerProvider } from "@opentelemetry/sdk-trace-node"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { Counter, Registry } from "prom-client"
import { trace, context, SpanStatusCode } from "@opentelemetry/api"

// Tracing: provider must be initialised at startup, globally
const provider = new NodeTracerProvider()
provider.addSpanProcessor(
  new BatchSpanProcessor(new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" }))
)
provider.register()
const tracer = trace.getTracer("my-service")

// Metrics: registry maintained separately from tracing
const registry = new Registry()
const requestCounter = new Counter({ name: "http_requests_total", help: "..." })

// Handler: manual span lifecycle — easy to forget span.end()
async function handleRequest(userId: string): Promise<void> {
  const span = tracer.startSpan("handleRequest")
  const ctx = trace.setSpan(context.active(), span)
  try {
    requestCounter.inc()
    // To call a sub-function and have it inherit the span, you must
    // thread `ctx` through manually or use context.with()
    await context.with(ctx, () => loadUser(userId))
    span.setStatus({ code: SpanStatusCode.OK })
  } catch (err) {
    span.recordException(err as Error)
    span.setStatus({ code: SpanStatusCode.ERROR })
    throw err
  } finally {
    span.end() // Forgetting this leaks the span
  }
  // Log the event — a third system, unrelated to spans or metrics
  console.log(JSON.stringify({ event: "request.handled", userId }))
}
```

Four pain points stand out:

1. **Span context does not propagate automatically across `async/await` boundaries.** You must explicitly thread `context.with(ctx, ...)` into every async call. Miss one call site and the child span loses its parent in the trace view.

2. **The span lifecycle is error-prone.** `span.end()` must be called in a `finally` block on every code path including exceptions. Forgotten `span.end()` calls produce orphan spans that never appear in your trace backend.

3. **Metrics and traces live in separate registries.** There is no way to correlate a high counter value with a specific trace — you must rely on timestamps and manual label matching.

4. **Structured logging is a third wheel.** `console.log` has no trace context, no log level filter, and is impossible to swap out in tests without monkey-patching. Integrating a logger that attaches `traceId` and `spanId` automatically requires yet another library and more manual threading.

`@effect/opentelemetry` solves all four problems by sitting Effect's own tracing (`Effect.withSpan`), metrics (`Metric.*`), and logging (`Effect.log*`) on top of the OpenTelemetry SDK. You keep writing idiomatic Effect code; the adapter exports OTLP-compatible signals to your backend of choice. No global mutable state, no manual `span.end()`, no context threading.

---

## The minimal example

Wire `NodeSdk.layer` and use `Effect.withSpan` on a generator-based effect. This is the complete, runnable starting point — 25 lines including imports:

```ts
import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { Effect } from "effect"

// 1. SDK layer: a single call composes Resource + Tracer + Metrics + Logger
const ObservabilityLive = NodeSdk.layer(() => ({
  resource: { serviceName: "my-service", serviceVersion: "1.0.0" },
  spanProcessor: new BatchSpanProcessor(
    new OTLPTraceExporter({ url: "http://localhost:4318/v1/traces" })
  )
}))

// 2. Business logic: Effect.withSpan wraps any Effect in a named span.
//    The span starts when the effect begins and ends when it settles.
const program = Effect.gen(function* () {
  yield* Effect.annotateCurrentSpan({ userId: "u-42" }) // attach metadata
  yield* Effect.logInfo("handling request")              // span ID attached automatically
  yield* Effect.sleep("100 millis")
  return "done"
}).pipe(Effect.withSpan("handleRequest"))

// 3. Provide the SDK layer at the program boundary.
Effect.runPromise(
  program.pipe(Effect.provide(ObservabilityLive))
)
```

`NodeSdk.layer` is at `repos/effect/packages/opentelemetry/src/NodeSdk.ts:76-119`. It accepts a lazy `Configuration` object and wraps the provider lifecycle — init, flush, shutdown — inside `Effect.acquireRelease` (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:53-69`).

---

## Tour

`@effect/opentelemetry` introduces three patterns from the core `effect` package and exposes them through the OpenTelemetry wire protocol. The patterns are defined in `effect` itself — `@effect/opentelemetry` provides the adapters and Layer constructors that connect them to the OTLP exporter.

### Pattern 1 — Tracing: `Effect.withSpan` and `annotateCurrentSpan`

`Effect.withSpan` is defined at `repos/effect/packages/effect/src/Effect.ts:13105-13115`. Its signature:

```ts
// repos/effect/packages/effect/src/Effect.ts:13105-13115
export const withSpan: {
  (
    name: string,
    options?: Tracer.SpanOptions | undefined
  ): <A, E, R>(self: Effect<A, E, R>) => Effect<A, E, Exclude<R, Tracer.ParentSpan>>
  <A, E, R>(
    self: Effect<A, E, R>,
    name: string,
    options?: Tracer.SpanOptions | undefined
  ): Effect<A, E, Exclude<R, Tracer.ParentSpan>>
}
```

Wrapping an effect with `Effect.withSpan("name")` creates a span that:

- **Starts** when the Effect begins executing on a fiber.
- **Ends** when the Effect settles (success, failure, or interruption).
- **Records errors** automatically from the Effect error channel — both expected typed failures and unexpected defects.
- **Propagates** to child fibers. Spans are stored in the fiber's `FiberRef` context. When you `yield* Effect.fork(child)`, the child fiber inherits the current span as its parent. This is the structural concurrency from Chapter 17 applied to tracing — span nesting mirrors fiber nesting.

`annotateCurrentSpan` is at `repos/effect/packages/effect/src/Effect.ts:12990-12993`:

```ts
// repos/effect/packages/effect/src/Effect.ts:12990-12993
export const annotateCurrentSpan: {
  (key: string, value: unknown): Effect<void>
  (values: Record<string, unknown>): Effect<void>
}
```

Call it inside a `withSpan` block to attach key-value attributes to the live span. These attributes appear in Jaeger, Honeycomb, Datadog APM, and any other OTLP-compatible viewer.

The **adapter** that connects these Effect abstractions to the OTel SDK lives in `repos/effect/packages/opentelemetry/src/Tracer.ts`. The `Tracer.layer` export (`repos/effect/packages/opentelemetry/src/Tracer.ts:56`) installs an OTel-backed Effect `Tracer` into the fiber context. Once installed, every `Effect.withSpan` call creates a real OTel span under the hood. `Tracer.withSpanContext` (`repos/effect/packages/opentelemetry/src/Tracer.ts:141-151`) maps an incoming `SpanContext` from an HTTP header to an Effect `ExternalSpan`, enabling cross-process propagation without leaving the Effect API.

`NodeSdk.layer` is the canonical way to install the tracer in Node.js applications. It wraps `layerTracerProvider` (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:42-70`), which acquires a `NodeTracerProvider` on startup and flushes + shuts it down with a configurable timeout on release. For the browser, `WebSdk.layer` provides identical semantics using `WebTracerProvider` (`repos/effect/packages/opentelemetry/src/WebSdk.ts:67-101`).

`Resource.layerFromEnv` reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` from the environment via `Config.string` (`repos/effect/packages/opentelemetry/src/Resource.ts:69-102`), making resource identity configurable without code changes. `Resource.layer` accepts a plain object when you want static resource attributes (`repos/effect/packages/opentelemetry/src/Resource.ts:32-40`).

### Pattern 2 — Metrics: `Metric.counter`, `gauge`, `histogram`, `summary`

The four metric constructors are defined in `repos/effect/packages/effect/src/Metric.ts`:

```ts
// repos/effect/packages/effect/src/Metric.ts:186-203  — counter
export const counter: {
  (name: string, options?: { description?: string; incremental?: boolean }): Metric.Counter<number>
  // bigint overload omitted
}

// repos/effect/packages/effect/src/Metric.ts:276-280  — gauge
export const gauge: {
  (name: string, options?: { description?: string }): Metric.Gauge<number>
}

// repos/effect/packages/effect/src/Metric.ts:304-308  — histogram
export const histogram: (
  name: string,
  boundaries: MetricBoundaries,
  description?: string
) => Metric.Histogram

// repos/effect/packages/effect/src/Metric.ts:429-434  — summary
export const summary: (options: {
  name: string; maxAge: DurationInput; maxSize: number
  error: number; quantiles: ReadonlyArray<number>
}) => Metric.Summary
```

The four types cover the four standard use cases:

- `Metric.counter` — monotonically increasing event count (requests, errors, retries).
- `Metric.gauge` — current level that can go up or down (active connections, queue depth).
- `Metric.histogram` — latency distribution bucketed by predefined boundaries. Use `Metric.trackDuration(histogram)` on an Effect to record its wall-clock time.
- `Metric.summary` — quantile estimation (p50, p99) over a sliding time window.

Labels work via `Metric.tagged` and `Metric.taggedWith`:

```ts
import { Metric, Effect } from "effect"

const requestCount = Metric.counter("http_requests_total", {
  description: "Total HTTP requests by route and status"
})

// Attach labels at the call site
const trackRequest = (route: string, status: number) =>
  Metric.increment(
    requestCount.pipe(Metric.tagged("route", route), Metric.tagged("status_code", String(status)))
  )
```

**Exporting metrics to OTel** is done by `Metrics.layer` at `repos/effect/packages/opentelemetry/src/Metrics.ts:33-41`. It accepts a `MetricReader` (Prometheus, OTLP HTTP, in-memory for tests) and registers a `MetricProducer` with it. On each OTel collection cycle, the producer calls `Metric.unsafeSnapshot()` synchronously and translates all accumulated Effect metric keys — Counter, Gauge, Histogram, Summary, Frequency — to OTel `DataPoint`s. The translation logic lives at `repos/effect/packages/opentelemetry/src/internal/metrics.ts:47-250`.

When you pass `metricReader` to `NodeSdk.layer`, `Metrics.layer` is composed in automatically. Passing a `PrometheusExporter` gives you a Prometheus scrape endpoint; passing `OTLPMetricExporter` exports to Tempo, Mimir, or any OTLP-capable backend.

### Pattern 3 — Logging: `Logger.make`, `withMinimumLogLevel`, and `Effect.log*`

The `Effect.log*` family is the recommended way to emit log records from Effect code. The functions are defined at `repos/effect/packages/effect/src/Effect.ts:10937-10980`:

```ts
// repos/effect/packages/effect/src/Effect.ts:10937-10980
export const log: (...message: ReadonlyArray<any>) => Effect<void>
export const logDebug: (...message: ReadonlyArray<any>) => Effect<void>
export const logInfo: (...message: ReadonlyArray<any>) => Effect<void>
export const logWarning: (...message: ReadonlyArray<any>) => Effect<void>
export const logError: (...message: ReadonlyArray<any>) => Effect<void>
```

Every call to `Effect.logInfo` and its siblings automatically attaches the current fiber ID, the active span ID and trace ID (if `withSpan` is in the call stack), and any annotations set with `Effect.annotateLogs`. This context is derived from the fiber's `FiberRef` — no manual threading needed. Child fibers inherit log annotations just as they inherit spans.

`Logger.make` is defined at `repos/effect/packages/effect/src/Logger.ts:110-111`. It constructs a custom logger from a function `(options: Logger.Options<Message>) => Output`. The `options` object carries the message, log level, date, fiber ID, span context, and all annotations. You use `Logger.make` when you need to forward logs to a JSON aggregator with a custom shape.

`Logger.withMinimumLogLevel` is at `repos/effect/packages/effect/src/Logger.ts:363-366`. Use it to suppress debug output in production or in tests:

```ts
import { Logger, LogLevel, Effect } from "effect"

const program = Effect.gen(function* () {
  yield* Effect.logDebug("verbose detail")  // suppressed below
  yield* Effect.logInfo("request handled")  // emitted
}).pipe(Logger.withMinimumLogLevel(LogLevel.Info))
```

**Exporting logs to OTel** is done by `Logger.layerLoggerAdd` from `repos/effect/packages/opentelemetry/src/Logger.ts:81-85`. It calls `Logger.addEffect(Logger.make(...))` which adds the OTel logger alongside the default logger without replacing it. `Logger.layerLoggerReplace` (`repos/effect/packages/opentelemetry/src/Logger.ts:91-95`) swaps the default logger out entirely.

The OTel logger `make` at `repos/effect/packages/opentelemetry/src/Logger.ts:32-75` constructs an Effect `Logger<unknown, void>` that emits OTel log records with `fiberId`, `spanId`, `traceId`, and all annotations as OTel attributes. When `NodeSdk.layer` receives a `logRecordProcessor`, it composes `Logger.layerLoggerAdd` into the returned layer automatically.

---

## A production example

A Node.js HTTP service instrumented end-to-end. `NodeSdk.layer` delivers traces to Honeycomb via OTLP, exports metrics, and ships structured logs alongside the default console logger. The observability layer is injected at `Effect.runFork` — the business logic never imports from `@effect/opentelemetry` directly.

```ts
import * as NodeSdk from "@effect/opentelemetry/NodeSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { OTLPMetricExporter } from "@opentelemetry/exporter-metrics-otlp-http"
import { OTLPLogExporter } from "@opentelemetry/exporter-logs-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"
import { PeriodicExportingMetricReader } from "@opentelemetry/sdk-metrics"
import { BatchLogRecordProcessor } from "@opentelemetry/sdk-logs"
import { Config, Effect, Layer, Metric, Duration } from "effect"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { HttpRouter, HttpServer, HttpServerResponse } from "@effect/platform"

// --- Metrics defined at module scope (shared across all fibers) ---

const httpRequestsTotal = Metric.counter("http_requests_total", {
  description: "Total HTTP requests handled"
})

const httpDuration = Metric.histogram(
  "http_request_duration_ms",
  Metric.linearBoundaries({ start: 0, width: 25, count: 20 }),
  "HTTP handler latency in milliseconds"
)

const activeRequests = Metric.gauge("http_active_requests", {
  description: "Requests currently in flight"
})

// --- Request handler ---

const handleHealth = Effect.succeed(
  HttpServerResponse.json({ status: "ok" })
).pipe(
  Metric.trackDuration(httpDuration),
  Metric.increment(httpRequestsTotal),
  Effect.withSpan("GET /health")
)

const handleUser = (userId: string) =>
  Effect.gen(function* () {
    yield* Effect.annotateCurrentSpan({ "user.id": userId })
    yield* Effect.logInfo("fetching user", { userId })
    // Simulate DB query
    yield* Effect.sleep("50 millis")
    return HttpServerResponse.json({ id: userId, name: "Alice" })
  }).pipe(
    Metric.trackDuration(httpDuration),
    Metric.increment(httpRequestsTotal.pipe(
      Metric.tagged("route", "/users/:id")
    )),
    Effect.withSpan("GET /users/:id")
  )

// --- Router and server ---

const router = HttpRouter.empty.pipe(
  HttpRouter.get("/health", handleHealth),
  HttpRouter.get("/users/:id", (req) =>
    handleUser(req.params.id)
  )
)

const HttpServerLive = NodeHttpServer.listen({ port: 3000 }).pipe(
  Layer.provide(HttpServer.serve(router))
)

// --- Observability layer built from environment config ---

const ObservabilityLive = NodeSdk.layer(
  Effect.gen(function* () {
    const endpoint = yield* Config.withDefault(
      Config.string("OTEL_EXPORTER_OTLP_ENDPOINT"),
      "http://localhost:4318"
    )
    const serviceName = yield* Config.withDefault(
      Config.string("OTEL_SERVICE_NAME"),
      "user-service"
    )
    return {
      resource: { serviceName, serviceVersion: "1.2.0" },
      spanProcessor: new BatchSpanProcessor(
        new OTLPTraceExporter({ url: `${endpoint}/v1/traces` })
      ),
      metricReader: new PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${endpoint}/v1/metrics` }),
        exportIntervalMillis: Duration.toMillis("30 seconds")
      }),
      logRecordProcessor: new BatchLogRecordProcessor(
        new OTLPLogExporter({ url: `${endpoint}/v1/logs` })
      )
    }
  })
)

// --- Entry point ---

const MainLayer = HttpServerLive.pipe(
  Layer.provide(ObservabilityLive)
)

NodeRuntime.runMain(Layer.launch(MainLayer))
```

Key points illustrated by this example:

- `NodeSdk.layer` accepts an `Effect<Configuration>` as well as a plain lazy thunk. When passed an `Effect`, it reads `Config.string("OTEL_SERVICE_NAME")` at startup — the Layer composition from Chapter 09 applies to observability configuration exactly as it does to database connections.
- Three signals — traces, metrics, logs — are wired in a single `NodeSdk.layer` call. The `Configuration` interface at `repos/effect/packages/opentelemetry/src/NodeSdk.ts:24-36` accepts `spanProcessor`, `metricReader`, and `logRecordProcessor` independently. Any field you omit means the corresponding sub-layer is not registered.
- `Metric.tagged` attaches labels at the call site without creating a new metric registration. The same counter definition carries multiple label sets.
- The `HttpServerLive` layer from Chapter 23 (platform-node) composes with `ObservabilityLive` via `Layer.provide`. Business logic and observability are separate concerns composed at the boundary.

---

## Variations

**WebSdk for browser applications.** Use `WebSdk.layer` instead of `NodeSdk.layer`. The API is identical except `resource` is required (not optional) and the tracer provider is `WebTracerProvider`. Cited at `repos/effect/packages/opentelemetry/src/WebSdk.ts:67-101`.

```ts
import * as WebSdk from "@effect/opentelemetry/WebSdk"
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http"
import { BatchSpanProcessor } from "@opentelemetry/sdk-trace-base"

const BrowserObservability = WebSdk.layer(() => ({
  resource: { serviceName: "my-spa" },
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter())
}))
```

**Lightweight OTLP path without the OTel SDK.** Use `Otlp.layerJson` when you want to avoid pulling in the full `@opentelemetry/sdk-*` set of packages. It posts over `@effect/platform`'s `HttpClient` in JSON. Requires a `FetchHttpClient.layer` or `NodeHttpClient.layer` from Chapter 23.

```ts
import * as Otlp from "@effect/opentelemetry/Otlp"
import { FetchHttpClient } from "@effect/platform"

const Observability = Otlp.layerJson({
  baseUrl: "http://localhost:4318",
  resource: { serviceName: "my-service" }
}).pipe(Layer.provide(FetchHttpClient.layer))
```

**Suppress debug logs in production.** `Logger.withMinimumLogLevel` from core filters out log records below a threshold. Apply it to the entire program layer.

```ts
import { Logger, LogLevel } from "effect"

const ProductionProgram = program.pipe(
  Logger.withMinimumLogLevel(LogLevel.Info)
)
```

**Custom resource attributes.** Pass `attributes` alongside `serviceName` in the `resource` config to attach deployment-specific metadata (region, environment, pod name) to every span and log.

```ts
NodeSdk.layer(() => ({
  resource: {
    serviceName: "api",
    serviceVersion: "2.0.0",
    attributes: {
      "deployment.environment": "production",
      "cloud.region": "us-east-1"
    }
  },
  spanProcessor: new SimpleSpanProcessor(new ConsoleSpanExporter())
}))
```

**Read service identity entirely from environment variables.** When `resource` is omitted from `NodeSdk.layer`, the underlying `Resource.layerFromEnv` reads `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` via `Config.string`. This is the zero-code-change path for twelve-factor apps (`repos/effect/packages/opentelemetry/src/Resource.ts:69-102`).

```ts
NodeSdk.layer(() => ({
  // No `resource` field — NodeSdk falls back to Resource.layerFromEnv
  spanProcessor: new BatchSpanProcessor(new OTLPTraceExporter())
}))
```

**Prometheus scrape endpoint instead of OTLP push.** Replace `OTLPMetricExporter` with `PrometheusExporter` from `@opentelemetry/exporter-prometheus`. `Metrics.layer` works with any `MetricReader` implementation.

```ts
import { PrometheusExporter } from "@opentelemetry/exporter-prometheus"

NodeSdk.layer(() => ({
  resource: { serviceName: "api" },
  metricReader: new PrometheusExporter({ port: 9464 })
}))
```

---

## Anti-patterns

**Using `console.log` inside Effects.**

```ts
// Wrong: bypasses log level, loses span context, untestable
const handleRequest = Effect.gen(function* () {
  console.log("handling request for", userId) // no traceId, no level filter
  // ...
})

// Correct: Effect.logInfo carries fiber ID, spanId, and annotations automatically
const handleRequest = Effect.gen(function* () {
  yield* Effect.logInfo("handling request", { userId })
  // ...
})
```

**Manual span creation outside Effect — span context does not propagate.**

```ts
// Wrong: the manually created span is NOT the parent for any Effect.withSpan
// calls inside doWork. The Effect fiber context is separate from the global
// OpenTelemetry context storage.
const tracer = trace.getTracer("my-service")
const span = tracer.startSpan("outer")
try {
  await Effect.runPromise(doWork())
} finally {
  span.end()
}

// Correct: use Effect.withSpan at the outer boundary so the span lives in the
// fiber context and child spans nest correctly.
await Effect.runPromise(
  doWork().pipe(
    Effect.withSpan("outer"),
    Effect.provide(ObservabilityLive)
  )
)
```

**Registering metrics inside a generator that runs multiple times.**

```ts
// Wrong: a new Metric.counter("requests") object is created on every
// request. Each object is a distinct registration key in the metric registry,
// producing unbounded metric registrations.
const handler = Effect.gen(function* () {
  const counter = Metric.counter("requests") // created fresh every time!
  yield* Metric.increment(counter)
})

// Correct: define metric values at module scope. Metric objects are
// referentially transparent — the same name + label set always refers to
// the same internal accumulator.
const requestCounter = Metric.counter("requests") // defined once

const handler = Effect.gen(function* () {
  yield* Metric.increment(requestCounter)
})
```

**Confusing `Logger.layer` (the @effect/opentelemetry export) with `Logger.make` (the core export).** `Logger.make` from `effect/Logger` builds a custom logger value. `Logger.layerLoggerAdd` and `Logger.layerLoggerReplace` from `@effect/opentelemetry/Logger` are Layer constructors that install an OTel-wired logger into the Effect runtime. You always use the OTel package's Layer constructors to wire the logger into your application; `Logger.make` is for building custom logger implementations that output to your own target.

---

## See also

- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md): Spans are stored in `FiberRef` and are inherited by child fibers exactly as other fiber-local state is. Understanding `Effect.fork` propagation explains why span nesting mirrors fiber nesting without manual context threading.
- [Chapter 09 — Layer: building, merging, and providing services](../part-1-foundations/09-layer.md): `NodeSdk.layer` and `WebSdk.layer` are `Layer` values. The `Layer.mergeAll` + `Layer.provideMerge` pattern used inside `NodeSdk.layer` (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:114-116`) is the same composition pattern introduced in Chapter 09.
- [Chapter 23 — Platform on Node.js — HTTP server, file system, and subprocess](23-platform-node.md): The production example in this chapter composes `NodeHttpServer` from Chapter 23 with `NodeSdk.layer`. Tracing HTTP handlers and exporting to Honeycomb or Tempo requires both packages.
- [Part III — Chapter 55 (Streams of cache events — eviction and hit/miss telemetry)](../../book/part-3-authoring/55-cache-events-stream.md): The `effect-cache` worked example uses `Metric.counter` and `Effect.withSpan` to instrument cache hits, misses, and evictions. Reading this chapter after Part III shows the patterns in the context of a complete library.
- [Patterns catalog — `Effect.withSpan` / `annotateCurrentSpan` — distributed tracing](../../research/02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing): Full signature and when-to-use guidance for the tracing pattern introduced in this chapter.
- [Patterns catalog — `Metric.counter` / `gauge` / `histogram` / `summary`](../../research/02-patterns-catalog.md#metriccounter--gauge--histogram--summary): Full signature and when-to-use guidance for the metrics pattern introduced in this chapter.
- [Patterns catalog — `Logger.make` / `withMinimumLogLevel` and `Effect.log*` family](../../research/02-patterns-catalog.md#loggermake--withminimumloglevel-and-effectlog-family): Full signature and when-to-use guidance for the logging pattern introduced in this chapter.
- [Per-package research note — @effect/opentelemetry](../../research/packages/opentelemetry.md): Covers the lightweight OTLP path (`Otlp`, `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`), the bidirectional span wrapper design, and open questions about context propagation and `Metric.unsafeSnapshot()` concurrency safety.

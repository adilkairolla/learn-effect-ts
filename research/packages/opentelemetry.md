# @effect/opentelemetry

> Source: `repos/effect/packages/opentelemetry/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: tooling
> Effect deps: `effect`, `@effect/platform`

## What it does

`@effect/opentelemetry` bridges Effect's built-in observability primitives (`Tracer`, `Logger`, `Metric`) to the OpenTelemetry ecosystem. Developers who already use `Effect.withSpan`, `Effect.log*`, and `Metric.counter` get OTLP-compatible export without replacing those primitives — the alternative would be abandoning Effect's native tracing or writing a custom serialisation layer. The package ships two integration styles: an SDK mode (`NodeSdk`, `WebSdk`) that delegates to the official OTel SDK, and a lightweight OTLP mode (`Otlp`, `OtlpTracer`, `OtlpLogger`, `OtlpMetrics`) that bypasses the OTel SDK and posts over HTTP using `@effect/platform`'s `HttpClient`.

## Public API surface

**SDK path** — delegates to `@opentelemetry/sdk-*` peer packages:

- **`NodeSdk`** / **`WebSdk`** (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:76-119`, `repos/effect/packages/opentelemetry/src/WebSdk.ts:67-101`) — top-level entrypoints. A single `layer(Configuration)` call composes `Resource`, `Tracer`, `Metrics`, and `Logger` sub-layers via `Layer.unwrapEffect`. `NodeSdk` uses `NodeTracerProvider`; `WebSdk` uses `WebTracerProvider` and requires `resource`.
- **`Tracer`** (`repos/effect/packages/opentelemetry/src/Tracer.ts:1-151`) — core adapter. `layer` / `layerGlobal` install the OTel tracer; `makeExternalSpan` converts a `SpanContext` to an `ExternalSpan`; `currentOtelSpan` returns the live `OtelApi.Span` regardless of integration path; `withSpanContext` grafts an incoming `SpanContext` as the Effect parent.
- **`Resource`** (`repos/effect/packages/opentelemetry/src/Resource.ts:1-111`) — `layer` (from plain config) and `layerFromEnv` (reads `OTEL_SERVICE_NAME` / `OTEL_RESOURCE_ATTRIBUTES` via `Config`). Auto-detects Node vs browser to set `telemetry.sdk.language`.
- **`Metrics`** (`repos/effect/packages/opentelemetry/src/Metrics.ts:1-40`) — exposes `makeProducer` / `registerProducer` / `layer`. On each OTel collection cycle the `MetricProducer` calls `Metric.unsafeSnapshot()` and translates all key types to OTel `DataPoint`s.
- **`Logger`** (`repos/effect/packages/opentelemetry/src/Logger.ts:1-127`) — `make` produces a `Logger<unknown, void>` that emits OTel log records with `fiberId`, `spanId`, `traceId`, and all annotations. `layerLoggerAdd` appends alongside the default logger; `layerLoggerReplace` swaps it in.

**Lightweight OTLP path** — requires only `@effect/platform`, no OTel SDK:

- **`Otlp`** (`repos/effect/packages/opentelemetry/src/Otlp.ts:23-70`) — facade merging `OtlpTracer`, `OtlpLogger`, and `OtlpMetrics` from a single `baseUrl`. `layerJson` / `layerProtobuf` pre-wire serialisation.
- **`OtlpTracer`** / **`OtlpLogger`** / **`OtlpMetrics`** (`repos/effect/packages/opentelemetry/src/OtlpTracer.ts:112-125`) — each builds an Effect-native span/logger/metric exporter that batches data and POSTs over `HttpClient`.
- **`OtlpSerialization`** (`repos/effect/packages/opentelemetry/src/OtlpSerialization.ts:18-64`) — `Context.Tag` service with `layerJson` and `layerProtobuf` implementations, enabling tree-shaking of the Protobuf encoder.
- **`OtlpResource`** (`repos/effect/packages/opentelemetry/src/OtlpResource.ts:27-54`) — pure-data resource model for the lightweight path; `entriesToAttributes` and `unknownToAttributeValue` map Effect values to OTel wire types.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — every provider lifecycle (tracer, logger, metrics) is modelled as a `Layer.scoped` with `Effect.acquireRelease`, e.g. `repos/effect/packages/opentelemetry/src/NodeSdk.ts:46-70`.

- [Layer.merge / provide / fresh — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `NodeSdk.layer` / `WebSdk.layer` merge sub-layers with `Layer.mergeAll` and `Layer.provideMerge` to produce a single composite layer from `Configuration`, e.g. `repos/effect/packages/opentelemetry/src/NodeSdk.ts:114-116`.

- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — OTel providers are acquired with `new NodeTracerProvider(...)` and released with `provider.forceFlush().then(() => provider.shutdown())`, giving the Effect runtime control over provider lifecycle (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:53-69`).

- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `OtelTracerProvider`, `OtelTracer`, `OtelTraceFlags`, `OtelTraceState` are all opaque `GenericTag`s; `OtlpSerialization` and `OtelLoggerProvider` use the `Context.Tag` class syntax (`repos/effect/packages/opentelemetry/src/Tracer.ts:80-130`, `repos/effect/packages/opentelemetry/src/OtlpSerialization.ts:18`).

- [Logger.make / withMinimumLogLevel and Effect.log* family](../02-patterns-catalog.md#loggermake--withminimumloglevel-and-effectlog-family) — `Logger.make` builds the OTel log record emitter from Effect's `LoggerOptions`; `Logger.addEffect` / `Logger.replaceEffect` insert it into the runtime (`repos/effect/packages/opentelemetry/src/Logger.ts:36-85`).

- [Metric.counter / gauge / histogram / summary](../02-patterns-catalog.md#metriccounter--gauge--histogram--summary) — `MetricProducerImpl.collect` calls `Metric.unsafeSnapshot()` and translates every Effect metric key type (Counter, Gauge, Histogram, Frequency, Summary) to the corresponding OTel `DataPointType` (`repos/effect/packages/opentelemetry/src/internal/metrics.ts:47-250`).

- [Effect.withSpan / annotateCurrentSpan — distributed tracing](../02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing) — `Tracer.withSpanContext` maps an incoming OTel `SpanContext` to an Effect `ExternalSpan` via `Effect.withParentSpan`, allowing inter-process propagation (`repos/effect/packages/opentelemetry/src/internal/tracer.ts:436-448`).

- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `Resource.layerFromEnv` and `OtlpResource.fromConfig` both read `OTEL_SERVICE_NAME` and `OTEL_RESOURCE_ATTRIBUTES` via `Config.string` / `Config.option`, keeping resource identity configurable without code changes (`repos/effect/packages/opentelemetry/src/Resource.ts:75-102`, `repos/effect/packages/opentelemetry/src/OtlpResource.ts:66-98`).

## What's unique about this package's design

Most OTel integrations replace the runtime's tracing mechanism with OTel's imperative API. Effect does the reverse: the OTel adapter sits on top of Effect's own `Tracer` protocol. `OtelSpan` in `repos/effect/packages/opentelemetry/src/internal/tracer.ts:42-157` is an `effect/Tracer.Span` that wraps an `OtelApi.Span`; when Effect calls `span.end(endTime, exit)`, the adapter translates the `Exit` to OTel status codes. The reverse direction — letting non-Effect OTel code write to an Effect span — is `makeOtelSpan` at `repos/effect/packages/opentelemetry/src/internal/tracer.ts:241-321`, which presents any `effect/Tracer.Span` as an `OtelApi.Span` facade. This bidirectionality is what makes `Tracer.currentOtelSpan` (`repos/effect/packages/opentelemetry/src/Tracer.ts:44`) work regardless of which integration path was chosen.

The lightweight OTLP path (`OtlpTracer` / `OtlpLogger` / `OtlpMetrics`) implements the OTLP wire format directly in TypeScript and POSTs over `@effect/platform`'s `HttpClient`, avoiding the full OTel SDK. The `OtlpSerialization` service (`repos/effect/packages/opentelemetry/src/OtlpSerialization.ts:18-34`) abstracts encoding so the Protobuf encoder is tree-shaken out when only JSON is used.

## Conventions observed

Standard Effect conventions apply; notable specifics:

- **`peerDependencies` for OTel SDK.** All `@opentelemetry/sdk-*` packages are peers (`repos/effect/packages/opentelemetry/package.json:56-66`), so users can upgrade the OTel SDK independently.
- **Timed shutdown via `Effect.acquireRelease`.** Providers flush and shut down with a configurable timeout (default 3000 ms) wrapped in `Effect.ignoreLogged` + `Effect.timeoutOption` (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:62-69`).
- **`Layer.unwrapEffect` for dynamic configuration.** Both `NodeSdk.layer` and `WebSdk.layer` accept `LazyArg<Configuration>` or `Effect<Configuration>`, so configuration can itself depend on services (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:76-119`).
- **`OtelSpan` stays internal.** The public `Tracer.ts` re-exports opaque tags and delegates to `src/internal/tracer.ts`; callers only see the `effect/Tracer.Span` interface.

## "If you were authoring something similar, copy this"

- **Bidirectional span wrapper.** Bridge both directions: `OtelSpan` wraps `OtelApi.Span` as `effect/Tracer.Span`; `makeOtelSpan` does the reverse so `currentOtelSpan` works on either integration path (`repos/effect/packages/opentelemetry/src/internal/tracer.ts:241-352`).

- **`OtlpSerialization` as a tree-shakable codec service.** Expose a `Context.Tag` with two `Layer` implementations rather than a hard-coded serialiser; bundlers tree-shake whichever is unused (`repos/effect/packages/opentelemetry/src/OtlpSerialization.ts:18-64`).

- **Pull adapter via `unsafeSnapshot()`.** `Metric.unsafeSnapshot()` is synchronous; OTel's `MetricReader` uses async `collect()`. The adapter wraps the call in `Promise.resolve()` — no background polling needed (`repos/effect/packages/opentelemetry/src/internal/metrics.ts:47-251`).

- **`isNonEmpty` guard before wiring sub-layers.** `NodeSdk.layer` skips tracer, metrics, or logger sub-layers when the corresponding processor is absent — a config with only `spanProcessor` doesn't register empty providers (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:90-113`).

## Open questions

- **Context propagation in the OTLP path.** `OtlpTracer.layer` accepts an optional `context` callback (`repos/effect/packages/opentelemetry/src/OtlpTracer.ts:97-104`) but provides no built-in W3C `traceparent` header injection/extraction for outbound `HttpClient` requests. Is the expectation that users wire their own propagator middleware on top, or is that functionality planned?

- **`Metric.unsafeSnapshot()` concurrency safety.** The metrics adapter calls `Metric.unsafeSnapshot()` synchronously inside an async Promise. If the Effect runtime mutates metric state between the snapshot call and OTel's aggregation, data races could produce incorrect cumulative counts. Is there a guarantee that snapshot is atomic with respect to concurrent fiber updates?

- **No `layerLoggerReplace` equivalent in `OtlpLogger`.** `Logger.ts` (SDK path) exports both `layerLoggerAdd` and `layerLoggerReplace`, but `OtlpLogger.ts` (lightweight path) only has `layer`. Is the omission intentional, or is `layerLoggerReplace` planned for the OTLP path?

- **`WebSdk` has no `shutdownTimeout` on the tracer provider release.** Unlike `NodeSdk.layerTracerProvider` (`repos/effect/packages/opentelemetry/src/NodeSdk.ts:62-69`), `WebSdk.layerTracerProvider` does not apply a timeout to the flush/shutdown promise (`repos/effect/packages/opentelemetry/src/WebSdk.ts:56-60`). This seems like an unintentional divergence.

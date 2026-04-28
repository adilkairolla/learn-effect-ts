# @effect/ai-openrouter

> Source: `repos/effect/packages/ai/openrouter/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `@effect/ai`, `@effect/experimental`, `@effect/platform`, `effect`

## What it does

`@effect/ai-openrouter` connects the `@effect/ai` `LanguageModel` abstraction to [OpenRouter](https://openrouter.ai) — an HTTP aggregator that exposes 200+ upstream models (GPT, Claude, Gemini, Llama, etc.) behind a single OpenAI-compatible `/chat/completions` endpoint. Application code already targeting `LanguageModel.LanguageModel` can swap in this package and gain access to every model OpenRouter supports without changing business logic. Without it, teams would hand-roll HTTP calls, parse SSE frames, map finish reasons, and thread `Redacted` API keys through their own middleware.

The package does **not** depend on `@effect/ai-openai`. OpenRouter speaks the OpenAI chat completions wire format, so this package implements that protocol directly against its own code-generated `Generated.ts` schema layer, keeping the dependency surface minimal (`repos/effect/packages/ai/openrouter/package.json:48-53`).

## Public API surface

- **`OpenRouterClient`** (`src/OpenRouterClient.ts`) — low-level HTTP service tag with `make` / `layer` / `layerConfig` constructors. Exposes `createChatCompletion` (single-shot `Effect`), `createChatCompletionStream` (SSE `Stream`), and a raw `Generated.Client` escape hatch. Defines streaming chunk schemas: `ChatStreamingResponseChunk`, `ChatStreamingChoice`, `ChatStreamingMessageChunk`, `ChatStreamingMessageToolCall` (`src/OpenRouterClient.ts:311-372`).

- **`OpenRouterLanguageModel`** (`src/OpenRouterLanguageModel.ts`) — implements `LanguageModel.LanguageModel`. `model(modelId, config?)` wraps `AiModel.make("openrouter", layer(...))` so the result can be provided directly to any Effect requiring a `LanguageModel` (`src/OpenRouterLanguageModel.ts:239-243`). Contains prompt/tool/response conversion and OpenTelemetry annotations.

- **`OpenRouterConfig`** (`src/OpenRouterConfig.ts`) — per-call `Context.Tag` carrying an optional `transformClient` function. `withClientTransform` is a `dual` combinator enabling per-request HTTP middleware without a new `Layer` (`src/OpenRouterConfig.ts:43-56`).

- **`Generated`** (`src/Generated.ts`) — code-generated `Schema.Class` definitions for the OpenRouter chat completions API. Re-exported publicly but treated as an implementation detail.

## Patterns used

- [Context.GenericTag / Tag class / Reference](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `OpenRouterClient` and `OpenRouterConfig` are `Context.Tag` subclasses, giving them yieldable/providable service identity (`src/OpenRouterClient.ts:25-27`, `src/OpenRouterConfig.ts:13-23`).

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` and `layerConfig` wrap `make` in `Layer.effect(OpenRouterClient, ...)` (`src/OpenRouterClient.ts:227-260`).

- [Effect.fn (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `make`, `createChatCompletion`, `makeRequest`, and the streaming converter all use `Effect.fnUntraced` (`src/OpenRouterClient.ts:99`, `src/OpenRouterLanguageModel.ts:249`).

- [Schema.Class and Schema.TaggedClass](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — streaming chunk types and all `Generated.ts` types are `Schema.Class` instances with runtime decode/encode (`src/OpenRouterClient.ts:311-372`, `src/Generated.ts:13-120`).

- [Dual data-first / data-last (dual(...))](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `withClientTransform` and `withConfigOverride` use `dual(2, ...)` for pipeline or direct call syntax (`src/OpenRouterConfig.ts:46`, `src/OpenRouterLanguageModel.ts:325-334`).

- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` calls `Config.all(configs)` over `Config.Config<Redacted.Redacted>` fields, resolving at Layer construction time (`src/OpenRouterClient.ts:299-305`).

- [Redacted — prevent secret values from leaking to logs/spans](../02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans) — `apiKey` is `Redacted.Redacted` throughout and passed directly to `HttpClientRequest.bearerToken` (`src/OpenRouterClient.ts:67`, `src/OpenRouterClient.ts:105`).

## What's unique about this package's design

The API is OpenAI-compatible in wire format but responses include an extra `provider` field naming the upstream backend. This package threads that data into `Response.FinishPartMetadata` via `declare module "@effect/ai/Response"` interface augmentation, surfacing the upstream provider name and granular cost breakdowns as typed, optional metadata without touching `@effect/ai` core (`src/OpenRouterLanguageModel.ts:172-229`). The same augmentation carries `cache_control` breakpoints through every message role and content part type (`src/OpenRouterLanguageModel.ts:88-165`).

The streaming pipeline delegates SSE frame parsing to `@effect/experimental`'s `Sse.makeChannel()`, then applies `Stream.takeWhile(e => e.data !== "[DONE]")` — the OpenAI sentinel — before Schema-decoding each frame (`src/OpenRouterClient.ts:130-134`). SSE framing is the experimental package's concern; termination and decoding stay local.

`OpenRouterConfig.withClientTransform` enables per-call HTTP client override without a new `Layer`. The config is merged via `Effect.provideService` and read via `context.unsafeMap.get(OpenRouterConfig.key)` — a direct map access that skips a full `yield*` for an optional service (`src/OpenRouterClient.ts:116-119`, `src/OpenRouterConfig.ts:20-23`).

## Conventions observed

- `src/index.ts` re-exports every module as a named namespace (`export * as OpenRouterClient from "./OpenRouterClient.js"`), consistent with the monorepo standard (`src/index.ts:1-19`).

- `Generated.ts` lives in `src/` and is re-exported through `index.ts` but excluded from internal routing via the `exports` null guard on `"./internal/*"` — it is semi-public (`package.json:36`).

- Every error site names `module` and `method`, using `AiError.HttpRequestError.fromRequestError`, `HttpResponseError.fromResponseError`, and `MalformedOutput.fromParseError` uniformly (`src/OpenRouterClient.ts:136-153`).

- `stream_options: { include_usage: true }` is injected unconditionally into every streaming request so usage arrives in the final SSE chunk for forwarding to the `finish` part (`src/OpenRouterClient.ts:209-211`).

## "If you were authoring something similar, copy this"

- `layerConfig`: accept `Config.Config<Redacted.Redacted>`, call `Config.all(configs)`, then `Effect.flatMap` into `make`. Gives users both an env-var path and a literal-value path without duplication (`src/OpenRouterClient.ts:266-305`).

- TypeScript declaration merging on provider metadata: `declare module "@effect/ai/Response" { export interface FinishPartMetadata extends ProviderMetadata { readonly openrouter?: ... } }`. Providers add typed, optional fields to shared interfaces without forking the core package (`src/OpenRouterLanguageModel.ts:172-229`).

- `withConfigOverride` + `withClientTransform` as `dual(2, ...)` combinators: a single client `Layer` is shared while individual calls opt into different models, temperatures, or HTTP middleware (`src/OpenRouterConfig.ts:43-56`, `src/OpenRouterLanguageModel.ts:324-334`).

- Finish-reason normalization via a plain `Record<string, Response.FinishReason>` lookup table in `internal/utilities.ts` — trivial to extend when upstream adds codes (`src/internal/utilities.ts:5-12`).

## Open questions

- `Generated.ts` is code-generated via `@tim-smart/openapi-gen` (`package.json:59`). It is unclear where the OpenRouter OpenAPI spec is sourced from or how spec-vs-generated drift is detected in CI.

- Provider-defined tools are rejected with `AiError.MalformedInput` (`src/OpenRouterLanguageModel.ts:501-506`). OpenRouter does offer web-search and code-interpreter plugins for some models — unclear if this is a deliberate scope limit or a planned addition.

- The `model` field in `ChatStreamingResponseChunk` is validated as `TemplateLiteral(String, "/", String)` (`src/OpenRouterClient.ts:363-365`). Whether non-conforming model identifiers are ever returned and how the package handles them is unexplored.

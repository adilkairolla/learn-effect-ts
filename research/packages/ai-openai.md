# @effect/ai-openai

> Source: `repos/effect/packages/ai/openai/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `@effect/ai`, `@effect/experimental`, `@effect/platform`, `effect`

## What it does

`@effect/ai-openai` is the OpenAI provider for `@effect/ai`. It wraps a 22,000-line auto-generated typed HTTP client in Effect-native services so callers can use GPT models, produce embeddings, and invoke OpenAI-specific tools (web search, file search, code interpreter) through the shared `LanguageModel` and `EmbeddingModel` interfaces. Without it, consumers must hand-write HTTP calls, manage SSE streaming, and parse every response schema manually.

## Public API surface

- **`Generated`** (`src/Generated.ts:1-22475`) — auto-generated via `@tim-smart/openapi-gen`; ~500 `Schema.Class` declarations covering every OpenAI REST object, plus a `Client` interface and a `make` factory returning a typed `Effect` per operation.

- **`OpenAiClient`** (`src/OpenAiClient.ts:28-260`) — `Context.Tag` service wrapping `Generated.Client` with three higher-level methods: `createResponse`, `createResponseStream`, `createEmbedding`. Provides `layer` (static secrets) and `layerConfig` (from `Config`). Also exports `ResponseStreamEvent` — a `Schema.Union` of ~45 typed event classes covering text deltas, function-call deltas, reasoning, file/web/MCP/image-generation lifecycle, and errors (`src/OpenAiClient.ts:272-1925`).

- **`OpenAiLanguageModel`** (`src/OpenAiLanguageModel.ts:269-368`) — implements `LanguageModel.LanguageModel` via the Responses API. Exports `model`, `modelWithTokenizer`, `layer`, `layerWithTokenizer`, `make`, `withConfigOverride`. Module-augments `@effect/ai/Prompt` and `@effect/ai/Response` with `openai`-keyed metadata fields (`src/OpenAiLanguageModel.ts:121-246`).

- **`OpenAiEmbeddingModel`** (`src/OpenAiEmbeddingModel.ts:91-201`) — `EmbeddingModel.EmbeddingModel` with two modes: `layerBatched` (fixed batch + optional LRU cache) and `layerDataLoader` (time-window coalescing).

- **`OpenAiTool`** (`src/OpenAiTool.ts:13-98`) — four `Tool.providerDefined` constants (`CodeInterpreter`, `FileSearch`, `WebSearch`, `WebSearchPreview`) converted to `Generated.Tool.Encoded` at request time.

- **`OpenAiConfig`** (`src/OpenAiConfig.ts:13-56`) — `Context.Tag` for an optional `transformClient`; applied per-request inside `Generated.make`. Exposed via dual `withClientTransform`.

- **`OpenAiTokenizer`** (`src/OpenAiTokenizer.ts`) — wraps `gpt-tokenizer` (the only runtime dependency) into `Tokenizer.Tokenizer`.

- **`OpenAiTelemetry`** (`src/OpenAiTelemetry.ts:107-136`) — adds `gen_ai.openai.request.*` and `gen_ai.openai.response.*` span attributes on top of the shared `@effect/ai/Telemetry` base.

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `OpenAiClient.make`, `OpenAiLanguageModel.make`, and `Generated.make` all follow `Effect<Service, never, Deps>`; `src/OpenAiClient.ts:67-228`, `src/Generated.ts:18823-18828`.

- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `OpenAiClient.layer` uses `Layer.scoped`; `OpenAiLanguageModel.layer` uses `Layer.effect`; `OpenAiEmbeddingModel.layerDataLoader` uses `Layer.scoped` for scoped data-loader lifetime; `src/OpenAiClient.ts:234-240`.

- [`Layer.merge` / `provide` / `fresh` — Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `layerWithTokenizer` merges the language model and tokenizer layers; `src/OpenAiLanguageModel.ts:363-368`.

- [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `OpenAiClient`, `OpenAiLanguageModel.Config`, `OpenAiEmbeddingModel.Config`, `OpenAiConfig` all use the `Context.Tag` class form; `src/OpenAiClient.ts:28-30`.

- [`Schema.Class` and `Schema.TaggedClass`](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — every generated REST schema and every streaming event class uses `Schema.Class`; `src/OpenAiClient.ts:272-795`.

- [`Schema.decode` / `encode` / `is` entry points](../02-patterns-catalog.md#schemadecode--encode--is-entry-points) — SSE stream parsing calls `Schema.decode(Schema.parseJson(schema))` per event; `src/OpenAiClient.ts:128-129`.

- [`Dual data-first / data-last (`dual(...)`) and Pipeable trait`](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `withConfigOverride` and `withClientTransform` are both `dual(2, ...)`; `src/OpenAiLanguageModel.ts:376-383`.

- [`Stream.make` / `fromIterable` / `fromEffect`](../02-patterns-catalog.md#streammake--fromiterable--fromeffect) — `streamRequest` unwraps the HTTP response into a `Stream`, pipes through `Sse.makeChannel()`, then `Stream.mapEffect` decodes each event; `src/OpenAiClient.ts:124-156`.

- [`Configuration`](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` accepts `Config.Config<Redacted | undefined>` for all four credential fields and calls `Config.all` before construction; `src/OpenAiClient.ts:246-260`.

- [`Request batching & Caching`](../02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching) — `makeBatched` delegates to `EmbeddingModel.make` which wires internal request batching and optional LRU caching; `src/OpenAiEmbeddingModel.ts:112-144`.

## What's unique about this package's design

The package targets the **Responses API** (`/responses`), not Chat Completions. Unlike Anthropic's purely message-list API, OpenAI's Responses API is **stateful by item ID**: every output item carries a persistent `id`, reasoning items carry `encrypted_content`, and multi-turn conversations reference prior items via `previous_response_id`. The adapter round-trips item IDs by storing them in `metadata.openai.itemId` and reconstructing them in `prepareMessages` (`src/OpenAiLanguageModel.ts:479-529`); the Anthropic adapter has no equivalent.

OpenAI also exposes **provider-executed tools** (`code_interpreter`, `file_search`, `web_search`) that run server-side; the model returns completed call/result pairs. The adapter surfaces these as `providerExecuted: true` stream parts (`src/OpenAiLanguageModel.ts:691-760`). The **`strict` toggle** (`src/OpenAiLanguageModel.ts:108-113`) gates OpenAI's structured-output validation — Anthropic has no equivalent. Finally, `ResponseImageGenerationCallPartialImageEvent` (`src/OpenAiClient.ts:1280-1310`) streams base64 partial image data via SSE, a multimodal output absent in all other adapters.

## Conventions observed

- **Error translation boundary**: `HttpClientError` and `ParseError` from `Generated.Client` are caught at the `OpenAiClient` surface and mapped to `AiError.*`; downstream sees only `AiError.AiError`; `src/OpenAiClient.ts:134-155`.

- **`getOrUndefined` config read**: `Config` tags read per-call overrides via `ctx.unsafeMap.get(Config.key)` (not `yield* Config`), so the tag is optional without failing the effect; `src/OpenAiLanguageModel.ts:51-54`.

- **Module augmentation for provider metadata**: OpenAI-specific options are attached to `@effect/ai/Prompt` and `@effect/ai/Response` interfaces via TypeScript declaration merging, keeping the abstraction open; `src/OpenAiLanguageModel.ts:121-246`.

## "If you were authoring something similar, copy this"

- **Scope-local header redaction**: `yield* Effect.locallyScopedWith(Headers.currentRedactedNames, Arr.appendAll([...]))` inside `make` redacts auth headers from logs without global config changes; `src/OpenAiClient.ts:96`.

- **`takeUntil` for terminal SSE events**: `Stream.takeUntil(e => e.type === "response.completed" || e.type === "response.incomplete")` terminates the stream cleanly rather than relying on server connection close; `src/OpenAiClient.ts:191-193`.

- **Deduplication guard for API bugs**: a `seenOutputIds` set before iterating `response.output` defends against the documented OpenAI Responses API duplicate-item bug; `src/OpenAiLanguageModel.ts:589-596`.

- **`strict` JSON-schema toggle**: a `strict?: boolean` config flag (default `true`) controls OpenAI structured-output validation on function and response-format schemas; `src/OpenAiLanguageModel.ts:1327-1335`.

## Open questions

1. **Chat Completions dead path**: `Generated.ts` contains `CreateChatCompletionRequest` (line 2471) and `OpenAiClient` exports `StreamCompletionRequest` (line 61), but `OpenAiLanguageModel` routes only through the Responses API. Is Chat Completions a live code path or legacy codegen scaffolding?

2. **Computer-use stub**: `makeResponse` and `makeStreamResponse` both have `TODO(Max): support computer use` comments with the `computer_call` branch commented out (`src/OpenAiLanguageModel.ts:763-783`). When planned, how will the human-in-the-loop screenshot loop be modelled in the `@effect/ai` abstraction?

3. **Realtime API absence**: the WebSocket-based Realtime API has no representation. Given `@effect/experimental`'s `Socket` support, is a `OpenAiRealtimeClient` planned?

4. **`gpt-tokenizer` coverage gaps**: `OpenAiTokenizer` uses `GptTokenizer.encodeChat` which may not support all model families. The `Effect.try` at `src/OpenAiTokenizer.ts:17` catches the failure as `UnknownError`, but callers expecting a token count may be surprised when a non-`cl100k_base` model fails silently.

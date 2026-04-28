# @effect/ai

> Source: `repos/effect/packages/ai/ai/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/experimental`, `@effect/rpc`

## What it does

`@effect/ai` is the provider-agnostic LLM interface layer for the Effect ecosystem. It defines the abstract contracts — `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`, `Toolkit`, `Chat` — that concrete adapter packages (`@effect/ai-anthropic`, `@effect/ai-openai`, etc.) fulfill by providing `Layer` implementations. Application code imports only from `@effect/ai`; swapping the model provider means changing one `Layer.provide` call, not rewriting business logic. Without this package you would import provider-specific SDKs directly, coupling all call-sites to a single vendor's type signatures, retrying semantics, and streaming shapes.

The package also owns the full conversation data model (`Prompt`, `Response`) and cross-cutting concerns: OpenTelemetry instrumentation aligned to the GenAI semantic conventions (`Telemetry`), pluggable ID generation for tool calls (`IdGenerator`), MCP server scaffolding (`McpServer`, `McpSchema`), and an `EmbeddingModel` with built-in request batching via `@effect/experimental`'s `dataLoader`.

## Public API surface

Modules are namespaced via `repos/effect/packages/ai/ai/src/index.ts:1-551`.

**Core LLM contract**

- `LanguageModel` (`src/LanguageModel.ts`) — central `Context.Tag`; `Service` interface exposes `generateText`, `generateObject`, `streamText`. The internal `make` constructor takes a `ConstructorParams` pair (`generateText`/`streamText` over `ProviderOptions`) and handles tool-call resolution, span wiring, and schema decoding for all adapters. `repos/effect/packages/ai/ai/src/LanguageModel.ts:100-153`
- `EmbeddingModel` (`src/EmbeddingModel.ts`) — service tag + `make` factory; batches concurrent `embed` calls via `dataLoader` up to `maxBatchSize` with optional TTL cache. `repos/effect/packages/ai/ai/src/EmbeddingModel.ts:51-62`
- `Chat` (`src/Chat.ts`) — stateful sessions on top of `LanguageModel`; history stored in a `Ref`, optionally persisted via `BackingPersistence`. `repos/effect/packages/ai/ai/src/Chat.ts:49-70`

**Tool system**

- `Tool` (`src/Tool.ts`) — `Tool.make(name, options)` builds a user-defined tool with typed parameter/success/failure schemas and a `failureMode`. `Tool.providerDefined(...)` represents built-in provider capabilities. Both carry a `Context.Context<never>` annotations bag. `repos/effect/packages/ai/ai/src/Tool.ts:112-183, 942-1010`
- `Toolkit` (`src/Toolkit.ts`) — groups tools into a `WithHandler<Tools>` value; `Toolkit.make(...tools).toLayer({ ... })` is the standard path. `repos/effect/packages/ai/ai/src/Toolkit.ts:1-55`

**Conversation data model**

- `Prompt` (`src/Prompt.ts`) — immutable structured conversation; accepts a string shorthand or `Message[]`. `Prompt.merge` combines prompts. `repos/effect/packages/ai/ai/src/Prompt.ts:87-100`
- `Response` (`src/Response.ts`) — discriminated union of response parts: `TextPart`, `ReasoningPart`, `ToolCallPart<Tools>`, `ToolResultPart`, `FinishPart` (carries `Usage`/`FinishReason`), streaming delta variants. `repos/effect/packages/ai/ai/src/Response.ts:75-95`

**Cross-cutting**

- `AiError` (`src/AiError.ts`) — `Schema.Union` of five `Schema.TaggedError` variants: `HttpRequestError`, `HttpResponseError`, `MalformedInput`, `MalformedOutput`, `UnknownError`. `repos/effect/packages/ai/ai/src/AiError.ts:191-757`
- `Telemetry` (`src/Telemetry.ts`) — `CurrentSpanTransformer` tag + `addGenAIAnnotations` following OpenTelemetry GenAI conventions. `repos/effect/packages/ai/ai/src/Telemetry.ts:52-60`
- `Tokenizer` (`src/Tokenizer.ts`) — optional `tokenize`/`truncate` service; implemented by providers that support token counting. `repos/effect/packages/ai/ai/src/Tokenizer.ts:65-116`
- `IdGenerator` / `Model` / `McpServer` / `McpSchema` — ID factory for tool calls, provider-Layer wrapper, MCP server scaffolding. `repos/effect/packages/ai/ai/src/index.ts:179-551`

## Patterns used

- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `IdGenerator`, `Chat` are all `Context.Tag` subclasses; provider adapters supply them as `Layer` values without coupling call-sites to the concrete class.
- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `LanguageModel.make` returns an `Effect<Service>` that is lifted into a `Layer` by each provider adapter; `Toolkit.toLayer` builds a scoped handler layer from user-supplied handler functions.
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — used throughout `LanguageModel.make` internals (`generateContent`, `streamContent`, `resolveToolCalls`) for sequential, fiber-aware orchestration of tool-call resolution loops. `repos/effect/packages/ai/ai/src/LanguageModel.ts:564-873`
- [Stream.make / fromIterable / fromEffect](../02-patterns-catalog.md#streammake--fromiterable--fromeffect) — `streamText` returns a `Stream<Response.StreamPart<Tools>>` built by composing `Stream.unwrapScoped`, `Stream.mapChunksEffect`, and `Mailbox.toStream` to surface incremental provider output. `repos/effect/packages/ai/ai/src/LanguageModel.ts:675-865`
- [Schema.Struct](../02-patterns-catalog.md#schemastruct) — `Tool.make` wraps caller-supplied fields objects in `Schema.Struct`; `Response.Part`, `Prompt`, `AiError.*` are all Schema-first types enabling encode/decode round-trips between the abstract layer and provider wire formats. `repos/effect/packages/ai/ai/src/Tool.ts:1000-1010`
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — all five `AiError` variants extend `Schema.TaggedError` (which is built on `Data.TaggedError`), giving them structural equality, `_tag` discriminators, and Schema encode/decode in a single declaration. `repos/effect/packages/ai/ai/src/AiError.ts:191-505`
- [Mailbox — ordered message inbox](../02-patterns-catalog.md#mailbox--ordered-message-inbox) — `streamContent` with tool call resolution creates a `Mailbox`, forks the provider stream into it, interleaves `ToolResult` parts as calls are resolved, then surfaces `Mailbox.toStream` to the caller. `repos/effect/packages/ai/ai/src/LanguageModel.ts:849-864`
- [Request.of / RequestResolver.make / Effect.request — request batching](../02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching) — `EmbeddingModel.make` wraps the provider's `embedMany` with `@effect/experimental`'s `dataLoader`, giving automatic request batching and optional caching with no caller-visible change to the `embed` API. `repos/effect/packages/ai/ai/src/EmbeddingModel.ts:51-62`

## What's unique about this package's design

The defining design decision is the `ConstructorParams` split: adapters implement only two raw functions (`generateText(ProviderOptions)` and `streamText(ProviderOptions)`); the abstract layer owns tool-call resolution, schema decoding, span attachment, `IdGenerator` injection, and `Toolkit` lifecycle. No adapter re-implements those. `repos/effect/packages/ai/ai/src/LanguageModel.ts:527-553`

A second notable choice is the `Tool` annotation system: each `Tool` carries a `Context.Context<never>` bag (`repos/effect/packages/ai/ai/src/Tool.ts:171-172`) instead of plain optional fields. The `Readonly`, `Destructive`, `Idempotent`, and `OpenWorld` tags (`repos/effect/packages/ai/ai/src/Tool.ts:1328-1416`) use `Context.Reference` with defaults, so MCP servers and other consumers can read any annotation without requiring every tool author to set it explicitly.

The `ExtractError<Options>` and `ExtractContext<Options>` conditional types (`repos/effect/packages/ai/ai/src/LanguageModel.ts:419-449`) propagate tool handler errors and context requirements from `GenerateTextOptions` into the returned `Effect`'s channels — entirely invisible to callers who never supply a toolkit, but fully typed when they do.

## Conventions observed

The package follows the standard Effect monorepo layout documented in `research/03-conventions.md`. Notable divergences:

- **No `src/internal/` folder.** All implementation sits in top-level `src/` files; visibility gating is via the `package.json` `"./internal/*": null` export null. `repos/effect/packages/ai/ai/src/`
- **`index.ts` namespace re-exports exclusively** — `export * as ModuleName from "./Module.js"` with a JSDoc block per export. `repos/effect/packages/ai/ai/src/index.ts:72-551`
- **Errors extend `Schema.TaggedError`** (not `Data.TaggedError` directly), giving each error class both a `_tag` discriminator and Schema encode/decode. All errors carry `module` and `method` fields for origin pinpointing. `repos/effect/packages/ai/ai/src/AiError.ts:191-200`
- **`failureMode: "error" | "return"` on tools** is a deliberate deviation from standard Effect error-channel conventions; `"return"` captures handler failures as tool-result payload for LLM-level feedback loops. `repos/effect/packages/ai/ai/src/Tool.ts:340-352`
- **Hardened JSON parsing** via an inline BSD-3 adaptation of fastify/secure-json-parse that rejects `__proto__` injection from untrusted LLM tool-call parameters. `repos/effect/packages/ai/ai/src/Tool.ts:1440-1510`

## "If you were authoring something similar, copy this"

- **`ConstructorParams` abstraction boundary** — accept only the minimal provider-specific primitives in `make`; let the library own all cross-cutting orchestration. Provider swap-out is then a one-liner. `repos/effect/packages/ai/ai/src/LanguageModel.ts:527-553`
- **`Context.Context<never>` annotations bag on domain objects** — use `Context.Tag` + `Context.Reference` with defaults instead of plain optional fields; consumers opt-in without requiring every author to set metadata. `repos/effect/packages/ai/ai/src/Tool.ts:1328-1416`
- **`ExtractError` / `ExtractContext` conditional types from options** — encode error/context inference in named utility types rather than widening function signatures when options may carry effectful dependencies. `repos/effect/packages/ai/ai/src/LanguageModel.ts:419-449`
- **`Schema.TaggedError` with `module`+`method` provenance fields** — every error is structurally equatable, Schema-decodable, and self-describing enough for catch-and-log without a stack trace. `repos/effect/packages/ai/ai/src/AiError.ts:191-210`
- **`Mailbox` + `forkScoped` for streaming with interleaved effects** — when a producer stream triggers side-effects that emit back into the same output channel (tool call resolution), this pattern is cleaner than a custom `Channel`. `repos/effect/packages/ai/ai/src/LanguageModel.ts:849-864`

## Open questions

- **Provider-specific parameters** (e.g. `temperature`, `frequency_penalty`) — `ProviderOptions` has no such fields; `Prompt.ProviderOptions` namespace-keyed record (`repos/effect/packages/ai/ai/src/Prompt.ts:87-95`) appears to be the escape hatch, but whether adapters document their key namespace is not established from the base package alone.
- **`McpServer` / `McpSchema` role** — the modules exist but have minimal JSDoc in `index.ts`; unclear whether this is a full MCP host or only schema plumbing for adapters.
- **`Chat` + `BackingPersistence` persistence key format and serialization schema** for `Prompt` / `Response` history are not documented; requires reading `@effect/experimental/Persistence` to understand backend wiring. `repos/effect/packages/ai/ai/src/Chat.ts:49-70`
- **`failureMode: "return"` feedback loop** — when a tool fails with `"return"` mode the error is embedded in a `ToolResultPart`, but whether the abstract layer automatically re-invokes `generateText` with that result is not visible from `LanguageModel.ts` alone.
- **`EmbeddingModel.make` default `maxBatchSize`** — the factory parameter is accepted but no default value or overflow behaviour is documented in-source.

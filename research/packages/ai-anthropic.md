# @effect/ai-anthropic

> Source: `repos/effect/packages/ai/anthropic/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/ai`, `@effect/experimental`, `@effect/platform` (all peers; see `repos/effect/packages/ai/anthropic/package.json:48–53`)

## What it does

`@effect/ai-anthropic` is the Anthropic provider implementation for the Effect AI SDK. It wires `@effect/ai`'s provider-neutral `LanguageModel`, `Tokenizer`, and `Tool` abstractions to Anthropic's Messages API via an auto-generated, fully-typed HTTP client (`Generated`) wrapped in an Effect façade. Application code targeting Claude swaps in this package's `Layer`; advanced callers can reach the raw generated client directly. Without it, an Effect application would need to hand-roll authentication, SSE streaming, schema parsing, and error mapping.

## Public API surface

- `AnthropicClient` (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:30–778`) — Context `Tag` whose `Service` exposes `client: Generated.Client` (raw HTTP), `streamRequest` (generic SSE decoder), `createMessage`, and `createMessageStream`. Constructors: `layer` (static) and `layerConfig` (Effect `Config`-based). Also exports the `MessageStreamEvent` discriminated union schema.
- `AnthropicConfig` (`repos/effect/packages/ai/anthropic/src/AnthropicConfig.ts:13–56`) — `Context.Tag` for per-request client transformation; `withClientTransform` is a `dual`.
- `AnthropicLanguageModel` (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:34–1577`) — implements `LanguageModel.LanguageModel`. `model` / `modelWithTokenizer` produce `AiModel` values; `withConfigOverride` adjusts per-call params; `prepareTools` is public for Amazon Bedrock reuse.
- `AnthropicTokenizer` (`repos/effect/packages/ai/anthropic/src/AnthropicTokenizer.ts:1–59`) — wraps `@anthropic-ai/tokenizer` WASM as `Tokenizer.Tokenizer`.
- `AnthropicTool` (`repos/effect/packages/ai/anthropic/src/AnthropicTool.ts:1–553`) — versioned provider tool constants (`Bash`, `CodeExecution`, `ComputerUse`, `TextEditor`, `WebSearch`), each built with `Tool.providerDefined`. `getProviderDefinedToolName` maps wire names back to Effect toolkit names; also public for Amazon Bedrock.
- `Generated` (`repos/effect/packages/ai/anthropic/src/Generated.ts:5968–7230`) — ~7 000-line code-generated file. Every Anthropic endpoint is a method on `Client` typed as `Effect<ResponseSchema, HttpClientError | ParseError | ClientError<Tag, ErrorSchema>>`. All wire types are `Schema.Class` definitions. `Generated.make` accepts `HttpClient.HttpClient` and returns `Client`.

## Patterns used

- [`Layer.scoped` (resource layers)](../02-patterns-catalog.md#layerscoped-resource-layers) — `AnthropicClient.layer` calls `Layer.scoped(AnthropicClient, make(options))`, binding the client lifecycle to a `Scope` (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:622–694`).
- [`Schema.Class` and `Schema.TaggedClass`](../02-patterns-catalog.md#schemaclass-and-schematagged-class) — every request and response wire type in `Generated.ts` is a `Schema.Class` (`repos/effect/packages/ai/anthropic/src/Generated.ts:120–400`).
- [`Channel — bidirectional stream primitive`](../02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type) — `createMessageStream` pipes the response body through `Sse.makeChannel()` then decodes chunks with `Schema.decode(Schema.ChunkFromSelf(Schema.parseJson(schema)))` (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:227–259`).
- [`Effect.catchTag` / `catchTags` / `sandbox` — error handling](../02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling) — `RequestError`, `ResponseError`, and `ParseError` are all mapped to `AiError` subtypes via `catchTags`, keeping the public error channel uniform (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:238–298`).
- [`Config.string` / `integer` / `boolean` / `nested` / `all`](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` resolves `Config.Config<Redacted | undefined>` values with `Config.all` before calling `make` (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:700–778`).
- [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `withClientTransform` and `withConfigOverride` use `dual(2, …)` (`repos/effect/packages/ai/anthropic/src/AnthropicConfig.ts:43–56`, `repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:419–426`).
- [Redacted — prevent secret values from leaking to logs/spans](../02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans) — API key is `Redacted.Redacted`; `Headers.currentRedactedNames` is extended with `"x-api-key"` inside the scoped `make` (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:199–202`).
- [`Effect.fn` (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `make`, `createMessage`, and `makeRequest` all use `Effect.fnUntraced` to avoid allocating an extra span for internal helpers (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:199`, `repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:318`).

## What's unique about this package's design

The defining split is **generated HTTP client + hand-written Effect façade**. `Generated.ts` materialises every Anthropic endpoint and wire type from the OpenAPI schema (`codegen` runs `build-utils prepare-v3`). `AnthropicClient.Service` is purely a façade that appends auth headers, normalises errors to `AiError`, and adds the SSE path — it delegates all HTTP dispatch to the generated layer (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:220–225`). The generated file can be refreshed mechanically when Anthropic publishes a new schema without touching the façade.

`@effect/ai-amazon-bedrock` peer-depends on `@effect/ai-anthropic` (`repos/effect/packages/ai/amazon-bedrock/package.json:50`) because Bedrock's Claude invocations use the Anthropic Messages wire format. Bedrock reuses `AnthropicLanguageModel.prepareTools` and `AnthropicTool.getProviderDefinedToolName` rather than duplicating them — cross-provider type sharing is encoded in the dependency graph.

The SSE streaming pipeline validates payloads per chunk: response bytes → `Sse.makeChannel()` → `Schema.decode(Schema.ChunkFromSelf(Schema.parseJson(schema)))`. One `ParseError` surface per chunk, not per event; downstream receives fully typed `MessageStreamEvent` values with no `unknown` casts (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:227–258`).

## Conventions observed

- All public exports carry `@since 1.0.0` and `@category` tags matching the ecosystem vocabulary (`Constructors`, `Layers`, `Schemas`, `Models`, `Tool Calling`, etc.).
- `Generated.ts` intentionally diverges: machine-generated, snake_case field names, no per-declaration `@since` tags. It is treated as an opaque artefact.
- Only one `internal/` file exists — `src/internal/utilities.ts` with the `resolveFinishReason` helper — matching the convention that non-public code lives under `internal/` (`repos/effect/packages/ai/anthropic/src/internal/utilities.ts`).
- Module augmentation (`declare module "@effect/ai/Prompt"`, `declare module "@effect/ai/Response"`) attaches Anthropic-specific options (cache control breakpoints, reasoning info, citation config) to the provider-neutral interfaces without forking them (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:107–288`).
- `layerWithTokenizer` uses `Layer.merge` rather than `Layer.provide` because the tokenizer has no dependency on `AnthropicClient` (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:406–410`).

## "If you were authoring something similar, copy this"

- **Generated HTTP client + hand-written façade** (`repos/effect/packages/ai/anthropic/src/Generated.ts:5968–6006`, `repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:199–225`). `Generated.make` accepts an `HttpClient`, returns a typed `Client`. The façade adds auth and error normalisation. Refreshing the generated layer requires no changes to the façade.
- **Module-augmentation for provider-specific options** (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:107–208`). `declare module "@effect/ai/Prompt" { interface UserMessageOptions { anthropic?: { cacheControl?: ... } } }` injects per-provider options into the provider-neutral type without forking it. Consumers who import `@effect/ai-anthropic` get the merged interface automatically.
- **`Effect.locallyScopedWith` for header redaction** (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:200–202`). Appending `"x-api-key"` to `Headers.currentRedactedNames` inside a scoped effect ties the redaction policy to the `Scope` lifetime. No global state mutation.
- **Expose cross-provider helpers explicitly** (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:1421–1424`). Marking `prepareTools` as a public export (with JSDoc noting Bedrock's reuse) is cleaner than duplicating the mapping or extracting it to a separate shared package.

## Open questions

- What triggers regeneration of `Generated.ts`? The `codegen` script runs `build-utils prepare-v3` but the OpenAPI spec source URL is not visible in the checked-in files. Whether this is a CI-automated diff or a manual step is unclear.
- The `transformClient` ordering — static option in `AnthropicClient.make` vs. scoped `AnthropicConfig.withClientTransform` — is additive but undocumented. The `AnthropicConfig`-level transform runs inside `Generated.make` after the static one (`repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:220–225`).
- `AnthropicTokenizer` concatenates all parts into one string with no separator. Whether this diverges from Anthropic's billing token count for tool-heavy prompts is unspecified (`repos/effect/packages/ai/anthropic/src/AnthropicTokenizer.ts:26–43`).
- Multiple versioned tools accumulate beta flags into a comma-joined `anthropic-beta` header with no client-side validation of which combinations are mutually exclusive (`repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:329–361`).

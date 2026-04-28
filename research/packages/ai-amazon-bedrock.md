# @effect/ai-amazon-bedrock

> Source: `repos/effect/packages/ai/amazon-bedrock/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/ai`, `@effect/ai-anthropic`, `@effect/experimental`, `@effect/platform`

## What it does

`@effect/ai-amazon-bedrock` is the AWS Bedrock provider for the `@effect/ai` layer. It lets application authors call any Bedrock foundation model — Amazon Nova, Claude-on-Bedrock, Llama, Mistral, Cohere, DeepSeek — through the unified `LanguageModel.LanguageModel` service, with no dependency on the AWS SDK. The package signs requests via `aws4fetch` SigV4, decodes Bedrock's binary event-stream framing for streaming responses, and maps Bedrock-specific token-usage and stop-reason fields onto Effect AI's portable types. Without it, a Bedrock caller would hand-roll SigV4 signing, binary framing, and the full `LanguageModel` protocol adapter.

## Public API surface

`repos/effect/packages/ai/amazon-bedrock/src/index.ts:1-30` re-exports six namespace modules:

- `AmazonBedrockClient` (`src/AmazonBedrockClient.ts`) — low-level service tag. `converse` and `converseStream` POST to `/model/:modelId/converse[-stream]` after SigV4 signing. `layerConfig` accepts `Config.Config<T>` for all credentials (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:202-234`).

- `AmazonBedrockConfig` (`src/AmazonBedrockConfig.ts`) — optional context override. `withClientTransform` is a `dual` that wraps any Effect with a scoped `HttpClient` interceptor (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockConfig.ts:43-56`).

- `AmazonBedrockLanguageModel` (`src/AmazonBedrockLanguageModel.ts`) — main integration point. `model(modelId, config?)` returns an `AiModel.Model<"amazon-bedrock", LanguageModel.LanguageModel, AmazonBedrockClient>` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:186-190`). `withConfigOverride` is a `dual` for per-call inference-parameter overrides.

- `AmazonBedrockTool` (`src/AmazonBedrockTool.ts`) — re-exports Anthropic provider-defined tools (Bash, ComputerUse, TextEditor, all version variants) under `Anthropic`-prefixed names so callers never import `@effect/ai-anthropic` directly (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockTool.ts:13-273`).

- `AmazonBedrockSchema` (`src/AmazonBedrockSchema.ts`) — `Schema.Class` definitions for every Converse API shape: `ConverseRequest`, `ConverseResponse`, `ConverseResponseStreamEvent`, `BedrockFoundationModelId` (70+ model-ID literals), `ContentBlock`, `TokenUsage`, guardrail types (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockSchema.ts:22-1127`).

- `EventStreamEncoding` (`src/EventStreamEncoding.ts`) — generic `Channel` that buffers raw `Uint8Array` chunks, reads each 4-byte length header, delegates to `@smithy/eventstream-codec` for framing, then schema-decodes the JSON body (`repos/effect/packages/ai/amazon-bedrock/src/EventStreamEncoding.ts:22-118`).

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `AmazonBedrockClient.of(...)` finalises the service record (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:190-195`).
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — all constructors and message-preparation helpers are `Effect.gen` chains (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:196-283`).
- [`Effect.fn` (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — every internal helper uses `Effect.fnUntraced` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:196-1031`).
- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `AmazonBedrockClient` uses `Layer.scoped`; `AmazonBedrockLanguageModel` uses `Layer.effect` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:211`, `repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:289-293`).
- [`Schema.Class` and `Schema.TaggedClass`](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — `Schema.attachPropertySignature` adds discriminant `type` fields inside `Schema.Union` for content-block and stream-event variants (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockSchema.ts:313-350`).
- [`Channel` — bidirectional stream primitive](../02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type) — `makeChannel` uses `Channel.embedInput` + `Mailbox.toChannel` to build a stateful byte-stream decoder (`repos/effect/packages/ai/amazon-bedrock/src/EventStreamEncoding.ts:49-116`).
- [Dual data-first / data-last (`dual(...)`)](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `withConfigOverride` and `withClientTransform` both use `dual(2, ...)` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:300-309`).
- [`Effect.catchTag` / `catchTags` — error handling](../02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling) — `RequestError`, `ResponseError`, and `ParseError` are mapped to typed `AiError` variants on every public method (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:122-174`).
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — `src/internal/utilities.ts` holds finish-reason mapping; internal paths are null-mapped in `package.json` exports (`repos/effect/packages/ai/amazon-bedrock/package.json:37`).
- [`Config.string` / … / `all`](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` uses `Config.all(configs)` for atomic credential resolution (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:228-233`).

## What's unique about this package's design

The defining architectural choice is the cross-provider dependency on `@effect/ai-anthropic`. Bedrock hosts Claude models and exposes Anthropic provider-defined tools (Bash, ComputerUse, TextEditor) via an `additionalModelRequestFields` escape hatch. Rather than duplicating definitions, `AmazonBedrockLanguageModel` imports `prepareTools` and `AnthropicTool` directly from `@effect/ai-anthropic` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:4-5`). When the model ID contains `"anthropic."`, the tool-preparation path delegates to Anthropic's logic to compute beta-header strings and `tool_choice`, injects `tool_choice` into `additionalModelRequestFields`, and converts tool definitions to Bedrock's `toolSpec` shape (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:946-989`). This makes the package depth-5 in the monorepo dependency graph — deeper than any other AI provider — because it must be downstream of both `@effect/ai` and `@effect/ai-anthropic`. No other provider in the monorepo takes a peer dependency on a sibling provider.

The second notable design is `EventStreamEncoding`: instead of pulling in `@smithy/client-bedrock-runtime`, the package takes only two lightweight `@smithy` utilities and builds a generic `Channel<Chunk<A>, Chunk<Uint8Array>>` that decodes any schema-typed event stream, reusable across all Bedrock stream shapes (`repos/effect/packages/ai/amazon-bedrock/src/EventStreamEncoding.ts:22-32`).

## Conventions observed

- All public modules are named `AmazonBedrock<Purpose>`, making import origins unambiguous.
- `layer` + `layerConfig` pair on every credentialed service — consistent with `@effect/ai-anthropic` and `@effect/platform`.
- Provider-specific prompt options via TypeScript declaration merging on `@effect/ai/Prompt` and `@effect/ai/Response` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:117-176`), keeping shared types clean.
- `trimIfLast` strips trailing whitespace from the final assistant content block, working around a Bedrock validation constraint (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:1154-1159`).
- **Bug:** `AmazonBedrockConfig`'s tag key is `"@effect/ai-google/AmazonBedrockConfig"` — a copy-paste error from the Google AI provider (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockConfig.ts:13`).

## "If you were authoring something similar, copy this"

- **Re-export sibling provider tools under your own namespace** — consumers get a single import; the type-level delegation is explicit (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockTool.ts:13-30`).
- **`Config.all` in `layerConfig`** — atomic startup failure if any credential is missing, rather than a runtime error on first call (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:228-233`).
- **Generic `Channel` with a schema type parameter** — `makeChannel<A, I, R>` is reusable for any event-stream format, not just Bedrock (`repos/effect/packages/ai/amazon-bedrock/src/EventStreamEncoding.ts:22-32`).
- **Beta-header accumulation via `Set<string>`** — collect betas during tool preparation, join at request time; no duplicates, easy to compose (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:940-968`).

## Open questions

1. **Tag key typo** — `"@effect/ai-google/AmazonBedrockConfig"` (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockConfig.ts:13`) will collide with the Google AI provider's config if both are loaded in the same program.
2. **`anthropic-beta` on non-Claude models** — `converse` / `converseStream` pass the header unconditionally (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:48-56`); does Bedrock reject it for non-Anthropic model IDs?
3. **`gpt-tokenizer` in production deps** — listed in `package.json:65` but absent from all source files; is it a leftover or used during codegen?
4. **File URL inputs** — `prepareMessages` returns `MalformedInput` for `URL`-typed file parts (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:367-372`) even though Bedrock's video API accepts S3 URIs; is S3 routing planned?
5. **Reasoning signature round-trip** — the Bedrock-issued thinking signature (`repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockLanguageModel.ts:101-115`) must be echoed back in subsequent prompts; is preserving it the caller's responsibility?

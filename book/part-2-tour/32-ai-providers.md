# Chapter 32 — AI providers — Anthropic deep-dive (OpenAI, Google, Bedrock, OpenRouter as variants)

> **Package(s):** `@effect/ai-anthropic` (canonical), `@effect/ai-openai`, `@effect/ai-google`, `@effect/ai-amazon-bedrock`, `@effect/ai-openrouter`
> **Patterns introduced:** [Mailbox — ordered message inbox](../../research/02-patterns-catalog.md#mailbox--ordered-message-inbox)
> **Reads from:** Chapter 31 (AI abstractions with @effect/ai), Chapter 09 (Layer), Chapter 14 (Schema part 1), Chapter 38 (Config and secrets — Redacted)
> **Reads into:** Chapter 33 (Observability with @effect/opentelemetry — AI calls are heavily traced)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 31 showed the provider-agnostic vocabulary: `LanguageModel`, `Tool`, `Toolkit`, `Chat`. But those abstractions require concrete provider implementations — a `Layer` that satisfies `LanguageModel.LanguageModel`. Without a provider package, you are writing those yourself.

The naive approach is to wire directly to a vendor SDK:

```ts
import Anthropic from "@anthropic-ai/sdk"
import OpenAI from "openai"

// Version A — Anthropic
async function chatWithAnthropic(userMessage: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const message = await client.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 1024,
    messages: [{ role: "user", content: userMessage }],
  })
  // Anthropic returns a content array; text lives in content[0].text
  const part = message.content[0]
  return part.type === "text" ? part.text : ""
}

// Version B — OpenAI (same intention, completely different shape)
async function chatWithOpenAI(userMessage: string): Promise<string> {
  const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  const completion = await openai.chat.completions.create({
    model: "gpt-4o",
    messages: [{ role: "user", content: userMessage }],
  })
  // OpenAI nests the text under choices[0].message.content
  return completion.choices[0].message.content ?? ""
}
```

Those two functions have identical semantics but incompatible shapes. Switching from Anthropic to OpenAI — or even moving from the Anthropic direct API to Claude-on-Bedrock — requires touching every call site:

- Different import paths and class constructors
- Different request schemas (`messages.create` vs `chat.completions.create` vs `converse`)
- Different response types (Anthropic content arrays, OpenAI choices, Bedrock `ConverseResponse`)
- Different streaming APIs (Anthropic SSE, OpenAI SSE Responses API, Bedrock binary event-stream)
- Different auth mechanisms (API key header vs bearer token vs SigV4 IAM signing)
- No shared retry, no structured cancellation, no auto-instrumentation

Even within one provider, subtle differences compound. Calling Claude directly through Anthropic's API differs from calling it through Amazon Bedrock: the auth mechanism is SigV4 instead of an API key, some beta headers are unsupported, and Bedrock wraps everything in its own Converse API envelope. Code that handles both cases without `@effect/ai-amazon-bedrock` accumulates provider-specific conditionals throughout the business layer.

The provider packages eliminate this by combining two layers — a client layer (e.g., `AnthropicClient.layer`) that requires `HttpClient.HttpClient`, and a model layer (e.g., `AnthropicLanguageModel.model`) that requires the client — which together produce a `Layer<LanguageModel.LanguageModel, never, HttpClient.HttpClient>` satisfying the abstract tag from Chapter 31. No single export has that combined type; `Layer.provide` composes them at the program boundary. The agentic code you already wrote does not change when you change providers.

---

## The minimal example

Wire `AnthropicClient.layerConfig` and `AnthropicLanguageModel.model` together, then run a chat against the abstract `LanguageModel.LanguageModel` tag — the same tag Chapter 31 uses. The provider is injected at the program boundary; the business logic never imports from `@anthropic-ai/sdk`.

```ts
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { LanguageModel } from "@effect/ai"
import { Config, Effect, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

// 1. Provider layer — reads ANTHROPIC_API_KEY from environment.
//    Config.redacted wraps the value in Redacted so it never appears in logs.
const AnthropicLayer = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(NodeHttpClient.layer))

// 2. Model layer — choose which Claude model to use.
const ModelLayer = AnthropicLanguageModel.model("claude-opus-4-1-20250805")

// 3. Business logic — depends only on the abstract LanguageModel tag.
const program = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt: "What is the capital of France?",
  })
  yield* Effect.log(response.text)
})

// 4. Assemble and run — provider layers provided at the edge.
Effect.runPromise(
  program.pipe(
    Effect.provide(ModelLayer),
    Effect.provide(AnthropicLayer),
  )
)
```

To switch to OpenAI, replace lines 6–8. The `program` constant is unchanged. That is the whole value proposition.

---

## Tour

### `@effect/ai-anthropic` deep-dive

`@effect/ai-anthropic` is the canonical provider. It consists of four public modules plus the large code-generated file `Generated.ts`.

**`AnthropicClient` — the HTTP service tag.**

`AnthropicClient` is a `Context.Tag` whose `Service` interface wraps the auto-generated HTTP client and adds three higher-level methods: `createMessage` (single-shot), `createMessageStream` (SSE), and `streamRequest` (generic SSE decoder for arbitrary schemas). Source: `repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:26-32` — the tag class declaration.

Two layer constructors are provided. `AnthropicClient.layer(options)` accepts a static `Redacted` API key:

```ts
// repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:618-694
export const layer = (options: {
  readonly apiKey?: Redacted.Redacted | undefined
  readonly apiUrl?: string | undefined
  readonly anthropicVersion?: string | undefined
  readonly transformClient?: ((client: HttpClient.HttpClient) => HttpClient.HttpClient) | undefined
}): Layer.Layer<AnthropicClient, never, HttpClient.HttpClient>
```

`AnthropicClient.layerConfig(options)` accepts `Config.Config<Redacted>` values resolved at startup, integrating with any `ConfigProvider` (environment variables, AWS SSM, test maps). Source: `repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:696-778`.

The `apiKey` field is typed as `Redacted.Redacted` throughout. Inside `make`, the implementation calls `Effect.locallyScopedWith(Headers.currentRedactedNames, Arr.append("x-api-key"))` so Effect's built-in loggers scrub the key from HTTP diagnostic output automatically. Source: `repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:199-202`. See Chapter 38 for the full Redacted story.

**`AnthropicLanguageModel` — the model selector.**

`AnthropicLanguageModel.model(modelId, config?)` is the entry point for most callers:

```ts
// repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:294-302
export const model = (
  model: (string & {}) | Model,
  config?: Omit<Config.Service, "model">
): AiModel.Model<"anthropic", LanguageModel.LanguageModel, AnthropicClient> =>
  AiModel.make("anthropic", layer({ model, config }))
```

The `model` parameter is the Anthropic model identifier string (e.g., `"claude-opus-4-1-20250805"`, `"claude-3-5-sonnet-20241022"`). `config?` accepts optional inference parameters (`max_tokens`, `temperature`, `top_p`, and so on) defined in `Config.Service`. The return type is an `AiModel.Model` — a thin wrapper that bundles the `Layer` with a provider tag, letting Effect track which concrete model is in scope.

`AnthropicLanguageModel.layer(options)` builds the `Layer<LanguageModel.LanguageModel, never, AnthropicClient>` directly if you prefer the lower-level constructor. `layerWithTokenizer` merges the language model layer with `AnthropicTokenizer.layer` via `Layer.merge` — because the tokenizer has no dependency on `AnthropicClient`, it does not need to be provided through the client. Source: `repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:392-410`.

**`AnthropicTokenizer` — WASM-backed token counting.**

`AnthropicTokenizer` wraps the `@anthropic-ai/tokenizer` WASM package as `Tokenizer.Tokenizer`. The `make` factory uses `Effect.try` to wrap the synchronous WASM call, surfacing any failure as `AiError.UnknownError` rather than an uncaught exception. Source: `repos/effect/packages/ai/anthropic/src/AnthropicTokenizer.ts:17-53`.

Use `AnthropicLanguageModel.modelWithTokenizer("claude-opus-4-1-20250805")` to get both the language model and the tokenizer in one layer — useful for pre-flight token budget checks (see Chapter 31's `Tokenizer.truncate` example).

**Streaming and the `createMessageStream` pipeline.**

When you call `LanguageModel.streamText`, the abstract layer routes to `AnthropicClient.createMessageStream`. Internally, this makes an HTTP request, extracts the response body as a `Stream<Uint8Array>`, decodes text, pipes through `Sse.makeChannel()` from `@effect/experimental`, then decodes each SSE event chunk via:

```ts
Schema.decode(Schema.ChunkFromSelf(Schema.parseJson(schema)))
```

The result is a fully typed `Stream<MessageStreamEvent, AiError>`. Every SSE chunk is validated independently; one `ParseError` surfaces immediately as `AiError.MalformedOutput` without corrupting downstream chunks. Source: `repos/effect/packages/ai/anthropic/src/AnthropicClient.ts:227-258`.

**Module augmentation for Anthropic-specific options.**

`AnthropicLanguageModel.ts` uses TypeScript declaration merging to attach Anthropic-specific options (cache control breakpoints, extended thinking configuration, citation config) to the provider-neutral `@effect/ai/Prompt` and `@effect/ai/Response` interfaces. Callers who import `@effect/ai-anthropic` automatically get the merged interface — provider-specific fields appear in their editor without any changes to `@effect/ai` core. Source: `repos/effect/packages/ai/anthropic/src/AnthropicLanguageModel.ts:107-288`.

---

### Mailbox — delivering stream events in order

`Mailbox` is the pattern introduced in this chapter. It lives in core Effect and is marked `@experimental` at the pinned SHA. Patterns catalog entry: [`Mailbox — ordered message inbox`](../../research/02-patterns-catalog.md#mailbox--ordered-message-inbox).

`Mailbox<A, E>` is an ordered, typed message inbox for a single consumer fiber. It differs from `Queue` in two ways: it is explicitly scoped to one actor (not a shared work queue), and it supports lifecycle signals — `done` / `fail` — that terminate the actor cleanly.

The core interface (source: `repos/effect/packages/effect/src/Mailbox.ts:60-117`):

```ts
// repos/effect/packages/effect/src/Mailbox.ts:60-117
export interface Mailbox<in out A, in out E = never> extends ReadonlyMailbox<A, E> {
  readonly offer: (message: A) => Effect<boolean>    // add one message; false if done
  readonly offerAll: (messages: Iterable<A>) => Effect<Chunk<A>>
  readonly fail: (error: E) => Effect<boolean>       // terminate with error
  readonly done: (exit: Exit<void, E>) => Effect<boolean>
  readonly end: Effect<boolean>                      // terminate successfully
}
```

The `ReadonlyMailbox` side is a `take` / `takeAll` / `takeN` interface that suspends the consumer fiber until messages arrive (source: `repos/effect/packages/effect/src/Mailbox.ts:119-172`).

Create a `Mailbox` with `Mailbox.make`:

```ts
// repos/effect/packages/effect/src/Mailbox.ts:209-214
export const make: <A, E = never>(
  capacity?: number | {
    readonly capacity?: number
    readonly strategy?: "suspend" | "dropping" | "sliding"
  } | undefined
) => Effect<Mailbox<A, E>>
```

The default `strategy` is `"suspend"` — the producer fiber suspends when the inbox is full, providing natural backpressure. Use `"dropping"` to silently discard excess messages or `"sliding"` to evict the oldest entry.

**How Mailbox connects to streaming AI responses.** The `@effect/ai-amazon-bedrock` package makes the connection explicit. Bedrock uses a binary event-stream framing protocol (not HTTP SSE) that requires a custom decoder. `EventStreamEncoding.makeChannel` allocates a `Mailbox` to buffer decoded event objects as the byte stream arrives. The producer side fills the mailbox from raw `Uint8Array` chunks; the consumer side reads typed `ConverseResponseStreamEvent` values at its own pace. Source: `repos/effect/packages/ai/amazon-bedrock/src/EventStreamEncoding.ts:22-32` and line 38 where `Mailbox.make` is called.

The key phrase is "at its own pace." A `Mailbox` with bounded capacity and `strategy: "suspend"` applies backpressure: if the consumer is slow (writing to a database, rendering to a UI), the HTTP socket pauses instead of buffering unbounded data in memory. This is the same backpressure story as `Stream` and `Channel`, but expressed as a fiber-local inbox with explicit lifecycle signals.

`Mailbox.toChannel` converts a `ReadonlyMailbox<A, E>` into a `Channel<Chunk<A>, unknown, E>` that terminates when the mailbox signals `done` or `fail`. The Bedrock `makeChannel` uses this to bridge the mailbox back into the Effect streaming pipeline. Source: `repos/effect/packages/effect/src/Mailbox.ts:229-236`.

Use `Mailbox` when you need an actor-style inbox with ordered delivery and lifecycle control — particularly when a producer and consumer run at different rates. Do not use it for pub-sub (multiple consumers) — use `PubSub` from Chapter 36. Do not use it for shared work queues — use `Queue`.

---

### Other providers

**`@effect/ai-openai` — GPT via the Responses API.**

`@effect/ai-openai` wraps a 22,000-line generated client in `OpenAiClient`, exposing `createResponse` (single-shot) and `createResponseStream` (SSE). The most distinctive aspect is that it targets OpenAI's **Responses API** (`/responses`), not Chat Completions. The Responses API is stateful: every output item carries a persistent ID, and multi-turn conversations reference prior items via `previous_response_id`. The adapter round-trips item IDs by storing them in `metadata.openai.itemId`. Additionally, `OpenAiEmbeddingModel` provides two modes — `layerBatched` and `layerDataLoader` — for embedding requests with built-in request coalescing. The `strict` toggle enables OpenAI's structured-output JSON schema validation, a feature absent in all other providers. Source: `repos/effect/packages/ai/openai/src/OpenAiClient.ts:230-260` — `OpenAiClient.layer` and `layerConfig` declarations.

**`@effect/ai-google` — Gemini with safety settings and multimodal support.**

`@effect/ai-google` connects to Google's Generative Language API (`generativelanguage.googleapis.com/v1beta`). The `GoogleLanguageModel.model(name, config?)` factory accepts a `Config.Service` typed as `Partial<Omit<GenerateContentRequest.Encoded, "contents" | "tools" | ...>>` — meaning callers pass `safetySettings`, `generationConfig`, and `cachedContent` as typed fields rather than opaque strings. Provider-defined tools include `GoogleSearch`, `GoogleSearchRetrieval`, `UrlContext`, and `CodeExecution`. A notable Gemma workaround is baked in: when the model name starts with `"gemma-"`, the system prompt is injected as a text prefix in the first user message because Gemma ignores the `systemInstruction` field. Source: `repos/effect/packages/ai/google/src/GoogleClient.ts:192-250` — `GoogleClient.layer` (line 192) and `GoogleClient.layerConfig` (line 220) declarations.

**`@effect/ai-amazon-bedrock` — Claude and Nova models via AWS SigV4.**

`@effect/ai-amazon-bedrock` lets you call any Bedrock foundation model — Amazon Nova, Claude-on-Bedrock, Llama, Mistral, DeepSeek — through the `LanguageModel.LanguageModel` interface without taking a dependency on the full AWS SDK. Authentication is SigV4 via `aws4fetch`. The package takes a unique cross-provider dependency on `@effect/ai-anthropic`: when the model ID contains `"anthropic."`, `AmazonBedrockLanguageModel` delegates tool preparation to `AnthropicLanguageModel.prepareTools` directly — no duplication. The `AmazonBedrockSchema.BedrockFoundationModelId` type enumerates 70+ model ID literals for compile-time model selection. Source: `repos/effect/packages/ai/amazon-bedrock/src/AmazonBedrockClient.ts:198-234` — `AmazonBedrockClient.layer` (accepts `accessKeyId`, `secretAccessKey`, `region`) and `layerConfig` (accepts `Config.Config<Redacted>` for credentials).

**`@effect/ai-openrouter` — 200+ models through a single endpoint.**

`@effect/ai-openrouter` connects to [OpenRouter](https://openrouter.ai), an HTTP proxy that exposes 200+ upstream models (GPT, Claude, Gemini, Llama, and more) behind a single OpenAI-compatible `/chat/completions` endpoint. The package does not depend on `@effect/ai-openai` — it re-implements the OpenAI chat completions wire protocol against its own generated types, keeping the dependency surface minimal. OpenRouter augments responses with a `provider` field naming the upstream backend and granular cost breakdowns; the package exposes these as typed optional fields on `Response.FinishPartMetadata` via declaration merging. `stream_options: { include_usage: true }` is injected unconditionally into every streaming request so token usage arrives in the final SSE chunk. Source: `repos/effect/packages/ai/openrouter/src/OpenRouterClient.ts:266-305` — `OpenRouterClient.layerConfig` declaration.

---

## A production example

A multi-provider chat function: typed tools, streaming response, and a swappable provider layer at the top. The `agentTurn` function depends only on `LanguageModel.LanguageModel` from Chapter 31. Change the provider by replacing one layer constant — no other line changes.

```ts
import {
  AnthropicClient,
  AnthropicLanguageModel,
} from "@effect/ai-anthropic"
import { LanguageModel, Tool, Toolkit } from "@effect/ai"
import { Config, Effect, Layer, Schedule, Schema, Stream } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

// ── Tool definition ────────────────────────────────────────────────────────

const FetchWeather = Tool.make("FetchWeather", {
  description: "Fetch the current weather for a city",
  parameters: {
    city: Schema.String,
    units: Schema.optionalWith(
      Schema.Literal("celsius", "fahrenheit"),
      { default: () => "celsius" as const }
    ),
  },
  success: Schema.Struct({
    temperature: Schema.Number,
    condition: Schema.String,
  }),
  failure: Schema.String,
})

// ── Toolkit + handler ──────────────────────────────────────────────────────

const WeatherToolkit = Toolkit.make(FetchWeather)

const WeatherToolkitLayer = WeatherToolkit.toLayer({
  FetchWeather: ({ city, units }) =>
    Effect.succeed({ temperature: units === "celsius" ? 18 : 64, condition: "Partly cloudy" }).pipe(
      Effect.withSpan("WeatherTool.fetch", { attributes: { city } })
    ),
})

// ── Streaming agent turn ───────────────────────────────────────────────────
// This function only requires LanguageModel.LanguageModel — no provider import.

const agentTurn = (userMessage: string) =>
  Effect.gen(function* () {
    const parts = yield* Stream.runCollect(
      LanguageModel.streamText({
        prompt: userMessage,
        toolkit: WeatherToolkit,
        concurrency: "unbounded",
      }).pipe(
        Stream.filter((p) => p.type === "text-delta"),
        Stream.map((p) => (p.type === "text-delta" ? p.delta : ""))
      )
    )
    return Array.from(parts).join("")
  }).pipe(
    Effect.retry(
      Schedule.exponential("500 millis").pipe(Schedule.recurs(3))
    )
  )

// ── Provider layer — swap this line to change providers ───────────────────
//
// Anthropic:
//   AnthropicClient.layerConfig({ apiKey: Config.redacted("ANTHROPIC_API_KEY") })
//
// OpenAI:
//   OpenAiClient.layerConfig({ apiKey: Config.redacted("OPENAI_API_KEY") })
//
// Google:
//   GoogleClient.layerConfig({ apiKey: Config.redacted("GOOGLE_API_KEY") })
//
// Amazon Bedrock:
//   AmazonBedrockClient.layerConfig({
//     accessKeyId: Config.string("AWS_ACCESS_KEY_ID"),
//     secretAccessKey: Config.redacted("AWS_SECRET_ACCESS_KEY"),
//     region: Config.string("AWS_REGION"),
//   })
//
// OpenRouter:
//   OpenRouterClient.layerConfig({ apiKey: Config.redacted("OPENROUTER_API_KEY") })

const ProviderLayer = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(NodeHttpClient.layer))

const ModelLayer = AnthropicLanguageModel.model("claude-opus-4-1-20250805")

// ── Program entry point ────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const answer = yield* agentTurn("What is the weather in Paris and London?")
  yield* Effect.log(`Answer: ${answer}`)
})

Effect.runPromise(
  program.pipe(
    Effect.provide(WeatherToolkitLayer),
    Effect.provide(ModelLayer),
    Effect.provide(ProviderLayer),
  )
)
```

The `agentTurn` function is provider-agnostic. The entire provider change is isolated to the `ProviderLayer` and `ModelLayer` constants at the bottom, which live at the program boundary — exactly where Chapter 09 (Layer) says composition should happen.

---

## Variations

**Per-provider model selection with `AnthropicLanguageModel.model`.**

Pass the model ID as a string literal. All current Anthropic model identifiers are valid; the `Model` type alias (defined in `AnthropicLanguageModel.ts:34`) narrows autocomplete to known IDs while `string & {}` still permits future IDs.

```ts
import { AnthropicLanguageModel } from "@effect/ai-anthropic"

// Use the fastest model for latency-sensitive paths
const FastLayer = AnthropicLanguageModel.model("claude-haiku-4-5")

// Use the most capable model for complex reasoning
const SmartLayer = AnthropicLanguageModel.model("claude-opus-4-1-20250805")
```

**Structured output with `LanguageModel.generateObject`.**

Force the model to emit JSON that decodes against a `Schema`. The abstract layer validates the response; a `MalformedOutput` error surfaces on decode failure — no manual JSON parsing.

```ts
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { LanguageModel } from "@effect/ai"
import { Effect, Schema } from "effect"

const SentimentResult = Schema.Struct({
  label: Schema.Literal("positive", "negative", "neutral"),
  confidence: Schema.Number,
  reasoning: Schema.String,
})

const classifySentiment = (text: string) =>
  LanguageModel.generateObject({
    prompt: `Classify the sentiment of the following text: "${text}"`,
    schema: SentimentResult,
  }).pipe(Effect.map((r) => r.value))
```

**Token usage from streaming with `FinishPart`.**

Filter the stream for `"finish"` parts to extract token usage after the response completes.

```ts
import { LanguageModel } from "@effect/ai"
import { Effect, Stream } from "effect"

const streamWithUsage = (prompt: string) =>
  Effect.gen(function* () {
    let usage: { inputTokens: number; outputTokens: number } | undefined
    const text = yield* Stream.runCollect(
      LanguageModel.streamText({ prompt }).pipe(
        Stream.tapEffect((part) => {
          if (part.type === "finish") {
            usage = { inputTokens: part.usage.inputTokens, outputTokens: part.usage.outputTokens }
          }
          return Effect.void
        }),
        Stream.filter((p) => p.type === "text-delta"),
        Stream.map((p) => (p.type === "text-delta" ? p.delta : ""))
      )
    )
    return { text: Array.from(text).join(""), usage }
  })
```

**Provider fallback — try Anthropic, fall back to OpenAI.**

Because both providers satisfy the same `LanguageModel.LanguageModel` tag, you can build a fallback layer with `Layer.orElse` or wrap the effect with `Effect.catchAll` at the boundary.

```ts
import { AnthropicClient, AnthropicLanguageModel } from "@effect/ai-anthropic"
import { OpenAiClient, OpenAiLanguageModel } from "@effect/ai-openai"
import { Config, Effect, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

const AnthropicProviderLayer = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(NodeHttpClient.layer))

const OpenAiProviderLayer = OpenAiClient.layerConfig({
  apiKey: Config.redacted("OPENAI_API_KEY"),
}).pipe(Layer.provide(NodeHttpClient.layer))

// Build the primary model layer; if AnthropicClient is unavailable in context,
// Layer composition will fail. Switch the provider layer to OpenAi at the
// program boundary to test fallback behaviour.
const PrimaryModelLayer = AnthropicLanguageModel.model("claude-opus-4-1-20250805")
const FallbackModelLayer = OpenAiLanguageModel.model("gpt-4o")
```

**Bedrock IAM auth — no API key, SigV4 credentials.**

`AmazonBedrockClient.layerConfig` accepts `accessKeyId`, `secretAccessKey`, and optional `sessionToken`/`region` — all as `Config.Config` values — rather than a simple API key.

```ts
import { AmazonBedrockClient, AmazonBedrockLanguageModel } from "@effect/ai-amazon-bedrock"
import { Config, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

const BedrockLayer = AmazonBedrockClient.layerConfig({
  accessKeyId: Config.string("AWS_ACCESS_KEY_ID"),
  secretAccessKey: Config.redacted("AWS_SECRET_ACCESS_KEY"),
  region: Config.string("AWS_REGION"),
}).pipe(Layer.provide(NodeHttpClient.layer))

// Claude-on-Bedrock uses the Anthropic message format under the hood
const BedrockModelLayer = AmazonBedrockLanguageModel.model(
  "anthropic.claude-opus-4-20250514-v1:0"
)
```

**OpenRouter as a model router — one API key, any model.**

Replace the provider layer with `OpenRouterClient.layerConfig` and any model string that OpenRouter supports. The `referrer` and `title` fields populate your site's ranking on `openrouter.ai`.

```ts
import { OpenRouterClient, OpenRouterLanguageModel } from "@effect/ai-openrouter"
import { Config, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

const OpenRouterLayer = OpenRouterClient.layerConfig({
  apiKey: Config.redacted("OPENROUTER_API_KEY"),
  referrer: Config.string("SITE_URL"),
  title: Config.string("SITE_TITLE"),
}).pipe(Layer.provide(NodeHttpClient.layer))

// Route to any model OpenRouter supports — swap the string without changing layers
const RouterModelLayer = OpenRouterLanguageModel.model("anthropic/claude-opus-4-1-20250805")
```

---

## Anti-patterns

**Using the provider SDK directly in business logic.**

The whole point of Chapter 31's abstraction is that business logic should depend on `LanguageModel.LanguageModel`, not on `@anthropic-ai/sdk` or `openai`. Reaching into a vendor SDK from inside a handler couples that handler permanently to one provider.

```ts
// Wrong: business logic imports a vendor SDK
import Anthropic from "@anthropic-ai/sdk"

async function summarise(text: string): Promise<string> {
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY })
  const msg = await client.messages.create({
    model: "claude-opus-4-1-20250805",
    max_tokens: 512,
    messages: [{ role: "user", content: "Summarise: " + text }],
  })
  return msg.content[0].type === "text" ? msg.content[0].text : ""
}
```

```ts
// Correct: depend on the abstract tag; provide the layer at the edge
import { LanguageModel } from "@effect/ai"
import { Effect } from "effect"

const summarise = (text: string) =>
  LanguageModel.generateText({ prompt: "Summarise: " + text }).pipe(
    Effect.map((r) => r.text)
  )
```

**Hard-coding API keys as plain strings.**

API keys passed as `string` literals are leaked into logs, spans, error messages, and stack traces. Every provider package types the key as `Redacted.Redacted` precisely to prevent this. The `Config.redacted("ENV_VAR")` constructor (Chapter 38) resolves the value from environment or config provider and wraps it automatically.

```ts
// Wrong: key is a plain string — will appear in logs
import { AnthropicClient } from "@effect/ai-anthropic"
import { Redacted } from "effect"

const UnsafeLayer = AnthropicClient.layer({
  apiKey: Redacted.make("sk-ant-..."),   // leaked if printed; never hard-code
})
```

```ts
// Correct: resolve from environment via Config; wraps as Redacted automatically
import { AnthropicClient } from "@effect/ai-anthropic"
import { Config, Layer } from "effect"
import { NodeHttpClient } from "@effect/platform-node"

const SafeLayer = AnthropicClient.layerConfig({
  apiKey: Config.redacted("ANTHROPIC_API_KEY"),
}).pipe(Layer.provide(NodeHttpClient.layer))
```

**Swapping providers without aligning error types.**

Providers can throw `AiError.AiError` variants with different HTTP status codes. A rate-limit is `429` from Anthropic, `429` from OpenAI, but Bedrock uses `ThrottlingException` in its response body. If your retry schedule filters on provider-specific status codes, it will silently stop working when you swap providers. Keep retry logic at the `AiError` level (check `_tag === "HttpResponseError"` and `response.status === 429`), not at provider-specific response shapes.

```ts
// Wrong: hard-coded Anthropic-specific status logic
import { AiError } from "@effect/ai"
import { Effect, Schedule } from "effect"

const badRetry = <A>(effect: Effect.Effect<A, AiError.AiError>) =>
  effect.pipe(
    Effect.retry(Schedule.recurs(3).pipe(
      // This condition is fine for Anthropic but may not hold for all providers
      Schedule.whileInput((e) =>
        e._tag === "HttpResponseError" && e.response.status === 529
      )
    ))
  )
```

```ts
// Correct: use the shared AiError structure with standard HTTP codes
import { AiError } from "@effect/ai"
import { Effect, Schedule } from "effect"

const goodRetry = <A>(effect: Effect.Effect<A, AiError.AiError>) =>
  effect.pipe(
    Effect.retry(Schedule.exponential("1 second").pipe(
      Schedule.recurs(5),
      Schedule.whileInput((e: AiError.AiError) =>
        e._tag === "HttpResponseError" && e.response.status === 429
      )
    ))
  )
```

**Ignoring `@experimental` on `Mailbox`.**

`Mailbox` is marked `@experimental` at the pinned SHA (`repos/effect/packages/effect/src/Mailbox.ts:1-4`). The `@effect/ai-amazon-bedrock` package uses it internally in `EventStreamEncoding`, but if you reference `Mailbox` directly in application code, add a comment noting the experimental status and review the changelog before upgrading past `effect@3.21.2`. The API may change in a future minor release.

---

## See also

- [Chapter 31 — AI abstractions with @effect/ai](31-ai-core.md): the provider-neutral vocabulary this chapter implements — `LanguageModel`, `Tool`, `Toolkit`, `Chat`, `Tokenizer`.
- [Chapter 09 — Layer](../part-1-foundations/09-layer.md): all provider packages are wired as `Layer` values; `Layer.provide` and `Layer.merge` are the composition primitives.
- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md): `Schema.Class` is the basis for every generated wire type in `Generated.ts`; `Schema.decode` validates every SSE chunk.
- [Chapter 33 — Observability with @effect/opentelemetry](33-opentelemetry.md): provider adapters automatically emit GenAI semantic-convention spans; application-level `Effect.withSpan` adds business context on top.
- [Chapter 38 — Config and secrets](38-config-and-secrets.md): `Config.redacted` and `Redacted.Redacted` are the mechanism all five providers use to pass API keys without leaking them to logs or spans.
- [Patterns catalog — Mailbox](../../research/02-patterns-catalog.md#mailbox--ordered-message-inbox): when to use `Mailbox` vs `Queue` vs `PubSub`, and the actor-library anti-pattern it replaces.
- [Per-package note — @effect/ai-anthropic](../../research/packages/ai-anthropic.md): deep-dive into `Generated.ts`, module augmentation, cross-provider tool sharing with Bedrock, and open questions.
- [Per-package note — @effect/ai-openai](../../research/packages/ai-openai.md): Responses API vs Chat Completions, stateful item IDs, `OpenAiEmbeddingModel`, and the `strict` JSON schema toggle.
- [Per-package note — @effect/ai-google](../../research/packages/ai-google.md): Gemini multimodal, safety settings, Gemma system-prompt workaround, and provider-defined tools.
- [Per-package note — @effect/ai-amazon-bedrock](../../research/packages/ai-amazon-bedrock.md): SigV4 auth, binary event-stream framing, `BedrockFoundationModelId` enum, and the cross-provider `@effect/ai-anthropic` dependency.
- [Per-package note — @effect/ai-openrouter](../../research/packages/ai-openrouter.md): provider routing metadata, cost breakdowns, upstream model selection, and the `[DONE]` SSE sentinel.

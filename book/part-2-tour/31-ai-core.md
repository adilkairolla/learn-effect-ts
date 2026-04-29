# Chapter 31 — AI abstractions with @effect/ai

> **Package(s):** `@effect/ai`
> **Patterns introduced:** [`Supervisor — observe and react to fiber lifecycle`](../../research/02-patterns-catalog.md#supervisor--observe-and-react-to-fiber-lifecycle)
> **Reads from:** Chapter 09 (Layer), Chapter 14 (Schema part 1), Chapter 15 (Schema part 2), Chapter 16 (Stream), Chapter 17 (Fibers and structured concurrency)
> **Reads into:** Chapter 32 (AI providers — Anthropic, OpenAI, Google, Bedrock, OpenRouter), Chapter 33 (Observability with @effect/opentelemetry — AI calls are heavily traced)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Every major LLM provider ships its own TypeScript SDK. The surface areas differ in ways that reach all the way into your business logic.

```ts
// Anthropic SDK
import Anthropic from "@anthropic-ai/sdk"

const client = new Anthropic()
const message = await client.messages.create({
  model: "claude-opus-4-5",
  max_tokens: 1024,
  messages: [{ role: "user", content: "Hello, Claude" }],
})
console.log(message.content[0].type === "text" ? message.content[0].text : "")

// OpenAI SDK — same concept, different shape
import OpenAI from "openai"

const openai = new OpenAI()
const completion = await openai.chat.completions.create({
  model: "gpt-4o",
  messages: [{ role: "user", content: "Hello, GPT" }],
})
console.log(completion.choices[0].message.content)
```

Four problems compound as your codebase grows.

**Provider coupling.** The `Anthropic` and `OpenAI` classes are concrete. Every call site imports a specific SDK. Switching providers means grep-and-replace across your entire codebase. Testing means mocking SDK-specific shapes rather than a consistent interface.

**No typed tool definitions.** Function calling is the backbone of agentic workflows. Both SDKs accept tool definitions as loose JSON Schema objects and return tool-call results as `unknown`. You add a wrapper layer to parse and validate, which immediately diverges when you add a second provider.

**No shared retry or cancellation.** Each SDK has its own retry configuration. Cancellation requires passing `AbortController` manually. Structured concurrency — forking a fiber per parallel tool call and interrupting the group if any call fails — is not composable with raw Promises.

**No consistent tracing.** OpenTelemetry GenAI semantic conventions specify how to annotate spans for LLM calls (model name, token usage, finish reason). Neither SDK auto-instruments according to that spec. You add per-provider instrumentation manually and watch it drift.

`@effect/ai` eliminates all four problems at once. It defines a stable, provider-agnostic vocabulary — `LanguageModel`, `EmbeddingModel`, `Tokenizer`, `Tool`, `Toolkit`, `Chat` — and wires them through Effect's `Layer` system. Provider implementations (Chapter 32) supply the concrete layer; your business logic never imports from `@anthropic-ai/sdk` or `openai` directly.

> **Stability note.** `@effect/ai` is published as its own versioned package (`0.35.0` at the pinned SHA). It does not carry the `@experimental` JSDoc tag in its source (`repos/effect/packages/ai/ai/src/`), but it is a relatively young package and its API surface may evolve. Review the changelog before upgrading past `0.35.0`.

---

## The minimal example

A single-turn chat call. No provider is imported — just the abstract tag and a prompt. Chapter 32 shows how to provide the `LanguageModel.LanguageModel` layer.

```ts
import { LanguageModel } from "@effect/ai"
import { Effect } from "effect"

// Require: LanguageModel (satisfied by any Chapter 32 provider layer)
const program = Effect.gen(function* () {
  const response = yield* LanguageModel.generateText({
    prompt: "What is the capital of France?",
  })

  // response.text is the full string; response.content is the typed part array
  yield* Effect.log(response.text)
})

// Wire in the provider layer at the edge (see Chapter 32):
//
//   Effect.runPromise(
//     program.pipe(Effect.provide(AnthropicLanguageModel.model("claude-opus-4-5")))
//   )
```

`LanguageModel.generateText` is a module-level convenience function — it resolves `LanguageModel.LanguageModel` from context and calls its `generateText` method. The `R` channel of the returned `Effect` carries `LanguageModel.LanguageModel`; swapping the provider is a one-`Layer.provide` change at the program boundary.

Source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:100-103` (tag), `repos/effect/packages/ai/ai/src/LanguageModel.ts:1-28` (module JSDoc).

---

## Tour

### The provider-agnostic vocabulary

The core insight of `@effect/ai` is architectural: application code should declare *what* it needs (a language model, an embedding model, a tokenizer), not *which vendor* supplies it. Each need is expressed as a `Context.Tag`. Provider adapters fulfil those tags as `Layer` values. No call site outside the program boundary should reference a provider SDK class.

This is exactly the pattern from Chapter 08 (Context and Tags) and Chapter 09 (Layer) applied to LLM infrastructure. The `LanguageModel` tag, the `EmbeddingModel` tag, and the `Tokenizer` tag are ordinary `Context.Tag` subclasses (`repos/effect/packages/ai/ai/src/LanguageModel.ts:100-103`, `repos/effect/packages/ai/ai/src/EmbeddingModel.ts:95-98`, `repos/effect/packages/ai/ai/src/Tokenizer.ts:65-68`).

### LanguageModel — the central contract

`LanguageModel.LanguageModel` is the tag. The `Service` interface behind it exposes three operations:

- `generateText` — run inference and return the completed `GenerateTextResponse` (source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:118-126`).
- `generateObject` — force structured output by supplying a `Schema`; the abstract layer decodes the response for you (source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:127-140`).
- `streamText` — return a `Stream<Response.StreamPart<Tools>>` of incremental delta parts (source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:142-152`).

All three are available both as instance methods on the service and as module-level convenience functions (`LanguageModel.generateText(...)`, `LanguageModel.generateObject(...)`, `LanguageModel.streamText(...)`) that resolve the tag from context.

The `ExtractError<Options>` and `ExtractContext<Options>` conditional types (`repos/effect/packages/ai/ai/src/LanguageModel.ts:419-449`) propagate handler errors and context requirements from the toolkit into the returned `Effect`'s channels, so tool errors become fully typed without widening the function signature. Callers who supply no toolkit get only `AiError.AiError` in the error channel.

Provider adapters do not implement the full `Service` interface from scratch. They supply only a `ConstructorParams` pair — `generateText(ProviderOptions)` and `streamText(ProviderOptions)` — and call `LanguageModel.make(params)`. The abstract `make` constructor owns tool-call resolution, span attachment, `IdGenerator` injection, and schema decoding. Source: `repos/effect/packages/ai/ai/src/LanguageModel.ts:522-553`.

### Chat — stateful multi-turn sessions

`Chat.empty` creates a new session with no history. `Chat.fromPrompt` initialises it with messages. Under the hood, history lives in a `Ref<Prompt.Prompt>` and is updated atomically after every call via a `Semaphore` (one-permit) so concurrent requests to the same session are serialised. Source: `repos/effect/packages/ai/ai/src/Chat.ts:1-48` (module JSDoc), `repos/effect/packages/ai/ai/src/Chat.ts:327-442` (`empty` constructor).

```ts
import { Chat } from "@effect/ai"
import { Effect } from "effect"

const multiTurn = Effect.gen(function* () {
  const chat = yield* Chat.empty

  // First turn — history is empty
  const r1 = yield* chat.generateText({ prompt: "What is 2 + 2?" })
  yield* Effect.log(r1.text)

  // Second turn — history includes the previous exchange automatically
  const r2 = yield* chat.generateText({ prompt: "Double that number." })
  yield* Effect.log(r2.text)
})
```

`Chat.Persistence` adds backing storage so sessions survive restarts. `Chat.layerPersisted({ storeId })` wires `@effect/experimental`'s `BackingPersistence` into the session layer.

### EmbeddingModel — vector embeddings with built-in batching

`EmbeddingModel.EmbeddingModel` is the tag; `embed(text)` returns `Effect<Array<number>, AiError>`. Under the hood, `EmbeddingModel.make` wraps the provider's `embedMany` with `@effect/experimental`'s `dataLoader`, giving automatic request batching up to `maxBatchSize` with an optional TTL cache. Concurrent `embed` calls are coalesced into a single provider request at no cost to the caller. Source: `repos/effect/packages/ai/ai/src/EmbeddingModel.ts:1-62`.

```ts
import { EmbeddingModel } from "@effect/ai"
import { Effect } from "effect"

const semanticSimilarity = Effect.gen(function* () {
  const embedder = yield* EmbeddingModel.EmbeddingModel

  // These two calls are automatically batched by the dataLoader
  const [docVec, queryVec] = yield* Effect.all(
    [embedder.embed("Effect is a TypeScript library"), embedder.embed("functional TypeScript")],
    { concurrency: "unbounded" }
  )

  const dot = docVec.reduce((s, v, i) => s + v * (queryVec[i] ?? 0), 0)
  const normA = Math.sqrt(docVec.reduce((s, v) => s + v * v, 0))
  const normB = Math.sqrt(queryVec.reduce((s, v) => s + v * v, 0))
  return dot / (normA * normB)
})
```

### Tokenizer — token counting and prompt truncation

`Tokenizer.Tokenizer` is optional — only providers that expose a token API implement it. The `Service` interface has two methods: `tokenize(input)` returns `Array<number>` (the token IDs), and `truncate(input, maxTokens)` returns a `Prompt` that fits within the budget. Source: `repos/effect/packages/ai/ai/src/Tokenizer.ts:65-116`.

```ts
import { Tokenizer } from "@effect/ai"
import { Effect } from "effect"

const guardContextWindow = (text: string, budget: number) =>
  Effect.gen(function* () {
    const tokenizer = yield* Tokenizer.Tokenizer
    const tokens = yield* tokenizer.tokenize(text)
    if (tokens.length > budget) {
      return yield* tokenizer.truncate(text, budget)
    }
    return text
  })
```

### Tool and Toolkit — typed function calling

`Tool.make(name, options)` declares a typed tool. The `parameters` field accepts a record of `Schema` values (automatically wrapped in `Schema.Struct`); `success` and `failure` are schema types for the happy-path and error return. The `failureMode` option controls whether a handler failure surfaces as an Effect error (`"error"`, the default) or as a tool-result payload sent back to the model for feedback-loop handling (`"return"`). Source: `repos/effect/packages/ai/ai/src/Tool.ts:1-26` (module JSDoc), `repos/effect/packages/ai/ai/src/Tool.ts:82-120` (interface).

```ts
import { Tool } from "@effect/ai"
import { Schema } from "effect"

const SearchDb = Tool.make("SearchDb", {
  description: "Search the product database by keyword",
  parameters: {
    query: Schema.String,
    limit: Schema.optionalWith(Schema.Number, { default: () => 10 }),
  },
  success: Schema.Array(Schema.Struct({
    id: Schema.String,
    name: Schema.String,
    score: Schema.Number,
  })),
})
```

`Toolkit.make(...tools)` groups tools into a unit. `toolkit.toLayer(handlers)` returns a `Layer` that provides the handler context required by each tool. At runtime the abstract `LanguageModel.make` loop calls each handler, collects the results, and continues the conversation. Source: `repos/effect/packages/ai/ai/src/Toolkit.ts:1-26` (module JSDoc), `repos/effect/packages/ai/ai/src/Toolkit.ts:111-152` (interface).

```ts
import { Tool, Toolkit } from "@effect/ai"
import { Effect, Schema } from "effect"

const GetTime = Tool.make("GetTime", {
  description: "Return the current Unix timestamp",
  success: Schema.Number,
})

const MyToolkit = Toolkit.make(SearchDb, GetTime)

const MyToolkitLayer = MyToolkit.toLayer({
  SearchDb: ({ query, limit }) =>
    Effect.succeed([{ id: "p1", name: "Widget " + query, score: 0.9 }]),
  GetTime: () => Effect.succeed(Date.now()),
})
```

Pass the toolkit to any generation call via the `toolkit` option. The abstract layer resolves tool calls in a loop, respecting the `concurrency` option for parallel tool execution.

### Response — the discriminated part union

`Response.AnyPart` is the union of everything a model can emit: `TextPart`, `ReasoningPart`, `ToolCallPart`, `ToolResultPart`, `FinishPart` (carries `Usage` and `FinishReason`), and streaming delta variants like `TextDeltaPart`. Source: `repos/effect/packages/ai/ai/src/Response.ts:1-95`.

`generateText` returns a `GenerateTextResponse` whose `.text` property is the concatenated text and whose `.content` array holds the full typed part list. Inspect parts directly when you need token usage or tool-call details.

### Supervisor — observing fiber lifecycles in agentic loops

Agentic workflows have a structural property that makes `Supervisor` directly applicable: when the model returns multiple tool calls in a single response, the abstract `LanguageModel.make` loop forks one fiber per tool call and runs them at the requested `concurrency`. Parallel tool execution is real structured concurrency — each tool call is a `RuntimeFiber`. You can observe that fiber tree with `Supervisor.track`.

`Supervisor<T>` is an interface with four lifecycle hooks — `onStart`, `onEnd`, `onEffect`, `onSuspend` — and a `.value` effect that produces the accumulated result. Source: `repos/effect/packages/effect/src/Supervisor.ts:36-86` (interface and hooks).

The most common constructor is `Supervisor.track` (`repos/effect/packages/effect/src/Supervisor.ts:141`), which returns an `Effect<Supervisor<Array<RuntimeFiber<any, any>>>>`. The supervisor accumulates all fibers started under it. `Supervisor.unsafeTrack()` does the same synchronously (`repos/effect/packages/effect/src/Supervisor.ts:149`).

Attach a supervisor to an effect with `Effect.supervised(supervisor)(effect)`. Every fiber forked inside `effect` — including the tool-call fibers forked by `LanguageModel.make` — is registered with the supervisor.

```ts
import { LanguageModel } from "@effect/ai"
import { Effect, Supervisor } from "effect"

const supervisedAgentTurn = Effect.gen(function* () {
  const supervisor = yield* Supervisor.track

  const response = yield* LanguageModel.generateText({
    prompt: "What is the weather in Paris and London?",
    toolkit: WeatherToolkit,
    concurrency: 2,
  }).pipe(Effect.supervised(supervisor))

  // After the call resolves, inspect every fiber that was spawned
  const fibers = yield* supervisor.value
  yield* Effect.log(`Tool fibers spawned: ${fibers.length}`)

  return response
})
```

`Supervisor` is an observability tool, not a concurrency control — use `Semaphore` or `Effect.all({ concurrency: n })` for rate limiting. The right use cases are: APM dashboards that count active tool fibers, test assertions that no fibers leaked, or debugging an agentic loop that appears to hang on tool execution. As noted in the patterns catalog (`../../research/02-patterns-catalog.md#supervisor--observe-and-react-to-fiber-lifecycle`), `Supervisor` sees the full parent-child fiber tree, which is exactly what agentic loops produce.

### AiError — the structured error hierarchy

Five `Schema.TaggedError` variants cover the full failure surface: `HttpRequestError`, `HttpResponseError`, `MalformedInput`, `MalformedOutput`, `UnknownError`. Each carries `module` and `method` provenance fields so you know exactly which service and which call failed. Use `Effect.catchTag` for targeted recovery:

```ts
import { AiError } from "@effect/ai"
import { Effect } from "effect"

const withRateLimitRetry = <A>(effect: Effect.Effect<A, AiError.AiError>) =>
  effect.pipe(
    Effect.catchTag("HttpResponseError", (err) =>
      err.response.status === 429
        ? Effect.fail(err) // let the outer Schedule handle retry
        : Effect.fail(err)
    )
  )
```

Source: `repos/effect/packages/ai/ai/src/AiError.ts:1-40` (module JSDoc).

### Telemetry — GenAI semantic conventions

`Telemetry.addGenAIAnnotations(span, attrs)` annotates an OpenTelemetry span following the GenAI spec (`gen_ai.system`, `gen_ai.operation.name`, `gen_ai.request.model`, `gen_ai.usage.input_tokens`, etc.). Provider adapters call this automatically; application code can add custom annotations with `Effect.withSpan` (Chapter 33 covers the full tracing story). Source: `repos/effect/packages/ai/ai/src/Telemetry.ts:1-60`.

---

## A production example

A tool-augmented agent loop: take user input, call the language model with a typed tool, handle streaming output, and integrate a `Supervisor` to observe the forked tool fibers.

```ts
import { Chat, EmbeddingModel, LanguageModel, Tool, Toolkit } from "@effect/ai"
import { Effect, Layer, Schedule, Schema, Stream, Supervisor } from "effect"

// ── Tool definition ────────────────────────────────────────────────────────

const LookupProduct = Tool.make("LookupProduct", {
  description: "Look up a product by name and return its price and stock status",
  parameters: {
    name: Schema.String,
  },
  success: Schema.Struct({
    price: Schema.Number,
    inStock: Schema.Boolean,
  }),
})

// ── Toolkit with handler ───────────────────────────────────────────────────

const ProductToolkit = Toolkit.make(LookupProduct)

// This layer would normally call a database; we simulate it here.
const ProductToolkitLayer: Layer.Layer<
  Toolkit.WithHandler<{ LookupProduct: typeof LookupProduct }>
> = ProductToolkit.toLayer({
  LookupProduct: ({ name }) =>
    Effect.succeed({ price: 29.99, inStock: true }).pipe(
      Effect.withSpan("ProductTool.lookup", { attributes: { productName: name } })
    ),
})

// ── Single agent turn ──────────────────────────────────────────────────────

const agentTurn = (userMessage: string) =>
  Effect.gen(function* () {
    // Track all fibers forked during this turn (tool calls fork fibers)
    const supervisor = yield* Supervisor.track

    // Stream the response so tokens appear incrementally
    const stream = LanguageModel.streamText({
      prompt: userMessage,
      toolkit: ProductToolkit,
      concurrency: "unbounded",
    }).pipe(
      Stream.filter((part) => part.type === "text-delta"),
      Stream.map((part) => (part.type === "text-delta" ? part.delta : "")),
      Effect.supervised(supervisor)
    )

    // Collect the streamed text
    const chunks = yield* Stream.runCollect(stream)
    const text = Array.from(chunks).join("")

    // Observe the fiber tree
    const fibers = yield* supervisor.value
    yield* Effect.log(`Response: ${text}`)
    yield* Effect.log(`Tool fibers spawned this turn: ${fibers.length}`)

    return text
  })

// ── Retry on rate limit ────────────────────────────────────────────────────

const agentTurnWithRetry = (userMessage: string) =>
  agentTurn(userMessage).pipe(
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.whileInput(
          (e: unknown) =>
            e != null &&
            typeof e === "object" &&
            "_tag" in e &&
            e._tag === "HttpResponseError"
        ),
        Schedule.upTo("30 seconds")
      )
    )
  )

// ── Multi-turn chat loop ───────────────────────────────────────────────────

const chatLoop = Effect.gen(function* () {
  const chat = yield* Chat.empty

  // Simulate a conversation with two turns; real code would read from stdin.
  const questions = [
    "What is the price of the Premium Widget?",
    "Is that product in stock right now?",
  ]

  for (const q of questions) {
    yield* Effect.log(`User: ${q}`)
    const response = yield* chat.generateText({
      prompt: q,
      toolkit: ProductToolkit,
    }).pipe(
      Effect.retry(Schedule.exponential("500 millis").pipe(Schedule.recurs(3)))
    )
    yield* Effect.log(`Assistant: ${response.text}`)
  }
})

// Program entry point — provide the provider layer at the edge (Chapter 32).
// Effect.runPromise(
//   chatLoop.pipe(
//     Effect.provide(ProductToolkitLayer),
//     Effect.provide(AnthropicLanguageModel.model("claude-opus-4-5")),
//     Effect.provide(AnthropicClient.layerConfig({ apiKey: Config.redacted("ANTHROPIC_API_KEY") }))
//   )
// )
```

Source references: `repos/effect/packages/ai/ai/src/Chat.ts:327-442`, `repos/effect/packages/ai/ai/src/Tool.ts:82-120`, `repos/effect/packages/ai/ai/src/Toolkit.ts:111-152`, `repos/effect/packages/ai/ai/src/LanguageModel.ts:142-152`, `repos/effect/packages/effect/src/Supervisor.ts:141`.

---

## Variations

**Streaming to stdout token by token.** Pipe `LanguageModel.streamText` through `Stream.filter((p) => p.type === "text-delta")` and write each delta to `process.stdout`.

```ts
import { LanguageModel } from "@effect/ai"
import { Effect, Stream } from "effect"

const streamToStdout = LanguageModel.streamText({ prompt: "Tell me a story" }).pipe(
  Stream.filter((p) => p.type === "text-delta"),
  Stream.runForEach((p) =>
    p.type === "text-delta"
      ? Effect.sync(() => process.stdout.write(p.delta))
      : Effect.void
  )
)
```

**Structured output with Schema.** Use `LanguageModel.generateObject` to force the model to return a value that decodes against a `Schema`. The abstract layer validates and decodes; a `MalformedOutput` error surfaces on decode failure.

```ts
import { LanguageModel } from "@effect/ai"
import { Effect, Schema } from "effect"

const SentimentSchema = Schema.Struct({
  label: Schema.Literal("positive", "negative", "neutral"),
  confidence: Schema.Number,
})

const classifySentiment = (text: string) =>
  LanguageModel.generateObject({
    prompt: `Classify the sentiment: "${text}"`,
    schema: SentimentSchema,
  }).pipe(Effect.map((r) => r.value))
```

**Batch embeddings for a document set.** Because `EmbeddingModel.make` uses `dataLoader`, firing `Effect.all([...], { concurrency: "unbounded" })` across a slice of documents is sufficient — the batching is transparent.

```ts
import { EmbeddingModel } from "@effect/ai"
import { Effect } from "effect"

const indexDocuments = (docs: ReadonlyArray<string>) =>
  Effect.gen(function* () {
    const embedder = yield* EmbeddingModel.EmbeddingModel
    const vectors = yield* Effect.all(
      docs.map((d) => embedder.embed(d)),
      { concurrency: "unbounded" }
    )
    return Array.from(vectors)
  })
```

**System prompt formatting.** Use `Prompt.make` with an array of messages to supply a system prompt alongside the user message, then pass the result directly to `generateText`.

```ts
import { LanguageModel, Prompt } from "@effect/ai"
import { Effect } from "effect"

const withSystemPrompt = (system: string, user: string) =>
  LanguageModel.generateText({
    prompt: Prompt.make([
      { role: "system", content: system },
      { role: "user", content: user },
    ]),
  })
```

**Telemetry annotation.** Wrap any generation call in `Effect.withSpan` with attributes. Provider adapters automatically add GenAI semantic-convention attributes; application-level spans add business context (see Chapter 33).

```ts
import { LanguageModel } from "@effect/ai"
import { Effect } from "effect"

const tracedGeneration = (userId: string, prompt: string) =>
  LanguageModel.generateText({ prompt }).pipe(
    Effect.withSpan("agent.generate", {
      attributes: { "user.id": userId, "prompt.length": prompt.length },
    })
  )
```

**Retry on rate limit with `Schedule`.** Compose `Effect.retry` with a `Schedule` that checks the `HttpResponseError` status code. See Chapter 34 for the full Schedule vocabulary.

```ts
import { AiError } from "@effect/ai"
import { Effect, Schedule } from "effect"

const isRateLimited = (e: AiError.AiError): boolean =>
  e._tag === "HttpResponseError" && e.response.status === 429

const withRateLimitRetry = <A, E extends AiError.AiError>(effect: Effect.Effect<A, E>) =>
  effect.pipe(
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.whileInput(isRateLimited),
        Schedule.upTo("60 seconds")
      )
    )
  )
```

---

## Anti-patterns

**Importing provider SDKs in business logic.**

```ts
// Wrong: couples every call site to a vendor
import Anthropic from "@anthropic-ai/sdk"

async function summarise(text: string): Promise<string> {
  const client = new Anthropic()
  const msg = await client.messages.create({
    model: "claude-opus-4-5",
    max_tokens: 512,
    messages: [{ role: "user", content: "Summarise: " + text }],
  })
  return msg.content[0].type === "text" ? msg.content[0].text : ""
}
```

```ts
// Correct: use the abstract LanguageModel tag; provide the layer at the edge
import { LanguageModel } from "@effect/ai"
import { Effect } from "effect"

const summarise = (text: string) =>
  LanguageModel.generateText({ prompt: "Summarise: " + text }).pipe(
    Effect.map((r) => r.text)
  )
```

**Untyped tool parameters.** Accepting tool inputs as `unknown` and casting loses the safety that `Tool.make` provides.

```ts
// Wrong: no schema means no decode, no type safety
const tools = [{
  name: "lookup",
  description: "look up a record",
  input_schema: { type: "object", properties: { id: { type: "string" } } },
}]
// handler receives unknown params — unsafe cast required
```

```ts
// Correct: schema-first tool with Tool.make from @effect/ai
import { Tool } from "@effect/ai"
import { Schema } from "effect"

const LookupRecord = Tool.make("LookupRecord", {
  description: "Look up a record by ID",
  parameters: { id: Schema.String },
  success: Schema.Struct({ name: Schema.String }),
})
// handler receives { id: string } — fully typed
```

**No tracing on AI calls.** LLM latency and token usage are invisible without spans. Chapter 33 adds provider-level auto-instrumentation, but application-level spans require `Effect.withSpan`.

```ts
// Wrong: no span — latency and errors invisible in your APM
const answer = yield* LanguageModel.generateText({ prompt: userQuestion })
```

```ts
// Correct: wrap with a span for full observability
const answer = yield* LanguageModel.generateText({ prompt: userQuestion }).pipe(
  Effect.withSpan("qa.answer", { attributes: { "question.length": userQuestion.length } })
)
```

**Running tool calls serially when they are independent.** The default `concurrency` for `generateText` when a toolkit is provided is sequential. If the model returns three tool calls that touch different services, pass `concurrency: "unbounded"` (or a number) to run them in parallel.

```ts
// Wrong: tool calls execute one at a time even when independent
yield* LanguageModel.generateText({ prompt, toolkit })

// Correct: run tool calls in parallel
yield* LanguageModel.generateText({ prompt, toolkit, concurrency: "unbounded" })
```

---

## See also

- [Chapter 09 — Layer](../part-1-foundations/09-layer.md): `Layer.provide` is the mechanism for wiring a provider into an `@effect/ai` program; every concept here builds on that.
- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md): `Tool.make` and `LanguageModel.generateObject` are Schema-first; `Schema.Struct`, `Schema.Literal`, and `Schema.decode` are the building blocks.
- [Chapter 15 — Schema part 2](../part-1-foundations/15-schema-part-2.md): refinements and transforms apply to tool parameter schemas and structured output schemas.
- [Chapter 16 — Stream](../part-1-foundations/16-stream.md): `LanguageModel.streamText` returns a `Stream<Response.StreamPart>`; all stream combinators from Chapter 16 compose directly.
- [Chapter 17 — Fibers and structured concurrency](../part-1-foundations/17-fibers-and-concurrency.md): `concurrency` in `generateText` forks one fiber per tool call; `Supervisor.track` observes them.
- [Chapter 32 — AI providers](32-ai-providers.md): the concrete `Layer` implementations for Anthropic, OpenAI, Google, Amazon Bedrock, and OpenRouter that satisfy the tags introduced here.
- [Chapter 33 — Observability with @effect/opentelemetry](33-opentelemetry.md): full tracing story for AI calls, including provider-level GenAI semantic convention spans.
- [Patterns catalog — Supervisor](../../research/02-patterns-catalog.md#supervisor--observe-and-react-to-fiber-lifecycle): when to use `Supervisor.track`, when not to, and the anti-pattern it replaces.
- [Per-package note — @effect/ai](../../research/packages/ai.md): source-level deep-dives into `ConstructorParams`, the annotations system, `ExtractError`/`ExtractContext`, and open questions around `BackingPersistence` and `McpServer`.

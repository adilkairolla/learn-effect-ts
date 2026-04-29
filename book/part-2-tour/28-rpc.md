# Chapter 28 — Type-safe RPC with @effect/rpc

> **Package(s):** `@effect/rpc`
> **Patterns introduced:** [`ConfigProvider.fromEnv` / `fromMap` / `fromJson`](../../research/02-patterns-catalog.md#configproviderfromenv--frommap--fromjson)
> **Reads from:** Chapter 14 (Schema part 1 — declaring shapes), Chapter 15 (Schema part 2 — transforms and refinements), Chapter 22 (platform — HttpServer and HttpClient)
> **Reads into:** Chapter 29 (durable workflows with @effect/workflow), Chapter 30 (distributed actors with @effect/cluster)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

In a TypeScript monorepo, you have a server process and a client process that need to communicate. You choose HTTP and write a handful of route handlers. Then comes the work that nobody puts in the project plan.

First, the client. You hand-write fetch wrappers that mirror the server routes. Every wrapper contains a URL string, a manually assembled JSON body, and a `JSON.parse` on the response. The TypeScript types live in two places: once as the server handler's parameter type, once as the return type you cast the parsed response to. The moment a field is renamed on the server, the client silently breaks — `tsc` never sees the mismatch because the two sides share only the wire format, not the type.

```ts
// Server — Express handler
app.post("/users/create", async (req, res) => {
  const { name, email } = req.body // unvalidated; could be anything
  const user = await db.create({ name, email })
  res.json(user)
})

// Client — hand-rolled fetch wrapper
async function createUser(name: string, email: string): Promise<User> {
  const resp = await fetch("/users/create", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, email })
  })
  return resp.json() as User // unsafe cast — no validation at runtime
}
```

Second, typed errors. Your domain has structured error types: `UserNotFound`, `DuplicateEmail`. On the server you throw them; Express catches everything and returns a 500. On the client you catch a generic `Error` object with a plain string message. The error channel between server and client is just "string or 500", regardless of how carefully you modelled errors in TypeScript.

Third, streaming. You want `listUsers` to return a stream of records rather than a batched array, to reduce time-to-first-byte. In plain HTTP this requires a separate `ReadableStream` or WebSocket setup. There is no way to express "this procedure returns a stream" in the same type system that describes the request shape — you diverge into a different API.

Fourth, testing. The server is an HTTP server; the client makes HTTP calls. Integration tests start a real server, or mock `fetch`, or use a test client with its own set of URL assumptions. None of these options re-use the same Schema you defined.

`@effect/rpc` eliminates all four problems from one set of definitions. The same `Schema` types describe the wire format on both sides. Errors are schema-encoded, not strings. A single `stream: true` flag turns a procedure into a streaming call. And `RpcTest.makeClient` wires server to client in memory, no HTTP required.

---

## The minimal example

Define one RPC, group it, serve it, call it — in 35 lines:

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import * as Rpc from "@effect/rpc/Rpc"
import * as RpcClient from "@effect/rpc/RpcClient"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import * as RpcSerialization from "@effect/rpc/RpcSerialization"
import * as RpcServer from "@effect/rpc/RpcServer"
import { Effect, Layer, Schema } from "effect"
import { createServer } from "node:http"

// 1. Define one procedure with Schema-typed request and response.
const Greet = Rpc.make("Greet", {
  payload: { name: Schema.String },
  success: Schema.String
})

// 2. Group it.
class GreetGroup extends RpcGroup.make(Greet) {}

// 3. Implement the handler and expose it over HTTP.
const GreetLive = GreetGroup.toLayer({
  Greet: ({ name }) => Effect.succeed(`Hello, ${name}!`)
})

const ServerLive = RpcServer.layerHttpRouter({ group: GreetGroup, path: "/rpc" }).pipe(
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)

// 4. Call it from the client.
const program = Effect.gen(function*() {
  const client = yield* RpcClient.make(GreetGroup)
  const result = yield* client.Greet({ name: "World" })
  console.log(result) // "Hello, World!"
})

NodeRuntime.runMain(program.pipe(
  Effect.provide(RpcClient.layerProtocolHttp({ url: "http://localhost:3000/rpc" })),
  Effect.provide(RpcSerialization.layerJson)
))
```

Both sides share `GreetGroup`. The Schema for `name` and the return type `String` live once and are used on both ends.

---

## Tour

### `Rpc.make` — defining a single procedure

`Rpc.make` is the smallest unit in `@effect/rpc`. It produces an immutable descriptor that carries all the metadata for one remote procedure: tag string, payload schema, success schema, error schema, and a `stream` flag.

```ts
// repos/effect/packages/rpc/src/Rpc.ts:644-696
export const make = <
  const Tag extends string,
  Payload extends Schema.Schema.Any | Schema.Struct.Fields = typeof Schema.Void,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never,
  const Stream extends boolean = false
>(tag: Tag, options?: {
  readonly payload?: Payload
  readonly success?: Success
  readonly error?: Error
  readonly stream?: Stream
  // ...
})
```

The `Rpc<Tag, Payload, Success, Error>` type carries four parameters:
- `Tag` — a string literal that identifies the procedure on the wire.
- `Payload` — either a `Schema.Struct.Fields` shorthand or a full `Schema.Schema`. The server calls `Schema.decodeUnknown(rpc.payloadSchema)` on incoming bytes (`repos/effect/packages/rpc/src/RpcServer.ts:563-580`).
- `Success` — the happy-path schema. When `stream: true` this is wrapped in `RpcSchema.Stream`, making it a `Stream<A, E>` on both sides.
- `Error` — a typed failure schema, encoded and decoded across the wire. This is how `UserNotFound` stays `UserNotFound` end-to-end.

The `stream: true` option is handled by wrapping the success schema in a `Schema.declare`-based sentinel (`repos/effect/packages/rpc/src/RpcSchema.ts:17-24`). The server detects this flag with `RpcSchema.isStreamSchema` and routes the call through `streamEffect` instead of a plain `Effect` handler. The client detects the same flag and returns a `Stream` rather than a single Effect. Every other layer of the stack — serialization, middleware, test mode — reads the same sentinel.

```ts
import { Rpc } from "@effect/rpc"
import { Schema } from "effect"

class UserNotFound extends Schema.TaggedError<UserNotFound>()("UserNotFound", {
  id: Schema.String
}) {}

// Unary RPC: Effect<User, UserNotFound>
const GetUser = Rpc.make("GetUser", {
  payload: { id: Schema.String },
  success: Schema.Struct({ id: Schema.String, name: Schema.String }),
  error: UserNotFound
})

// Streaming RPC: Stream<string, UserNotFound>
const StreamNames = Rpc.make("StreamNames", {
  payload: { prefix: Schema.String },
  success: Schema.String,
  error: UserNotFound,
  stream: true
})
```

### `RpcGroup.make` — grouping procedures

`RpcGroup.make` collects one or more `Rpc` descriptors into a named group (`repos/effect/packages/rpc/src/RpcGroup.ts:364-374`). The idiomatic consumer pattern is subclassing to get a nominal type:

```ts
import { Rpc, RpcGroup } from "@effect/rpc"
import { Schema } from "effect"

const AddTodo = Rpc.make("AddTodo", {
  payload: { text: Schema.String },
  success: Schema.Struct({ id: Schema.String, text: Schema.String })
})
const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(Schema.Struct({ id: Schema.String, text: Schema.String }))
})
const RemoveTodo = Rpc.make("RemoveTodo", {
  payload: { id: Schema.String }
})

// Subclass for a nominal type — a consumer convention, not an internal requirement.
class TodosGroup extends RpcGroup.make(AddTodo, ListTodos, RemoveTodo) {}
```

`RpcGroup` exposes three composition helpers on the interface (`repos/effect/packages/rpc/src/RpcGroup.ts:34-65`):
- `.add(...rpcs)` — append more procedures.
- `.merge(...groups)` — union two groups; useful when splitting a large API surface across files.
- `.middleware(M)` — attach a middleware to all procedures in the group at the point of the call.
- `.prefix("v1/")` — prepend a string to all tags, allowing versioned routing.

To turn a group into a server Layer you call `group.toLayer(handlers)`. The `handlers` object is a record keyed by each procedure's `_tag`, and each value is the implementation function. TypeScript infers the exact argument and return types from the schemas:

```ts
import { Effect } from "effect"

// handlers is fully typed — argument is inferred from payload schema,
// return type must be Effect<SuccessType, ErrorType, R>
const TodosLive = TodosGroup.toLayer({
  AddTodo: ({ text }) =>
    Effect.succeed({ id: crypto.randomUUID(), text }),
  ListTodos: () =>
    Effect.succeed([]),
  RemoveTodo: ({ id }) =>
    Effect.void
})
```

### Schema as the single source of truth

This is the defining architectural decision of `@effect/rpc`. When `Rpc.make` is called, the payload schema is stored on the descriptor. The server path calls `Schema.decodeUnknown(rpc.payloadSchema)` on the raw bytes before handing off to your handler (`repos/effect/packages/rpc/src/RpcServer.ts:563-580`). The client path calls `Schema.encode(rpc.payloadSchema)` before sending (`repos/effect/packages/rpc/src/RpcClient.ts:674-685`). The result schema follows the same pattern in reverse.

Chapters 14 and 15 covered `Schema.Struct`, `Schema.Class`, transforms, and refinements. Every schema you learned there works directly as a payload or success schema in `Rpc.make`. There is no adapter, no code-generation step, and no second type definition.

### `RpcServer.layer` and `layerHttpRouter`

`RpcServer.layer` is the core server runtime. It takes the group, wires handler layers to a `Protocol` service, manages per-client fiber sets, and propagates distributed traces (`repos/effect/packages/rpc/src/RpcServer.ts:736-752`):

```ts
export const layer = <Rpcs extends Rpc.Any>(
  group: RpcGroup.RpcGroup<Rpcs>,
  options?: { readonly concurrency?: number | "unbounded"; ... }
): Layer.Layer<never, never, Protocol | Rpc.ToHandler<Rpcs> | ...>
```

`Protocol` is a `Context.Tag` class (`repos/effect/packages/rpc/src/RpcServer.ts:793-813`) that abstracts the transport. Swapping HTTP for WebSockets or a Worker thread is done by swapping the `Protocol` layer only — the handler logic is unchanged.

`RpcServer.layerHttpRouter` is the convenience wrapper that composes `layer` with a protocol layer (`repos/effect/packages/rpc/src/RpcServer.ts:763-787`). It defaults to WebSocket transport for low-latency streaming and can be switched to plain HTTP:

```ts
import { RpcServer, RpcSerialization } from "@effect/rpc"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Layer } from "effect"
import { createServer } from "node:http"

const AppLive = RpcServer.layerHttpRouter({
  group: TodosGroup,
  path: "/todos",
  protocol: "http" // or "websocket" (default)
}).pipe(
  Layer.provide(TodosLive),
  Layer.provide(RpcSerialization.layerJson),
  Layer.provide(NodeHttpServer.layer(createServer, { port: 3000 }))
)
```

### `RpcClient.make` and `layerProtocolHttp`

`RpcClient.make` returns a typed proxy object whose methods mirror the group's tags. Effect-returning procedures return `Effect<Success, Error | RpcClientError>`. Stream procedures return `Stream<A, E | RpcClientError>`. There is no casting and no URL string:

```ts
import { RpcClient } from "@effect/rpc"

const program = Effect.gen(function*() {
  const client = yield* RpcClient.make(TodosGroup)

  // Fully typed: Effect<{ id: string; text: string }, RpcClientError>
  const todo = yield* client.AddTodo({ text: "buy milk" })

  // Fully typed: Effect<Array<{ id: string; text: string }>, RpcClientError>
  const todos = yield* client.ListTodos({})
})
```

`layerProtocolHttp` wires the client to an HTTP endpoint (`repos/effect/packages/rpc/src/RpcClient.ts:920-933`). `layerProtocolSocket` connects to a raw socket server with optional reconnect scheduling (`repos/effect/packages/rpc/src/RpcClient.ts:1249-1256`).

`withHeaders` and `withHeadersEffect` are dual functions for attaching request headers to a block of client calls — useful for passing auth tokens without threading them through every call site (`repos/effect/packages/rpc/src/RpcClient.ts:787-794`):

```ts
import { RpcClient } from "@effect/rpc"

// All calls inside this Effect block carry the Authorization header.
const authed = RpcClient.withHeaders(program, { Authorization: `Bearer ${token}` })
```

### Serialization

`RpcSerialization` is a context tag whose service describes `unsafeMake() => Parser`, `contentType`, and `includesFraming` (`repos/effect/packages/rpc/src/RpcSerialization.ts:14-18`). Four implementations ship out of the box:

- `layerJson` — `application/json`, one message per HTTP body.
- `layerNdjson` — newline-delimited JSON with framing, suitable for streaming over HTTP.
- `layerMsgPack` — MessagePack binary encoding (requires `msgpackr`).
- `layerJsonRpc` — JSON-RPC 2.0 envelope format.

Swapping wire format requires only swapping the serialization layer on both client and server. The handler code and client call code are unchanged.

### Middleware

`RpcMiddleware` lets you inject cross-cutting concerns — authentication, logging, rate limiting — that run before every handler in a group. A middleware tag is created with `RpcMiddleware.Tag` and declares what context it `provides` (so handlers can depend on it) and what errors it may fail with (`repos/effect/packages/rpc/src/RpcMiddleware.ts:98-116`).

```ts
import { RpcMiddleware } from "@effect/rpc"
import { Context, Effect, Schema } from "effect"

class AuthUser extends Context.Tag("AuthUser")<AuthUser, { userId: string }>() {}
class Unauthorized extends Schema.TaggedError<Unauthorized>()("Unauthorized", {}) {}

class AuthMiddleware extends RpcMiddleware.Tag<AuthMiddleware>()(
  "AuthMiddleware",
  { provides: AuthUser, failure: Unauthorized }
) {}

// Implement the middleware as a Layer.
const AuthMiddlewareLive = Layer.succeed(AuthMiddleware, (opts) =>
  Effect.gen(function*() {
    const token = opts.headers["authorization"]
    if (!token) return yield* Effect.fail(new Unauthorized())
    return { userId: "user-from-token" }
  })
)
```

Attach it to specific RPCs via `.pipe(Rpc.middleware(AuthMiddleware))` or to all RPCs in a group via `group.middleware(AuthMiddleware)`.

### `RpcTest.makeClient` — in-memory testing

`RpcTest.makeClient` wires the server's `makeNoSerialization` and the client's `makeNoSerialization` together in a single `Effect.gen` with no protocol layer and no serialization (`repos/effect/packages/rpc/src/RpcTest.ts:15-41`). This gives full type safety with zero network overhead:

```ts
import { RpcTest } from "@effect/rpc"
import { Effect } from "effect"

const test = Effect.gen(function*() {
  const client = yield* RpcTest.makeClient(TodosGroup)
  const todo = yield* client.AddTodo({ text: "test item" })
  const todos = yield* client.ListTodos({})
  console.assert(todos.length === 1)
}).pipe(Effect.provide(TodosLive))
```

### ConfigProvider — loading server configuration from the environment

`@effect/rpc` servers are typically deployed with runtime configuration: a port number, a base URL, an auth secret. The `ConfigProvider` pattern (introduced in this chapter) is how Effect reads configuration from the environment without scattering `process.env` reads throughout the code.

`ConfigProvider.fromEnv` is the production source (`repos/effect/packages/effect/src/ConfigProvider.ts:183`). It reads from `process.env` and is the default when you call `Effect.runPromise` — no explicit setup required.

`ConfigProvider.fromMap` creates an in-memory provider from a `Map<string, string>` (`repos/effect/packages/effect/src/ConfigProvider.ts:210-211`). It is the testing alternative to `process.env` mutation.

`ConfigProvider.fromJson` creates a provider from a structured JSON object (`repos/effect/packages/effect/src/ConfigProvider.ts:200`). Use it when configuration comes from a JSON file loaded at startup rather than flat environment variables.

```ts
import { Config, ConfigProvider, Effect, Layer, Schema } from "effect"

// Describe the server config as a Schema struct for documentation value.
class ServerConfig extends Schema.Class<ServerConfig>("ServerConfig")({
  port: Schema.NumberFromString,
  baseUrl: Schema.String,
  authSecret: Schema.String
}) {}

// Load it from the environment.
const loadConfig = Effect.all({
  port: Config.integer("PORT"),
  baseUrl: Config.string("BASE_URL"),
  authSecret: Config.string("AUTH_SECRET")
})

// Production: fromEnv() is the default; no Layer.setConfigProvider needed.
// Test: inject values without touching process.env.
const testConfigLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([
    ["PORT", "3000"],
    ["BASE_URL", "http://localhost:3000"],
    ["AUTH_SECRET", "test-secret"]
  ]))
)
```

Wire the config into the server layer:

```ts
import { RpcServer, RpcSerialization } from "@effect/rpc"
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import { Config, Effect, Layer } from "effect"
import { createServer } from "node:http"

const ServerFromEnv = Effect.gen(function*() {
  const port = yield* Config.integer("RPC_PORT")
  const serverLayer = RpcServer.layerHttpRouter({
    group: TodosGroup,
    path: "/todos"
  }).pipe(
    Layer.provide(TodosLive),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(NodeHttpServer.layer(createServer, { port }))
  )
  return serverLayer
}).pipe(Layer.unwrapEffect)

NodeRuntime.runMain(Layer.launch(ServerFromEnv))
```

In test, the layer is provided with `Layer.provide(testConfigLayer)` to inject a `ConfigProvider.fromMap(...)` that does not touch `process.env`. This pattern composes cleanly with the rest of the Effect stack and is explored further in Chapter 38 (Config and secrets — typed environment loading).

---

## A production example

A complete todos service: `RpcGroup` with three procedures, schema-typed errors, an in-memory store backed by a `Ref`, and a full server/client wiring. `ConfigProvider.fromMap` is used in the test layer to avoid `process.env` mutation.

```ts
import { NodeHttpServer, NodeRuntime } from "@effect/platform-node"
import * as Rpc from "@effect/rpc/Rpc"
import * as RpcClient from "@effect/rpc/RpcClient"
import * as RpcGroup from "@effect/rpc/RpcGroup"
import * as RpcSerialization from "@effect/rpc/RpcSerialization"
import * as RpcServer from "@effect/rpc/RpcServer"
import { Config, ConfigProvider, Effect, Layer, Ref, Schema } from "effect"
import { createServer } from "node:http"

// ---- Shared schemas --------------------------------------------------------

class TodoId extends Schema.String.pipe(Schema.brand("TodoId")) {}
class Todo extends Schema.Class<Todo>("Todo")({
  id: TodoId,
  text: Schema.String,
  done: Schema.Boolean
}) {}
class TodoNotFound extends Schema.TaggedError<TodoNotFound>()("TodoNotFound", {
  id: TodoId
}) {}

// ---- RPC definitions -------------------------------------------------------

const AddTodo = Rpc.make("AddTodo", {
  payload: { text: Schema.String },
  success: Todo
})
const ListTodos = Rpc.make("ListTodos", {
  success: Schema.Array(Todo)
})
const RemoveTodo = Rpc.make("RemoveTodo", {
  payload: { id: TodoId },
  error: TodoNotFound
})

class TodosGroup extends RpcGroup.make(AddTodo, ListTodos, RemoveTodo) {}

// ---- Server implementation -------------------------------------------------

const TodosLive = TodosGroup.toLayer({
  AddTodo: ({ text }) =>
    Effect.gen(function*() {
      const store = yield* TodoStore
      const id = TodoId.make(crypto.randomUUID())
      const todo = new Todo({ id, text, done: false })
      yield* Ref.update(store, (todos) => [...todos, todo])
      return todo
    }),

  ListTodos: () =>
    Effect.flatMap(TodoStore, Ref.get),

  RemoveTodo: ({ id }) =>
    Effect.gen(function*() {
      const store = yield* TodoStore
      const todos = yield* Ref.get(store)
      if (!todos.find((t) => t.id === id)) {
        return yield* Effect.fail(new TodoNotFound({ id }))
      }
      yield* Ref.update(store, (ts) => ts.filter((t) => t.id !== id))
    })
})

// In-memory store as a service.
class TodoStore extends Effect.Service<TodoStore>()("TodoStore", {
  effect: Ref.make<Array<Todo>>([])
}) {}

// ---- Server layer -----------------------------------------------------------

const ServerLayer = (port: number) =>
  RpcServer.layerHttpRouter({ group: TodosGroup, path: "/todos" }).pipe(
    Layer.provide(TodosLive),
    Layer.provide(TodoStore.Default),
    Layer.provide(RpcSerialization.layerJson),
    Layer.provide(NodeHttpServer.layer(createServer, { port }))
  )

const ServerFromEnv = Effect.gen(function*() {
  const port = yield* Config.integer("RPC_PORT")
  return ServerLayer(port)
}).pipe(Layer.unwrapEffect)

// ---- Client ----------------------------------------------------------------

const clientProgram = Effect.gen(function*() {
  const client = yield* RpcClient.make(TodosGroup)
  const todo = yield* client.AddTodo({ text: "buy milk" })
  const todos = yield* client.ListTodos({})
  console.log(todos)
  yield* client.RemoveTodo({ id: todo.id })
})

// ---- Testing with ConfigProvider.fromMap -----------------------------------

const testLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([["RPC_PORT", "3001"]]))
)

// In a test: Effect.provide(program, testLayer) — no process.env mutation.

// ---- Production entry point ------------------------------------------------

NodeRuntime.runMain(Layer.launch(ServerFromEnv.pipe(Layer.provide(testLayer))))
```

The client is end-to-end type safe: `client.RemoveTodo({ id: todo.id })` only compiles because `todo.id` is a `TodoId` brand. Passing a plain `string` is a compile error. `TodoNotFound` propagates through the error channel as a schema-encoded value, not as an untyped 404.

---

## Variations

**WebSocket transport (server).** Replace `protocol: "http"` with the default (omit the option, which defaults to WebSocket) in `layerHttpRouter`. The client must use `layerProtocolSocket` backed by a WebSocket connection.

```ts
import { RpcServer } from "@effect/rpc"

// Server: WebSocket (default)
const wsServerLayer = RpcServer.layerHttpRouter({ group: TodosGroup, path: "/todos" })
```

**NDJSON streaming.** Replace `RpcSerialization.layerJson` with `RpcSerialization.layerNdjson` on both server and client. NDJSON includes framing so stream chunks are delimited by newlines, which is necessary for stream-over-HTTP.

```ts
import { RpcSerialization } from "@effect/rpc"

Layer.provide(RpcSerialization.layerNdjson) // both sides
```

**Streaming RPC.** Set `stream: true` in `Rpc.make`. The handler returns a `Stream<A, E>` and the client receives a `Stream<A, E | RpcClientError>`.

```ts
import { Rpc } from "@effect/rpc"
import { Schema, Stream } from "effect"

const StreamEvents = Rpc.make("StreamEvents", {
  payload: { topic: Schema.String },
  success: Schema.String,
  stream: true
})
// Handler: ({ topic }) => Stream.fromIterable(["a", "b", "c"])
// Client: client.StreamEvents({ topic: "x" }) // => Stream<string, RpcClientError>
```

**Worker thread transport.** The client uses `layerProtocolWorker` to pool workers; the server uses `layerProtocolWorkerRunner` on the worker side. No HTTP server is needed; useful for offloading CPU work to threads.

```ts
import { RpcClient } from "@effect/rpc"

const workerClientLayer = RpcClient.layerProtocolWorker({ size: 4 })
```

**Shared schemas across packages.** Define `TodosGroup` and all schemas in a dedicated `@myapp/rpc-contract` package. Both the server package and the client package depend on it. Zero duplication; a single rename refactors both sides simultaneously.

**`RpcTest.makeClient` for unit tests.** Wire server and client in memory, provide handler layers directly, and run assertions without network.

```ts
import { RpcTest } from "@effect/rpc"
import { Effect } from "effect"

const test = Effect.gen(function*() {
  const client = yield* RpcTest.makeClient(TodosGroup)
  const todo = yield* client.AddTodo({ text: "test" })
  assert.strictEqual(todo.text, "test")
}).pipe(Effect.provide(TodosLive), Effect.provide(TodoStore.Default))
```

---

## Anti-patterns

**Hand-rolling HTTP routes to replicate what `@effect/rpc` provides.**

```ts
// Wrong: manual route mirroring — types drift on every rename
app.post("/todos/add", async (req, res) => {
  const { text } = req.body as { text: string } // no validation
  const todo = await addTodo(text)
  res.json(todo)
})

async function addTodo(text: string): Promise<Todo> {
  const resp = await fetch("/todos/add", {
    method: "POST",
    body: JSON.stringify({ text }),
    headers: { "Content-Type": "application/json" }
  })
  return resp.json() as Todo // unsafe cast
}
```

```ts
// Correct: define once, derive both sides
const AddTodo = Rpc.make("AddTodo", {
  payload: { text: Schema.String },
  success: Todo
})
class TodosGroup extends RpcGroup.make(AddTodo) {}
// Server handler + client call derived from the same descriptor.
```

**Throwing untyped errors across the RPC boundary.**

```ts
// Wrong: generic 500 swallows domain errors
app.post("/todos/remove", async (req, res) => {
  const todo = await findTodo(req.body.id)
  if (!todo) throw new Error("not found") // becomes a 500 string
  // ...
})
```

```ts
// Correct: schema-encode the error so the client receives a typed value
const RemoveTodo = Rpc.make("RemoveTodo", {
  payload: { id: TodoId },
  error: TodoNotFound // encoded and decoded across the wire
})
```

**Using `process.env` directly in tests instead of `ConfigProvider.fromMap`.**

```ts
// Wrong: mutates global state; tests can bleed into each other
process.env.RPC_PORT = "3001"
```

```ts
// Correct: inject a scoped provider without touching the environment
const testLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([["RPC_PORT", "3001"]]))
)
await Effect.runPromise(myTest.pipe(Effect.provide(testLayer)))
```

**Using `JSON.stringify`/`JSON.parse` directly for the wire format.**

```ts
// Wrong: bypasses Schema validation; no type inference; silently accepts garbage
const body = JSON.parse(await req.text()) as MyPayload
```

```ts
// Correct: let @effect/rpc and Schema handle encoding/decoding
// RpcServer calls Schema.decodeUnknown(rpc.payloadSchema) before your handler runs.
// You receive a fully validated, type-safe payload.
```

---

## See also

- [Chapter 14 (Schema part 1 — declaring shapes with `Struct`, `Class`, and `TaggedClass`)](../part-1-foundations/14-schema-part-1.md) — `Schema.Struct` and `Schema.Class` are the building blocks of every payload and success schema in `Rpc.make`.
- [Chapter 15 (Schema part 2 — transforms, refinements, and brand integration)](../part-1-foundations/15-schema-part-2.md) — `Schema.brand` and `Schema.filter` produce branded types like `TodoId` that enforce type safety at RPC call sites.
- [Chapter 22 (platform services — the abstract runtime layer)](./22-platform.md) — `@effect/rpc` builds on `@effect/platform`'s `HttpClient`, `HttpRouter`, `SocketServer`, and `WorkerRunner` to implement its transport adapters.
- [Chapter 29 (durable workflows with @effect/workflow)](./29-workflow.md) — `@effect/workflow` builds on `@effect/rpc` to express durable execution steps; understanding `RpcGroup` and `RpcClient` is required reading before Chapter 29.
- [Chapter 30 (distributed actors with @effect/cluster)](./30-cluster.md) — `@effect/cluster` uses RPC as the messaging substrate for its actor model; `RpcGroup` definitions are the contract between cluster nodes.
- [Patterns catalog — `ConfigProvider.fromEnv` / `fromMap` / `fromJson`](../../research/02-patterns-catalog.md#configproviderfromenv--frommap--fromjson) — full reference for all three constructor variants with when-to-use and anti-pattern notes.
- [Chapter 38 (Config and secrets — typed environment loading)](./38-config-and-secrets.md) — deeper coverage of `Config.integer`, `Config.redacted`, and composing config providers for production deployments.
- [Per-package note: `@effect/rpc`](../../research/packages/rpc.md) — comprehensive technical notes on the package's internal design, open questions, and "if you were authoring something similar" guidance.

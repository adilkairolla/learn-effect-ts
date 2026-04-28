# Cheatsheet

> One-page reference. Skim this before opening a chapter.
> Full pattern documentation: [Patterns Catalog](../research/02-patterns-catalog.md)

---

## Effect.gen + yield\*

```ts
import { Effect, Context } from "effect"

class UserRepo extends Context.Tag("UserRepo")<UserRepo, { find: (id: string) => Effect.Effect<User> }>() {}

const program = Effect.gen(function* () {
  const repo = yield* UserRepo
  const user = yield* repo.find("u1")
  yield* Effect.logInfo("found user", { id: user.id })
  return user
})
```

## Effect constructors

```ts
import { Effect } from "effect"

// lift a pure value
const a = Effect.succeed(42)

// typed failure
const b = Effect.fail(new Error("oops"))

// wrap a synchronous thunk (may throw)
const c = Effect.sync(() => JSON.parse(rawJson))

// wrap a Promise that can reject — map the error to a tagged type
const d = Effect.tryPromise({
  try: (signal) => fetch("/api/data", { signal }).then((r) => r.json()),
  catch: (e) => new FetchError({ message: String(e) }),
})
```

## Effect.runPromise / runSync / runFork

```ts
import { Effect } from "effect"

// "end of the world" — call only at the application entry point
await Effect.runPromise(program)               // Promise<A> (throws on failure)
const value = Effect.runSync(pureProgram)       // A (throws on async or failure)
const fiber = Effect.runFork(backgroundProgram) // Fiber — manage lifecycle manually
```

## Layer.succeed / .effect / .scoped

```ts
import { Effect, Layer } from "effect"
import { Database, DatabaseTag } from "./Database"

// constant value — no async, no cleanup
const DatabaseTest = Layer.succeed(DatabaseTag, { query: () => Effect.succeed([]) })

// effectful acquisition — async, no cleanup
const DatabaseLive = Layer.effect(
  DatabaseTag,
  Effect.gen(function* () {
    const cfg = yield* DatabaseConfig
    return yield* connect(cfg)
  }),
)

// scoped — async acquisition + guaranteed cleanup
const DatabasePool = Layer.scoped(
  DatabaseTag,
  Effect.acquireRelease(
    openPool(config),
    (pool) => pool.close(),
  ),
)
```

## Layer composition (merge / provide)

```ts
import { Layer } from "effect"

// side-by-side: both services provided
const AppLayer = Layer.merge(DatabasePool, CacheLive)

// wire upstream into downstream requirements
const FullLayer = Layer.provide(AppLayer, ConfigLive)

// provide at the Effect level
const result = program.pipe(Effect.provide(FullLayer))
```

## Effect.Service

```ts
import { Effect } from "effect"

class Mailer extends Effect.Service<Mailer>()("Mailer", {
  effect: Effect.gen(function* () {
    const cfg = yield* MailConfig
    return {
      send: (to: string, body: string) =>
        Effect.tryPromise({
          try: () => smtp.send({ to, body }),
          catch: (e) => new MailError({ cause: e }),
        }),
    }
  }),
}) {}

// Mailer.Default is the Layer; use Mailer directly as a Tag
const program = Effect.gen(function* () {
  const mailer = yield* Mailer
  yield* mailer.send("alice@example.com", "Hello")
})
```

## Typed errors — Data.TaggedError + catchTag

```ts
import { Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}
class Forbidden extends Data.TaggedError("Forbidden")<{ reason: string }> {}

const getUser = (id: string): Effect.Effect<User, NotFound | Forbidden> =>
  Effect.gen(function* () {
    const user = yield* db.findUser(id)
    if (!user) yield* new NotFound({ id })
    return user
  })

// recover from one tag, let others propagate
const withFallback = getUser("u1").pipe(
  Effect.catchTag("NotFound", () => Effect.succeed(guestUser)),
)

// recover from multiple tags at once
const safe = getUser("u1").pipe(
  Effect.catchTags({
    NotFound: () => Effect.succeed(guestUser),
    Forbidden: (e) => Effect.fail(new AuditError({ reason: e.reason })),
  }),
)
```

## Schema — Struct + brand + decode

```ts
import { Schema } from "effect"

const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = Schema.Schema.Type<typeof UserId>

const User = Schema.Struct({
  id: UserId,
  name: Schema.NonEmptyString,
  age: Schema.Number.pipe(Schema.int(), Schema.positive()),
})
type User = Schema.Schema.Type<typeof User>

// decode at an API boundary — returns Effect<User, ParseError>
const parseUser = Schema.decodeUnknown(User)
const user = yield* parseUser(requestBody)
```

## Schema.transform / transformOrFail

```ts
import { Schema, ParseResult } from "effect"

// pure bijection — ISO string ↔ Date object
const DateFromString = Schema.String.pipe(
  Schema.transform(Schema.DateFromSelf, {
    decode: (s) => new Date(s),
    encode: (d) => d.toISOString(),
  }),
)

// fallible decode
const PositiveInt = Schema.Number.pipe(
  Schema.transformOrFail(Schema.Number, {
    decode: (n, _, ast) =>
      n > 0
        ? ParseResult.succeed(n)
        : ParseResult.fail(new ParseResult.Type(ast, n, "must be positive")),
    encode: ParseResult.succeed,
  }),
)
```

## Stream basics

```ts
import { Stream, Effect } from "effect"

// from a static iterable
const s1 = Stream.fromIterable([1, 2, 3]).pipe(
  Stream.map((n) => n * 2),
  Stream.filter((n) => n > 2),
)
const result = yield* Stream.runCollect(s1)  // Chunk<number>

// paginated source — Option.some(cursor) continues, Option.none() stops
const pages = Stream.paginate(0, (page) => [
  fetchPage(page),
  page < totalPages ? Option.some(page + 1) : Option.none(),
])

// push-based / event-driven
const ws = Stream.asyncPush<string>((emit) =>
  Effect.gen(function* () {
    const socket = yield* openSocket(url)
    socket.on("message", (msg) => emit.single(msg))
    socket.on("close", () => emit.end())
  }),
)
```

## Effect.fork + Fiber.join

```ts
import { Effect, Fiber } from "effect"

const program = Effect.gen(function* () {
  // start a background fiber — scoped to this fiber
  const fiber = yield* Effect.fork(heavyComputation)

  // do other work while it runs
  yield* doOtherWork

  // await result (re-raises any error)
  const result = yield* Fiber.join(fiber)
  return result
})

// cancel a fiber
yield* Fiber.interrupt(fiber)
```

## acquireRelease + Effect.scoped

```ts
import { Effect } from "effect"

const withFile = (path: string) =>
  Effect.acquireRelease(
    Effect.sync(() => fs.openSync(path, "r")),   // acquire
    (fd) => Effect.sync(() => fs.closeSync(fd)), // release — runs on success, failure, interrupt
  )

const program = Effect.scoped(
  Effect.gen(function* () {
    const fd = yield* withFile("./data.txt")
    return yield* readAll(fd)
  }),
)
// scope closes here → fd is closed automatically
```

## Schedule + Effect.retry / repeat

```ts
import { Effect, Schedule } from "effect"

// exponential backoff with jitter, max 5 retries
const retryPolicy = Schedule.exponential("100 millis").pipe(
  Schedule.jittered,
  Schedule.compose(Schedule.recurs(5)),
)

const resilient = fetchData.pipe(Effect.retry(retryPolicy))

// heartbeat — repeat every 30 seconds
const heartbeat = ping.pipe(Effect.repeat(Schedule.spaced("30 seconds")))
```

## Match.value / Match.tags

```ts
import { Match } from "effect"

type Shape = { _tag: "Circle"; radius: number } | { _tag: "Square"; side: number }

const area = (shape: Shape): number =>
  Match.value(shape).pipe(
    Match.when({ _tag: "Circle" }, (s) => Math.PI * s.radius ** 2),
    Match.when({ _tag: "Square" }, (s) => s.side ** 2),
    Match.exhaustive, // compile error if a variant is unhandled
  )
```

## Config.string + nested

```ts
import { Config, Effect } from "effect"

const DbConfig = Config.all({
  host: Config.string("HOST"),
  port: Config.integer("PORT"),
  password: Config.redacted("PASSWORD"),
}).pipe(Config.nested("DATABASE"))
// reads DATABASE_HOST, DATABASE_PORT, DATABASE_PASSWORD from env

const program = Effect.gen(function* () {
  const cfg = yield* DbConfig
  // cfg.host, cfg.port, cfg.password
})

// in tests — inject without touching process.env
import { ConfigProvider, Layer } from "effect"
const TestConfig = Layer.setConfigProvider(
  ConfigProvider.fromMap(new Map([["DATABASE_HOST", "localhost"], ["DATABASE_PORT", "5432"]])),
)
```

## Ref + concurrency

```ts
import { Effect, Ref } from "effect"

const counter = Effect.gen(function* () {
  const ref = yield* Ref.make(0)

  yield* Effect.all(
    Array.from({ length: 100 }, () => Ref.update(ref, (n) => n + 1)),
    { concurrency: "unbounded" },
  )

  return yield* Ref.get(ref) // 100 — atomic, no race
})
```

---

## Patterns index

| Pattern | Where to read |
|---------|---------------|
| `Effect.gen` + `yield*` | [Ch. 05](part-1-foundations/05-effect-gen.md) · [Catalog](../research/02-patterns-catalog.md#effectgen--yield) |
| `Effect.succeed` / `fail` / `sync` / `tryPromise` | [Ch. 02](part-1-foundations/02-effect-as-a-value.md) · [Catalog](../research/02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) |
| `Effect.runPromise` / `runSync` / `runFork` | [Ch. 03](part-1-foundations/03-running-effects.md) · [Catalog](../research/02-patterns-catalog.md#effectrunpromise--runsync--runfork) |
| `Layer.succeed` / `effect` / `scoped` | [Ch. 09](part-1-foundations/09-layer.md) · [Catalog](../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) |
| `Layer.merge` / `provide` | [Ch. 09](part-1-foundations/09-layer.md) · [Catalog](../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) |
| `Effect.Service` class | [Ch. 08](part-1-foundations/08-context-and-tags.md) · [Catalog](../research/02-patterns-catalog.md#effectservice-class) |
| `Data.TaggedError` | [Ch. 06](part-1-foundations/06-typed-errors.md) · [Catalog](../research/02-patterns-catalog.md#datataggederror) |
| `Effect.catchTag` / `catchTags` | [Ch. 06](part-1-foundations/06-typed-errors.md) · [Catalog](../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling) |
| `Schema.Struct` + brand | [Ch. 14](part-1-foundations/14-schema-part-1.md) · [Catalog](../research/02-patterns-catalog.md#schemastruct) |
| `Schema.brand` / `filter` | [Ch. 15](part-1-foundations/15-schema-part-2.md) · [Catalog](../research/02-patterns-catalog.md#schemabrand--filter--constraints) |
| `Schema.transform` / `transformOrFail` | [Ch. 15](part-1-foundations/15-schema-part-2.md) · [Catalog](../research/02-patterns-catalog.md#schematransform--transformorfail) |
| `Schema.decodeUnknown` | [Ch. 14](part-1-foundations/14-schema-part-1.md) · [Catalog](../research/02-patterns-catalog.md#schemadecode--encode--is-entry-points) |
| `Stream.fromIterable` / `asyncPush` / `paginate` | [Ch. 16](part-1-foundations/16-stream.md) · [Catalog](../research/02-patterns-catalog.md#streammake--fromiterable--fromeffect) |
| `Effect.fork` / `Fiber.join` / `interrupt` | [Ch. 17](part-1-foundations/17-fibers-and-concurrency.md) · [Catalog](../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin) |
| `Effect.acquireRelease` + `Effect.scoped` | [Ch. 10](part-1-foundations/10-layer-scoped-and-scope.md) · [Catalog](../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease) |
| `Schedule.exponential` / `jittered` / `recurs` | [Ch. 34](part-2-packages/34-schedule.md) · [Catalog](../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) |
| `Match.value` / `Match.exhaustive` | [Ch. 39](part-2-packages/39-match.md) · [Catalog](../research/02-patterns-catalog.md#matchvalue--matchtype--starting-a-match) |
| `Config.string` / `nested` / `Config.all` | [Ch. 38](part-2-packages/38-config-and-secrets.md) · [Catalog](../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all) |
| `Ref.make` / `update` / `get` | [Ch. 36](part-2-packages/36-concurrency-primitives.md) · [Catalog](../research/02-patterns-catalog.md#ref--atomic-mutable-cell) |

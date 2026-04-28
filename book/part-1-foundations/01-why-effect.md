# Chapter 01 — Why Effect: the problem with Promise, throw, and async

> **Patterns introduced:** [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors)
> **Reads from:** (nothing — this is the opener)
> **Reads into:** Chapter 02 (Effect as a value), and every subsequent chapter
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

TypeScript is an excellent language for describing the shapes of data. It is a much weaker language for describing the shapes of programs — what a function can fail with, what services it depends on, what resources it holds. Three specific gaps show up in every serious TypeScript codebase. Effect closes all three.

### Untyped errors

In TypeScript, the error channel of an async function is invisible to the type system. Consider:

```ts
async function getUser(id: string): Promise<User> {
  const row = await db.query("SELECT * FROM users WHERE id = $1", [id])
  if (!row) throw new NotFoundError(id)
  return parseUser(row)
}
```

The return type is `Promise<User>`. What it does not say — cannot say, in plain TypeScript — is that this function might throw `NotFoundError`, or that `parseUser` might throw a `ValidationError`, or that `db.query` might throw a `DatabaseConnectionError`. The only way a caller discovers these possibilities is by reading the implementation, the tests, or the production incident report.

A `try/catch` block catches `unknown`. You can narrow it:

```ts
try {
  const user = await getUser(id)
} catch (e) {
  if (e instanceof NotFoundError) { /* ... */ }
  // But what about ValidationError? DatabaseConnectionError?
  // You don't know unless you read the source.
}
```

The deeper problem is additive: if a new throw site is added anywhere in `getUser`'s call stack, every single call site silently changes behavior. There is no compile-time feedback that a new failure mode was introduced. In a large codebase, this is not a theoretical concern — it is the default experience.

### Implicit dependencies

Functions that reach into the environment without declaring it in their signature are a testing and refactoring trap:

```ts
async function sendWelcomeEmail(userId: string): Promise<void> {
  const apiKey = process.env.SENDGRID_API_KEY  // grabbed from global env
  const user = await db.query(...)              // db is a module-level singleton
  await fetch(`https://api.sendgrid.com/v3/mail/send`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ to: user.email, ... })
  })
}
```

The function signature says `(userId: string) => Promise<void>`. It does not say "requires a database connection, a SendGrid API key, and a live network". You discover those requirements at test time, when you have to mock `process.env`, mock `db`, and mock `fetch` — three different patching mechanisms for three different global singletons.

DI frameworks like InversifyJS can help, but they bolt on at runtime. A function decorated with `@inject(DatabaseService)` still returns `Promise<void>` — the injected dependency never appears in the TypeScript type. The type system cannot tell you that `sendWelcomeEmail` requires a `Database` service; only the decorator metadata can, and only at runtime.

### Resource and concurrency leaks

JavaScript's concurrency model makes resource cleanup genuinely difficult:

```ts
async function fetchAllUsers(ids: string[]): Promise<User[]> {
  return Promise.all(ids.map(id => fetchUser(id)))
}
```

If the third request succeeds but the fifth throws, `Promise.all` rejects immediately. The other in-flight requests are not cancelled. There is no mechanism to cancel a `Promise` that has already started — they run to completion (or their own error), consuming network connections, database cursors, and CPU cycles that you may have intended to release.

The same problem appears with cleanup on error:

```ts
function startHeartbeat(): NodeJS.Timer {
  const timer = setInterval(() => ping(), 5000)
  return timer
}

async function runSession(): Promise<void> {
  const timer = startHeartbeat()
  try {
    await doWork()
  } finally {
    clearInterval(timer)  // fine if you remember
  }
}
```

This works for the synchronous path. But what if `doWork()` spawns a concurrent operation — a `setTimeout` or an unawaited `Promise` — that outlives the `finally` block? The `clearInterval` runs while the orphaned work is still in flight, and that work proceeds without the resource it was relying on. What if a new developer adds an early return? The `clearInterval` call is orphaned. In plain TypeScript, resource ownership is a social contract enforced by code review, not by the type system.

These are not nice-to-haves. They are gaps in the platform's ability to represent programs accurately.

---

## The minimal example

Here is the simplest Effect program:

```ts
import { Effect } from "effect"

// Plain TypeScript equivalent: const greet = (name: string) => `Hello, ${name}!`
const greet = (name: string): Effect.Effect<string> =>
  Effect.succeed(`Hello, ${name}!`)

// Run it at the edge of your program
Effect.runPromise(greet("World")).then(console.log)
// => Hello, World!
```

The type `Effect.Effect<string>` is a description of a computation that will produce a `string` when run. Nothing has executed yet. `Effect.succeed` lifts a pure value into that description. `Effect.runPromise` is the edge of the world — it converts the description into a running `Promise`.

This looks like more ceremony for a trivial case, and that is true. The payoff comes when the computation can fail, needs services, or holds resources — which is every real function you will ever write.

---

## How it works

### Typed errors flow through the type system

`Effect.Effect<A, E, R>` has three type parameters. The first, `A`, is the success type. The second, `E`, is the error type. The third, `R`, is the required environment (dependencies).

```ts
// repos/effect/packages/effect/src/Effect.ts:111
export interface Effect<out A, out E = never, out R = never>
  extends Effect.Variance<A, E, R>, Pipeable { ... }
```

When a function can fail with a `NotFoundError`, that appears in the type:

```ts
import { Effect, Data } from "effect"

class NotFoundError extends Data.TaggedError("NotFoundError")<{ id: string }> {}

declare function getUser(id: string): Effect.Effect<User, NotFoundError>
//                                                        ^^^^^^^^^^^^
//                                    the compiler knows this can fail
```

Every transformation you apply carries the error type forward. If you chain two operations — one that can fail with `NotFoundError` and one that can fail with `ValidationError` — the combined type becomes `Effect.Effect<Result, NotFoundError | ValidationError>`. No new throw site can be added silently. The type system enforces that every caller either handles or propagates every documented failure mode. The full typed-error story is in Chapter 06.

### Dependencies appear in the type signature via the `R` slot

The third type parameter, `R`, tracks what services a computation requires. A function that needs a database connection is not `(id: string) => Promise<User>` — it is:

```ts
declare function getUser(id: string): Effect.Effect<User, DatabaseError, DatabaseService>
//                                                                        ^^^^^^^^^^^^^^^
//                                    type-checked proof that this needs a database
```

Before the Effect can run, `DatabaseService` must be provided. The compiler enforces this: calling `Effect.runPromise` on an `Effect<User, DatabaseError, DatabaseService>` is a type error unless you first provide the service. Unsatisfied dependencies are a compile-time failure, not a runtime surprise. The dependency injection story is in Chapter 08.

### Resources and fibers are first-class with structured lifetimes

Effect's concurrency model is built on fibers — lightweight, structured threads. When you run operations concurrently, Effect tracks them as a tree. If a parent fiber is interrupted, all child fibers are interrupted too. If a concurrent operation fails, its siblings are interrupted before the failure propagates. Resources acquired inside a `Scope` are released when the scope closes, whether by success, failure, or interruption.

```ts
import { Effect } from "effect"

// Describes a scoped resource acquisition; the connection is opened when
// the effect runs and closed automatically when the surrounding Scope ends.
const withDatabase = Effect.acquireRelease(
  openConnection(),          // acquire
  (conn) => closeConnection(conn)  // release — always runs
)
```

No try/finally, no forgotten cleanup. The structure of the code guarantees the structure of resource lifetimes. Chapter 10 (Layer.scoped and Scope) covers the full mechanics of how `Scope` drives acquisition and release. The full resource and fiber story is in Chapters 10 and 17.

### The `.make` constructor pattern

Across Effect's entire module surface, the name `.make` signals "build a new instance of this type using the canonical constructor". It is the first pattern in the catalog ([Patterns Catalog: `.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors)) and the one you will encounter within your first hour with any Effect API.

Three examples from real Effect source:

**`Context.make`** — build a typed service context from a tag and a value (`repos/effect/packages/effect/src/Context.ts:290`):

```ts
import { Context } from "effect"

const DatabaseTag = Context.GenericTag<Database>("Database")
const ctx = Context.make(DatabaseTag, myDatabaseImpl)
// ctx: Context<Database>
```

**`Ref.make`** — create an atomic mutable cell (`repos/effect/packages/effect/src/Ref.ts:69`):

```ts
import { Ref, Effect } from "effect"

const program = Effect.gen(function* () {
  const counter = yield* Ref.make(0)
  yield* Ref.update(counter, (n) => n + 1)
  return yield* Ref.get(counter)
})
```

`Ref.make(0)` returns an `Effect.Effect<Ref<number>>` — creating the ref is itself an effect so it is lazy and safe to compose.

**`ManagedRuntime.make`** — build a pre-wired runtime from a layer (`repos/effect/packages/effect/src/ManagedRuntime.ts:177-180`):

```ts
import { ManagedRuntime } from "effect"

const runtime = ManagedRuntime.make(AppLayer)
await runtime.runPromise(myProgram)
await runtime.dispose()
```

The pattern is consistent enough that once you know to look for `.make`, you will find it in `Effect.makeSemaphore`, `Logger.make`, `Pool.make`, `Scope.make`, `Deferred.make`, and every other module that needs a canonical primary constructor.

---

## A production example

Here is a small but realistic program: fetch a user by ID, validate the response shape with a schema, and return a typed result. It shows how the three type parameters work together and introduces a schema class with a `.make` constructor.

```ts
import { Effect, Schema, Data, ParseResult } from "effect"

// Schema.Class gives us a validated constructor
// We'll cover Schema fully in Chapter 14
class User extends Schema.Class<User>("User")({
  id: Schema.String,
  name: Schema.String,
  email: Schema.String
}) {}

// Typed errors — full story in Chapter 06
class FetchError extends Data.TaggedError("FetchError")<{
  url: string
  status: number
}> {}

class BadResponseShape extends Data.TaggedError("BadResponseShape")<{
  message: string
}> {}

// Effect.Effect<User, FetchError | BadResponseShape>
// Note: no R slot (no services required yet — we'll add that in Chapter 08)
const fetchUser = (id: string): Effect.Effect<User, FetchError | BadResponseShape> =>
  Effect.gen(function* () {
    const response = yield* Effect.tryPromise({
      try: () => fetch(`https://api.example.com/users/${id}`),
      catch: (e) => new FetchError({ url: `/users/${id}`, status: 0 })
    })

    if (!response.ok) {
      yield* Effect.fail(
        new FetchError({ url: `/users/${id}`, status: response.status })
      )
    }

    const json = yield* Effect.tryPromise({
      try: () => response.json(),
      catch: (e) => new BadResponseShape({ message: String(e) })
    })

    // Schema.decodeUnknown returns Effect<User, ParseResult.ParseError, never>
    // We'll cover Schema.decode in Chapter 14
    return yield* Schema.decodeUnknown(User)(json).pipe(
      Effect.mapError((e) => new BadResponseShape({ message: ParseResult.TreeFormatter.formatErrorSync(e) }))
    )
  })

// At the edge of the world
Effect.runPromise(fetchUser("abc-123")).then(
  (user) => console.log("Got user:", user.name),
  (error) => console.error("Failed:", error)
)
```

Notice what the type of `fetchUser` communicates without any prose documentation: it produces a `User`, it can fail with either a `FetchError` or a `BadResponseShape`, and it requires no external services. Every one of those facts is checked at compile time.

---

## Variations

The `.make` pattern appears across the full Effect module surface. Here is a survey of the most common sites:

**`Chunk.make`** — create a typed immutable array from variadic arguments (`repos/effect/packages/effect/src/Chunk.ts:233`):

```ts
import { Chunk } from "effect"
const c = Chunk.make(1, 2, 3)
// c: NonEmptyChunk<1 | 2 | 3>
```

**`Effect.makeSemaphore`** — create a semaphore with N permits (`repos/effect/packages/effect/src/Effect.ts:11852`):

```ts
import { Effect } from "effect"
const semaphore = Effect.makeSemaphore(3)
// semaphore: Effect<Semaphore>
```

**`Logger.make`** — define a custom logger from a log function (`repos/effect/packages/effect/src/Logger.ts:110`):

```ts
import { Logger } from "effect"
const jsonLogger = Logger.make(({ message, logLevel }) =>
  console.log(JSON.stringify({ level: logLevel.label, message }))
)
```

**`ManagedRuntime.make`** — create an application runtime from a layer (`repos/effect/packages/effect/src/ManagedRuntime.ts:177`):

```ts
import { ManagedRuntime } from "effect"
const runtime = ManagedRuntime.make(AppLayer)
```

**`Schema.TaggedStruct("Tag", fields).make`** — construct a validated tagged struct instance (`repos/effect/packages/effect/src/Schema.ts:3009`):

```ts
import { Schema } from "effect"
const User = Schema.TaggedStruct("User", { name: Schema.String, age: Schema.Number })
const user = User.make({ name: "Alice", age: 30 })
// { _tag: "User", name: "Alice", age: 30 }
```

**`Ref.make`** — create an atomic mutable cell as an Effect (`repos/effect/packages/effect/src/Ref.ts:69`):

```ts
import { Ref, Effect } from "effect"
const program = Effect.gen(function* () {
  const state = yield* Ref.make({ count: 0 })
  return state
})
```

---

## Anti-patterns

### Service locator with implicit globals

Before Effect, the typical approach to dependency injection in Node.js services is a module-level singleton:

```ts
// db.ts — accessed globally throughout the codebase
import { Pool } from "pg"
export const db = new Pool({ connectionString: process.env.DATABASE_URL })

// users.ts
import { db } from "./db"
export async function getUser(id: string) {
  return db.query("SELECT * FROM users WHERE id = $1", [id])
}
```

The problems are well-known: `db` is always the production pool. Tests must monkey-patch or intercept the module import. There is no type evidence that `getUser` uses the database. A new engineer adding `import { analytics } from "./analytics"` inside `getUser` adds a hidden dependency with no visible signal at any call site.

Effect's `Layer` and `Tag` pattern makes dependencies explicit in types and replaceable without global mutation:

```ts
import { Context, Layer, Effect } from "effect"

// Tag declares the service contract
class DatabaseService extends Context.Tag("DatabaseService")<
  DatabaseService,
  { query: (sql: string, params: unknown[]) => Effect.Effect<unknown[]> }
>() {}

// getUser now says what it needs
const getUser = (id: string): Effect.Effect<User, DatabaseError, DatabaseService> =>
  Effect.gen(function* () {
    const db = yield* DatabaseService
    const rows = yield* db.query("SELECT * FROM users WHERE id = $1", [id])
    return parseUser(rows[0])
  })

// Tests swap in a test layer without any globals
const TestDatabaseLayer = Layer.succeed(DatabaseService, {
  query: () => Effect.succeed([{ id: "1", name: "Alice" }])
})
```

Chapter 08 covers tags and chapters 09-10 cover layers in full.

### `catch (e: any)` with stringly-typed error checks

A common pattern in large codebases is to catch everything and inspect the message or a `type` field:

```ts
try {
  await processOrder(orderId)
} catch (e: any) {
  if (e.type === "payment_failed") {
    await notifyUser(e.userId, "Payment failed")
  } else if (e.message?.includes("out of stock")) {
    await restock(orderId)
  } else {
    throw e  // re-throw unknown errors
  }
}
```

Every part of this is fragile: `e.type` is not typed, `e.message?.includes(...)` is brittle string matching, and the `else { throw e }` branch re-throws `unknown` without ever proving you have handled all expected cases. Adding a new error type somewhere in `processOrder` silently creates a new unhandled path.

Effect's `Data.TaggedError` gives you typed discriminants you can match exhaustively. We will build the full pattern in Chapter 06, but the shape looks like this:

```ts
import { Data, Effect } from "effect"

class PaymentFailedError extends Data.TaggedError("PaymentFailedError")<{
  userId: string
}> {}

class OutOfStockError extends Data.TaggedError("OutOfStockError")<{
  productId: string
}> {}

// TypeScript enforces that both cases are handled
const handled = processOrder(orderId).pipe(
  Effect.catchTag("PaymentFailedError", (e) => notifyUser(e.userId, "Payment failed")),
  Effect.catchTag("OutOfStockError", (e) => restock(e.productId))
)
```

If `processOrder` gains a new error type, `handled` gains a new `E` slot. The unhandled case is visible in the type, not hidden behind a runtime `else`.

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type examined in detail; all the constructors you need day-to-day
- [Chapter 06 — Typed errors](06-typed-errors.md) — `Data.TaggedError`, `Effect.catchTag`, and the full typed-error story
- [Chapter 08 — Context and Tags](08-context-and-tags.md) — `Context.GenericTag`, the `Tag` class, and the `R` type parameter in full
- [Chapter 09 — Layer](09-layer.md) — building, merging, and providing service layers
- [Chapter 10 — `Layer.scoped` and Scope](10-layer-scoped-and-scope.md) — resource lifecycles with guaranteed cleanup
- [Chapter 11 — Constructors](11-constructors.md) — the full naming convention for `.make`, `.of`, `.from*`, and their distinctions
- [Patterns Catalog: `.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors) — the canonical reference entry for this chapter's pattern
- [Package inventory](../../research/01-package-inventory.md) — a survey of all 36 official Effect packages and what each one teaches

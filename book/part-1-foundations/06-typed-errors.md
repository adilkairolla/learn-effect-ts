# Chapter 06 — Typed errors: `Data.TaggedError` and the error channel

> **Patterns introduced:** [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror), [`Effect.catchTag` / `catchTags` / `sandbox` — error handling](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
> **Reads from:** [Chapter 02 — Effect as a value](02-effect-as-a-value.md), [Chapter 05 — Effect.gen](05-effect-gen.md)
> **Reads into:** Chapter 07 (Cause model), Chapter 12 (Option and Either), Chapter 18 (Data, Equal, Hash)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

TypeScript gives you types for almost everything — function parameters, return values, generics, discriminated unions. One thing it does not type is what a function might throw. The `throws` keyword that exists in Java and checked exceptions that exist in some languages are absent from TypeScript. The type signature `function getUser(id: string): User` tells you nothing about whether the function can fail and, if so, what shape the failure takes.

Consider a realistic function that calls three sub-operations:

```ts
// Plain TypeScript — no Effect
function fetchDashboard(userId: string): Dashboard {
  const user = getUser(userId)       // may throw UserNotFoundError
  const orders = getOrders(userId)   // may throw DatabaseError
  const session = getSession(userId) // may throw SessionExpiredError
  return buildDashboard(user, orders, session)
}
```

What does `fetchDashboard` throw? Anything that `getUser`, `getOrders`, or `getSession` might throw — but nothing in the type system tells you that. You have to read all three implementations (and their dependencies) to build a mental model of the failure surface. Add a new `throw` inside `getOrders` and every caller of `fetchDashboard` is silently affected. The compiler says nothing.

At call sites, the only recovery tool is `try/catch`:

```ts
try {
  const dashboard = fetchDashboard("u-1")
  render(dashboard)
} catch (e: unknown) {
  // e is unknown — we must guess or use instanceof
  if (e instanceof UserNotFoundError) {
    redirect("/signup")
  } else if (e instanceof DatabaseError) {
    showRetry()
  } else {
    showGenericError()
  }
}
```

This has three compounding problems. First, `e` is typed `unknown`; the `instanceof` checks are load-bearing but unverified by the compiler — rename a class and the catch silently stops matching. Second, adding a new error type to `getSession` means every `catch` block at every call site of `fetchDashboard` should be updated, but the compiler won't tell you which ones. Third, `instanceof` checks do not compose well with union types: you cannot express "handle `UserNotFoundError | DatabaseError` with one branch" without writing redundant conditions.

The deeper issue is structural. `try/catch` is a control-flow escape hatch designed for exceptional conditions, but many domain errors — "user not found", "invalid input", "quota exceeded" — are not exceptional at all. They are expected, recoverable, and should be part of the function's contract. Encoding them as thrown exceptions is the wrong abstraction.

---

## The minimal example

```ts
import { Data, Effect } from "effect"

interface User { id: string; name: string }
const defaultUser: User = { id: "default", name: "Guest" }

class UserNotFound extends Data.TaggedError("UserNotFound")<{ id: string }> {}
class BadInput extends Data.TaggedError("BadInput")<{ field: string; reason: string }> {}

// Return type explicitly declares the error union: NotFound | BadInput
const fetchUser = (id: string): Effect.Effect<User, UserNotFound | BadInput> =>
  Effect.gen(function* () {
    if (!id) return yield* new BadInput({ field: "id", reason: "empty" })
    if (id === "missing") return yield* new UserNotFound({ id })
    return { id, name: "Alice" }
  })

// Handle errors at the call site — each catchTag removes one tag from E
const handled = fetchUser("missing").pipe(
  Effect.catchTag("UserNotFound", (_e) => Effect.succeed(defaultUser)),
  Effect.catchTag("BadInput", (e) =>
    Effect.fail(new UserNotFound({ id: `bad-field:${e.field}` }))
  )
)
// handled: Effect<User, UserNotFound, never>
```

The type of `handled` proves the recovery was exhaustive: `BadInput` has been handled (either recovered or mapped to a different error) and only `UserNotFound` remains.

---

## How it works

### `Data.TaggedError` — the class factory

`Data.TaggedError` is exported at `repos/effect/packages/effect/src/Data.ts:580-590`:

```ts
export const TaggedError = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] }>
) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A> => {
  const O = {
    BaseEffectError: class extends Error<{}> {
      readonly _tag = tag
    }
  }
  ;(O.BaseEffectError.prototype as any).name = tag
  return O.BaseEffectError as any
}
```

`TaggedError(tag)` returns a class constructor. Subclassing it with `<{ ... }>` adds typed payload fields:

```ts
import { Data } from "effect"

class UserNotFound extends Data.TaggedError("UserNotFound")<{
  readonly id: string
}> {}
```

The resulting class is:
- An `Error` subclass — it has a `.message`, `.stack`, and `.name` (set to the tag string). This means existing logging infrastructure that checks `instanceof Error` still works.
- A `YieldableError` — it implements the iterator protocol, which means you can write `yield* new UserNotFound({ id })` directly inside `Effect.gen` as a shorthand for `yield* Effect.fail(new UserNotFound({ id }))`. This works because `YieldableError` implements the `EffectTypeId` variance struct and the iterator protocol — `class extends Data.TaggedError("UserNotFound")<{...}>` produces instances that satisfy `Effect<never, this, never>` and are valid for `yield*`. The runtime's `OP_ITERATOR` handler treats them as an immediate failure exit (see `repos/effect/packages/effect/src/internal/fiberRuntime.ts:192-211`).
- Structurally discriminated — the `_tag` field is `readonly` and its type is the literal string type `"UserNotFound"`, not `string`. This allows TypeScript's discriminated union narrowing to work: inside a `catchTag` handler, the error parameter is narrowed to exactly that class.

The class pattern is also how the platform package defines its own errors. `SocketServerError` in `repos/effect/packages/platform/src/SocketServer.ts:39` follows the same form: `class SocketServerError extends Data.TaggedError("SocketServerError")<{ readonly reason: "Open" | "Unknown"; readonly cause: unknown }> {}`.

### The error union in `Effect<A, E, R>`

Chapter 02 established that the second type parameter `E` of `Effect<A, E, R>` is the typed error channel. When you sequence effects inside `Effect.gen`, their `E` types union:

```ts
import { Data, Effect } from "effect"

class DBError extends Data.TaggedError("DBError")<{ query: string }> {}
class CacheError extends Data.TaggedError("CacheError")<{ key: string }> {}

declare const queryDB: (q: string) => Effect.Effect<string, DBError>
declare const readCache: (k: string) => Effect.Effect<string, CacheError>

const composed = Effect.gen(function* () {
  const dbResult = yield* queryDB("SELECT 1")
  const cached = yield* readCache(dbResult)
  return cached
})
// composed: Effect<string, DBError | CacheError, never>
```

TypeScript infers the `E` type automatically as the union of all error types that can short-circuit the generator. Each `yield*` adds its error type to the union. Adding a third `yield*` to an `Effect<T, ThirdError>` would widen the union to `DBError | CacheError | ThirdError` — without touching the call site, the compiler shows every place that now needs to handle the new error.

This is the fundamental improvement over `throws`: the error set is tracked in the type, visible at the call site, and maintained incrementally as you compose operations.

### `Effect.catchTag` — handle one tag

`catchTag` is exported at `repos/effect/packages/effect/src/Effect.ts:3882-3890`:

```ts
export const catchTag: {
  <E, const K extends ..., A1, E1, R1>(
    ...args: [...tags: K, f: (e: Extract<NoInfer<E>, { _tag: K[number] }>) => Effect<A1, E1, R1>]
  ): <A, R>(self: Effect<A, E, R>) => Effect<A | A1, Exclude<E, { _tag: K[number] }> | E1, R | R1>
  ...
} = effect.catchTag
```

The key part of the return type is `Exclude<E, { _tag: K[number] }> | E1`. The matched tag is removed from the error union (`Exclude`), and the handler's own error type `E1` is added back. If the handler succeeds with `Effect.succeed(...)`, `E1` is `never` and the tag disappears from the union entirely. If the handler re-fails with a different tagged error, that new error joins the union.

```ts
import { Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}
class AuthError extends Data.TaggedError("AuthError")<{ reason: string }> {}

declare const load: (id: string) => Effect.Effect<string, NotFound | AuthError>

const recovered = load("x").pipe(
  Effect.catchTag("NotFound", (_e) => Effect.succeed("default"))
)
// recovered: Effect<string, AuthError, never>
// NotFound is gone; AuthError remains
```

TypeScript enforces that the tag string you pass exists in the error union. Passing a tag that is not in `E` is a type error at the call site — the compiler tells you immediately, rather than having the catch silently do nothing.

### `Effect.catchTags` — exhaustive object form

When you need to handle several tags at once, `catchTags` accepts an object keyed by tag name:

`catchTags` is exported at `repos/effect/packages/effect/src/Effect.ts:3948-3996`. It takes a `cases` object where each key is a `_tag` string and the value is a handler function. All matched tags are removed from the error union in one step.

```ts
import { Data, Effect } from "effect"

class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}
class AuthError extends Data.TaggedError("AuthError")<{ reason: string }> {}
class RateLimited extends Data.TaggedError("RateLimited")<{ retryAfter: number }> {}

declare const call: () => Effect.Effect<string, NotFound | AuthError | RateLimited>

const allHandled = call().pipe(
  Effect.catchTags({
    NotFound: (_e) => Effect.succeed("fallback"),
    AuthError: (e) => Effect.fail(new RateLimited({ retryAfter: 0 })),
    RateLimited: (e) => Effect.succeed(`retry after ${e.retryAfter}s`),
  })
)
// allHandled: Effect<string, never, never>
// All three tags handled; E is never
```

The `catchTags` object form also works as a partial handler — you do not need to list every tag in the union. Unhandled tags remain in `E`.

### `Effect.sandbox` — surface the full `Cause`

`sandbox` is exported at `repos/effect/packages/effect/src/Effect.ts:4246`:

```ts
export const sandbox: <A, E, R>(self: Effect<A, E, R>) => Effect<A, Cause.Cause<E>, R>
```

It promotes the error channel from `E` to `Cause<E>`. `sandbox` exposes the full `Cause<E>` value (with all the structural information about how the failure occurred) by promoting it from `E` to the error channel of `Effect<A, Cause<E>, R>`. Subsequent `catchAll`/`catchTag` operators see the `Cause<E>` value and can inspect its structure — you can pattern-match on `Cause.isFailType`, `Cause.isDieType`, or `Cause.isInterruptType`. Chapter 07 covers the `Cause` model in full, including `Fail`, `Die`, and `Interrupt` variants. For now, the main point is that `sandbox` is the bridge between typed errors and the richer `Cause` universe. Use it at observability boundaries — for example, in a global error logger that needs to report both typed failures and unhandled defects.

### Supporting operators

Three additional operators round out day-to-day error handling:

- `mapError` (`repos/effect/packages/effect/src/Effect.ts:5310-5313`) — transform the `E` value without handling it. Useful when you receive one error type and need to map it into a different one before surfacing it at the next layer.
- `tapError` (`repos/effect/packages/effect/src/Effect.ts:9727-9732`) — run a side effect (typically logging) on any failure without altering the failure itself. The error propagates unchanged.
- `orElseFail` (`repos/effect/packages/effect/src/Effect.ts:11408-11411`) — replace any failure, regardless of its tag, with a different error value. A blunt instrument; prefer `mapError` when the incoming type is known.

### Typed errors are recoverable; defects are not

A subtle but important boundary: `Data.TaggedError` creates values that live in the `E` channel — these are *expected, recoverable* failures. They are domain events, not programmer mistakes. `Effect.catchTag` can handle them.

A *defect* is a programming error that escapes into the `Die` variant of `Cause` — a null dereference, a failed assertion, an unhandled `throw`. Defects do not appear in `E`. They cannot be caught with `catchTag`. `Effect.die(someError)` or an unhandled exception inside `Effect.sync` creates a defect. Chapter 07 covers defects, the `Cause` model, and the difference between `Effect.fail` and `Effect.die` in full.

---

## A production example

An HTTP route handler that validates input, looks up data, and calls a downstream service — then maps each typed error to an appropriate HTTP status code:

```ts
import { Data, Effect } from "effect"

// ---- Error types ----

class ValidationError extends Data.TaggedError("ValidationError")<{
  readonly field: string
  readonly message: string
}> {}

class RecordNotFound extends Data.TaggedError("RecordNotFound")<{
  readonly entity: string
  readonly id: string
}> {}

class UpstreamFailure extends Data.TaggedError("UpstreamFailure")<{
  readonly service: string
  readonly statusCode: number
}> {}

// ---- Domain types ----

interface OrderRequest { orderId: string; userId: string }
interface Order { id: string; total: number }
interface ShipmentQuote { carrier: string; estimate: string }
interface HttpResponse { status: number; body: unknown }

// ---- Service stubs (would come from context in production — Chapter 08) ----

declare const validateRequest: (
  raw: unknown
) => Effect.Effect<OrderRequest, ValidationError>

declare const loadOrder: (
  orderId: string
) => Effect.Effect<Order, RecordNotFound>

declare const getShipmentQuote: (
  order: Order
) => Effect.Effect<ShipmentQuote, UpstreamFailure>

// ---- Route handler ----

const handleOrderQuote = (
  rawBody: unknown
): Effect.Effect<HttpResponse, never> =>
  Effect.gen(function* () {
    const req = yield* validateRequest(rawBody)
    const order = yield* loadOrder(req.orderId)
    const quote = yield* getShipmentQuote(order)

    return {
      status: 200,
      body: { orderId: order.id, carrier: quote.carrier, estimate: quote.estimate },
    }
  }).pipe(
    // Map every typed error to a typed HTTP response — E collapses to never
    Effect.catchTags({
      ValidationError: (e) =>
        Effect.succeed<HttpResponse>({
          status: 400,
          body: { error: "ValidationError", field: e.field, message: e.message },
        }),
      RecordNotFound: (e) =>
        Effect.succeed<HttpResponse>({
          status: 404,
          body: { error: "NotFound", entity: e.entity, id: e.id },
        }),
      UpstreamFailure: (e) =>
        Effect.succeed<HttpResponse>({
          status: 502,
          body: { error: "UpstreamFailure", service: e.service, upstream: e.statusCode },
        }),
    })
  )

// At the edge: E is never, so runPromise cannot reject with a typed error
// (unhandled defects still surface as FiberFailure — see Chapter 07)
Effect.runPromise(handleOrderQuote({ orderId: "ord-1", userId: "u-1" })).then(
  (res) => console.log(res.status, res.body)
)
```

The pattern above mirrors how `repos/effect/packages/platform/src/Multipart.ts:551-554` uses `Effect.catchTags` to map `SystemError` and `BadArgument` — two typed errors from the file system layer — into a single `MultipartError` at the boundary of the multipart parsing layer. Catching at the layer boundary and re-tagging keeps each module's internal error vocabulary private.

---

## Variations

**Class form (most common)** — extends a `Data.TaggedError` base class with a named payload type. All fields are `readonly` and structurally comparable.

```ts
import { Data } from "effect"
class PaymentDeclined extends Data.TaggedError("PaymentDeclined")<{
  readonly amount: number
  readonly reason: string
}> {}
```

**`yield* new Foo({ ... })` as short-circuit** — because `Data.TaggedError` produces a `YieldableError`, an instance is itself a valid `Effect<never, Foo>`. Yielding it inside `Effect.gen` short-circuits the generator with that error.

```ts
import { Data, Effect } from "effect"
class EmptyId extends Data.TaggedError("EmptyId")<{}> {}
const validate = (id: string) => Effect.gen(function* () {
  if (!id) yield* new EmptyId({})
  return id
})
```

**`Effect.fail(new Foo({ ... }))` — explicit fail** — equivalent to the `yield*` form but can be used outside a generator, e.g., in a `flatMap` callback.

```ts
import { Data, Effect } from "effect"
class Forbidden extends Data.TaggedError("Forbidden")<{ action: string }> {}
const guard = (allowed: boolean) =>
  allowed
    ? Effect.succeed("ok")
    : Effect.fail(new Forbidden({ action: "write" }))
```

**`Effect.catchTag("Foo", handler)` — handle one tag** — removes `Foo` from the error union; the handler's own error type is merged in.

```ts
import { Effect } from "effect"
// (error types and fetchUser declared above)
const safe = fetchUser("id").pipe(
  Effect.catchTag("UserNotFound", (_e) => Effect.succeed(defaultUser))
)
```

**`Effect.catchTags({ Foo: ..., Bar: ... })` — exhaustive object form** — handle multiple tags in one call; each matched tag is removed from `E`.

```ts
import { Effect } from "effect"
const handled = fetchUser("id").pipe(
  Effect.catchTags({
    UserNotFound: (_e) => Effect.succeed(defaultUser),
    BadInput: (e) => Effect.die(new Error(`bad field: ${e.field}`)),
  })
)
```

**`Effect.sandbox` — surface the full `Cause` in the error channel** — use at observability boundaries to inspect or log the full failure including defects and interruptions. Chapter 07 explains `Cause` in detail.

```ts
import { Cause, Effect } from "effect"
const withCause = fetchUser("id").pipe(
  Effect.sandbox,
  Effect.catchAll((cause) =>
    Cause.isDieType(cause)
      ? Effect.logError("defect", cause).pipe(Effect.zipRight(Effect.failCause(cause)))
      : Effect.failCause(cause)
  ),
  Effect.unsandbox
)
```

**`Data.taggedEnum` / `Data.TaggedEnum` — multi-variant tagged enum** — a lightweight alternative for small, closed sets of variants where separate classes would be verbose. `Data.taggedEnum` (the runtime constructor) / `Data.TaggedEnum` (the type alias) — Chapter 18 covers both in full.

```ts
import { Data } from "effect"
type HttpError = Data.TaggedEnum<{
  NotFound: { readonly path: string }
  Forbidden: { readonly action: string }
}>
const { NotFound, Forbidden } = Data.taggedEnum<HttpError>()
```

---

## Anti-patterns

### Throwing string errors

```ts
// Wrong: string throws have no type, no structure, no recovery path.
function riskyOp(): string {
  if (Math.random() < 0.5) throw "something went wrong"
  return "ok"
}

// At the call site:
try {
  const result = riskyOp()
} catch (e: unknown) {
  // e is unknown; string comparison is fragile and untyped
  if (typeof e === "string" && e.includes("wrong")) { /* ... */ }
}
```

The right move: define a `Data.TaggedError` class and surface failures through the `E` channel. The error becomes typed, documented in the function signature, and catchable with `catchTag`.

```ts
import { Data, Effect } from "effect"
class OpFailed extends Data.TaggedError("OpFailed")<{ reason: string }> {}

const riskyOp = Effect.gen(function* () {
  if (Math.random() < 0.5) yield* new OpFailed({ reason: "unlucky" })
  return "ok"
})
```

### Using `try/catch` inside `Effect.gen` to recover from typed Effect errors

Chapter 05 established this anti-pattern; it is worth re-stating here in the error-handling context. When a `yield*`-ed Effect fails, the Effect runtime does not throw into the generator. It extracts the failure from the effect value and propagates it through the `E` channel directly. A `try/catch` wrapped around a `yield*` will not intercept that failure — the generator body is not re-entered. See `repos/effect/packages/effect/src/internal/fiberRuntime.ts` near the `OP_ITERATOR` handler (around lines 192-211) for this behaviour.

```ts
import { Effect } from "effect"

// Wrong: try/catch does not catch typed Effect failures from yield*.
const bad = Effect.gen(function* () {
  try {
    const user = yield* fetchUser("u-1") // typed failures bypass this try/catch
    return user
  } catch (e) {
    return null // will not fire for typed Effect errors
  }
})

// Right: use Effect.catchTag outside the gen block.
const good = Effect.gen(function* () {
  const user = yield* fetchUser("u-1")
  return user
}).pipe(
  Effect.catchTag("UserNotFound", (_e) => Effect.succeed(null))
)
```

### Re-throwing inside `catchTag` without typing the new error

```ts
import { Effect } from "effect"

// Wrong: re-throwing with a plain Error object loses the typed error channel.
const bad = fetchUser("u-1").pipe(
  Effect.catchTag("UserNotFound", (e) => {
    throw new Error(`user ${e.id} not found`) // dies as a defect, not a typed error
  })
)
```

Throwing inside a handler creates a defect (`Die` variant of `Cause`), not a typed failure. The error channel's E type stays as `never` for the matched tag, but the defect is invisible to callers using `catchTag`. The right move is to explicitly fail with a new typed error or use `mapError` to transform:

```ts
import { Data, Effect } from "effect"
class InternalError extends Data.TaggedError("InternalError")<{ cause: unknown }> {}

// Right: fail with a typed error so callers can recover.
const good = fetchUser("u-1").pipe(
  Effect.catchTag("UserNotFound", (e) =>
    Effect.fail(new InternalError({ cause: e }))
  )
)
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type; the `E` parameter that carries typed errors
- [Chapter 05 — Effect.gen](05-effect-gen.md) — generator sequencing and how typed errors short-circuit the gen body
- [Chapter 07 — Cause model](07-cause-model.md) — `Cause.Fail`, `Cause.Die`, `Cause.Interrupt`; the difference between recoverable errors and defects
- [Chapter 12 — Option and Either](12-option-and-either.md) — `Option` and `Either` as error vocabularies for non-Effect contexts; bridging them into the `E` channel
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — `Data.TaggedEnum` for closed multi-variant discriminated unions; structural equality on error values
- [Patterns Catalog: Data.TaggedError](../../research/02-patterns-catalog.md#datataggederror)
- [Patterns Catalog: Effect.catchTag/catchTags/sandbox](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
- [Per-package note: effect](../../research/packages/effect.md)

# Chapter 53 — The dual API surface — data-first and data-last overloads

> **Worked-example commit:** `worked-example/` chapter 53 — `feat: dual data-first/data-last API for Cache.{get,set,delete,invalidate}`
> **Patterns demonstrated:** [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait), [`pipe` vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining)
> **Reads from:** [Chapter 04 — pipe and the dual API](../part-1-foundations/04-pipe-and-dual-api.md), [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md), [Chapter 47 — designing the public API](./47-public-api.md)
> **Reads into:** Chapter 56 (tests exercise both data-first and data-last forms)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Every combinator in the Effect ecosystem supports two call signatures. You can write `Effect.flatMap(effect, f)` (data-first — the subject comes first) or `pipe(effect, Effect.flatMap(f))` (data-last — the subject is piped in). Effect calls this pattern *dual*, and it is delivered by a single helper, `dual`, from `"effect/Function"`.

Up to this point, callers of `effect-cache` must go through the service object explicitly:

```ts
import { Effect } from "effect"
import { Cache } from "effect-cache"

const program = Effect.gen(function* () {
  const cache = yield* Cache          // pull the service from context
  const result = yield* cache.get(key) // call the method on the service
})
```

That is correct but verbose. The standard Effect idiom is to expose module-level functions that do both jobs. After this chapter, callers can write:

```ts
// data-last — reads the service from context automatically
const program = Effect.gen(function* () {
  const result = yield* Cache.get(key)
})

// data-first — service value supplied directly
const result = Cache.get(myServiceValue, key)
```

The goal of this chapter is to add those module-level combinators for `get`, `set`, `delete`, and `invalidate`. The change is entirely additive: the `CacheService` interface, both layers, and every internal module remain untouched.

---

## What we already have

After Chapter 52, `worked-example/src/` contains:

- `Cache.ts` — `Cache` tag class, `CacheService` interface, `Cache.layerMemory` (Chapter 51), `Cache.layerMemoryWithEviction` (Chapter 52)
- `internal/MemoryStorage.ts` — `makeStorage`, `makeService`, `make` factory
- `internal/eviction.ts` — `sweep` and `runEviction`
- `CacheConfig.ts`, `CacheError.ts`, `CacheKey.ts`, `index.ts`

The service interface (`CacheService`) has five members: `get`, `set`, `delete`, `invalidate`, and `events`. Callers reach them by first yielding the `Cache` tag to get the service object. There are no module-level re-exports.

---

## What we're adding

One file changes: `src/Cache.ts` (modified).

Four new exports land in `Cache.ts`:

| Export | Kind | Notes |
|---|---|---|
| `Cache.get` | dual combinator | `dual(2, ...)` |
| `Cache.set` | dual combinator | `dual(4, ...)` — ttlMillis required |
| `Cache.delete` | dual combinator | `dual(2, ...)` — exported via rename |
| `Cache.invalidate` | plain Effect value | not dual — zero extra args |

No new files. No changes to the service interface. No changes to the layers.

---

## The code

### `src/Cache.ts` (modified)

The only new import is `dual` from `"effect/Function"`:

```ts
import { dual } from "effect/Function"
```

`dual` is declared at `repos/effect/packages/effect/src/Function.ts:31-103` (JSDoc-inclusive). Its signature accepts either an arity number or a predicate, paired with the data-first body function:

```ts
export const dual: {
  <DataLast, DataFirst>(arity: Parameters<DataFirst>["length"], body: DataFirst): DataLast & DataFirst
  <DataLast, DataFirst>(isDataFirst: (args: IArguments) => boolean, body: DataFirst): DataLast & DataFirst
}
```

When the arity form is used — `dual(2, body)` — `dual` checks `arguments.length` at runtime. If two or more arguments are present it runs the body directly (data-first). If fewer arguments are present it returns a *curried function* that accepts the subject later (data-last) — built for `pipe(value, fn(arg))`.

That curried-function shape is the right answer for data combinators (`Ref.get`, `Chunk.map`, etc.) where the data-last form is meant to live inside a `pipe`. It is the wrong answer for **service-tag** accessors like `Cache.get`, where we want `yield* Cache.get(key)` to compose inside `Effect.gen` — yielding a curried function would throw `not iterable`. So in `Cache.ts` we hand-roll the dispatch: with all arguments we call the underlying service method directly; with one fewer argument we return `Effect.flatMap(Cache, (s) => s.get(key))` — a context-pulling Effect, not a function.

The same overload-typed surface applies, but the implementation chooses `Effect.flatMap(Cache, ...)` over `dual(...)` precisely because the data-last consumer here is a `yield*` site, not a `pipe`.

#### `Cache.get`

```ts
/**
 * Read a value from the cache by key.
 *
 * Data-last  (service from context): `Cache.get(key)`
 * Data-first (service explicit):     `Cache.get(service, key)`
 *
 * @since 0.1.0
 * @category combinators
 */
static readonly get = ((...args: ReadonlyArray<unknown>): unknown => {
  if (args.length === 1) {
    const key = args[0] as CacheKey
    return Effect.flatMap(Cache, (s) => s.get(key))
  }
  return (args[0] as CacheService).get(args[1] as CacheKey)
}) as {
  (key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError, Cache>
  (cache: CacheService, key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError>
}
```

The combinator is a `static readonly` member of the `Cache` class so callers see `Cache.get(key)` from a single `import { Cache } from "@example/effect-cache"` (the static-member layout introduced in Chapter 47). The implementation inspects `args.length`: with one argument we return a context-pulling Effect (`Effect.flatMap(Cache, …)`); with two we invoke the supplied service directly. The cast at the end binds the underlying impl signature to the public overload type.

This matches Effect's convention for service-tag accessors throughout the core library — see `Effect.flatMap` at `repos/effect/packages/effect/src/Effect.ts:8782-8847` for the underlying primitive that makes the data-last branch work.

#### `Cache.set`

`set` takes three user arguments: `key`, `value`, and `ttlMillis`. That makes the data-first arity `4` (service + three user args):

```ts
/**
 * Write a value with an explicit TTL in milliseconds.
 *
 * Data-last  (service from context): `Cache.set(key, value, ttlMillis)`
 * Data-first (service explicit):     `Cache.set(service, key, value, ttlMillis)`
 *
 * @since 0.1.0
 * @category combinators
 */
static readonly set = ((...args: ReadonlyArray<unknown>): unknown => {
  if (args.length === 3) {
    const [key, value, ttlMillis] = args as [CacheKey, unknown, number]
    return Effect.flatMap(Cache, (s) => s.set(key, value, ttlMillis))
  }
  const [cache, key, value, ttlMillis] = args as [CacheService, CacheKey, unknown, number]
  return cache.set(key, value, ttlMillis)
}) as {
  (key: CacheKey, value: unknown, ttlMillis: number): Effect.Effect<void, CacheError, Cache>
  (cache: CacheService, key: CacheKey, value: unknown, ttlMillis: number): Effect.Effect<void, CacheError>
}
```

Note that `ttlMillis` is **required** here (`number`, not `number | undefined`). See the design discussion below for why. Three user args + the optional service prefix means the dispatch checks for `args.length === 3` (data-last) versus `4` (data-first).

#### `Cache.delete`

`delete` is a JavaScript reserved word at the top level of a module — but it is allowed as a **class member name**. Putting the combinator on the `Cache` class lets us name it `delete` directly with no rename gymnastics:

```ts
static readonly delete = ((...args: ReadonlyArray<unknown>): unknown => {
  if (args.length === 1) {
    const key = args[0] as CacheKey
    return Effect.flatMap(Cache, (s) => s.delete(key))
  }
  return (args[0] as CacheService).delete(args[1] as CacheKey)
}) as {
  (key: CacheKey): Effect.Effect<void, CacheError, Cache>
  (cache: CacheService, key: CacheKey): Effect.Effect<void, CacheError>
}
```

Callers write `Cache.delete(key)` and `Cache.delete(service, key)` exactly as they would for any other combinator. (If we had stayed with top-level `export const`, we would have needed the `export { _delete as delete }` rename trick — see the precedent at `repos/effect/packages/effect/src/FiberRef.ts`.)

#### `Cache.invalidate`

`invalidate` on the `CacheService` interface is a property of type `Effect.Effect<void, CacheError>`, not a function. It takes no key and no extra arguments — there is nothing to curry. Adding `dual` here would mean `dual(1, ...)`, which the `dual` runtime explicitly disallows (it throws a `RangeError` for arity below 2). The correct pattern for a zero-arg service member is a plain `Effect` value built with `Effect.flatMap`:

```ts
/**
 * Drop all entries from the cache.
 *
 * @since 0.1.0
 * @category combinators
 */
static readonly invalidate: Effect.Effect<void, CacheError, Cache> = Effect.flatMap(
  Cache,
  (s) => s.invalidate
)
```

`Effect.flatMap(Cache, f)` reads the `Cache` service from the context, passes it to `f`, and flattens the result. `Cache` here is both the class and a valid `Effect` that yields the service — a property of `Context.Tag` subclasses (see [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md)). The static field can refer to `Cache` because static initializers run in source order *after* the class binding is in scope.

---

## Why this design choice

### Dual over single-form

The alternative is to export only a data-last form (every combinator is curried) or only a data-first form (every combinator takes the service explicitly). Both choices create friction.

Curried-only forces callers who have the service value in hand to write `pipe(service, Cache.get(key))` — introducing a pipe call for no reason. Direct-only forces callers who want idiomatic `Effect.gen` composition to pull the service manually every time. `dual` gives both: Effect's core library uses this pattern throughout. `Effect.flatMap`, `Effect.map`, `Effect.tap`, `Stream.map`, `Layer.provide`, `Array.map` — all are dual. A library that ships only one form is swimming against the stream.

### Arity vs. predicate form

`dual` accepts either a fixed arity integer or a predicate `(args: IArguments) => boolean` that inspects the actual arguments at runtime. The predicate form is useful when argument count is ambiguous — for example when there is an optional parameter that makes the data-first arity collide with the data-last arity. `set` on `CacheService` has `ttlMillis?: number` — optional. If the dual export kept that optional, the data-last form would be `(key, value)` or `(key, value, ttlMillis)` — two arities — while the data-first form would be `(service, key, value)` or `(service, key, value, ttlMillis)` — also two arities. There is no single integer that distinguishes them.

The decision taken here is to **require** `ttlMillis` in the public `Cache.set` combinator. This collapses the arity ambiguity: data-first always takes 4 arguments, data-last always takes 3. The arity form `dual(4, ...)` works cleanly.

The trade-off is that callers must always supply an explicit TTL at the `Cache.set` call site. The layer's default TTL (from `CacheConfig.defaultTtlMillis`) still applies when calling through the `CacheService` interface directly with `ttlMillis` omitted — it is not removed from the underlying interface. The public `Cache.set` combinator simply makes the choice explicit: if you write `Cache.set(key, value, 30_000)` you know exactly how long the entry lives. Silent defaults are a common source of bugs in cache code.

### The `delete` reserved-word workaround

JavaScript's reserved words (`delete`, `in`, `new`, `typeof`, and others) cannot appear as top-level variable declarations — `export const delete = ...` is a syntax error. Class member names are exempt: `static readonly delete = ...` is legal because the class scope already disambiguates the identifier from the operator. Putting the combinators on the `Cache` class therefore lets us name the method `delete` directly with no rename trick. (The Effect source still uses `export { _delete as delete }` in `repos/effect/packages/effect/src/FiberRef.ts` because its accessors live at the module top level — a different layout choice.)

### Why `invalidate` is a value

`dual(1, ...)` is a `RangeError` by design — there is no "data-last form" when the curried result would be a zero-arg function. For a service member with no extra arguments, the correct pattern is `Effect.flatMap(Cache, (s) => s.invalidate)`. This is a value, not a function: `typeof Cache.invalidate === "object"` (Effect values are objects). It composes naturally with `pipe` and `Effect.gen` without any extra wrapping.

---

## What's still missing

- **The `events` stream** — `CacheService.events` is not yet exposed as a module-level export. It is a `Stream`, not an `Effect`, and the forward-reference stub in the interface is a placeholder. The real implementation, including a `PubSub`-backed stream that publishes hits, misses, sets, and evictions, lands in Chapter 55.

- **Tests** — Neither the dual forms nor the underlying layers have any automated tests yet. Chapter 56 adds a Vitest suite that exercises both the data-first and data-last forms, verifies `Cache.invalidate` clears the store, and uses `TestClock` to advance eviction time.

- **JSDoc** — The `@example` blocks referenced in the `@since` / `@category` JSDoc comments are intentionally minimal stubs. Chapter 57 fills them with runnable examples.

- **Module re-exports in `index.ts`** — The new `get`, `set`, `delete`, and `invalidate` exports are not yet re-exported from `src/index.ts`. That consolidation happens in Chapter 57 when the full public API surface is locked.

---

## Commit

```bash
cd worked-example
git add src/Cache.ts
git commit -m "feat: dual data-first/data-last API for Cache.{get,set,delete,invalidate}"
```

Commit SHA: `f6149ec` (HEAD after this chapter).

---

## See also

- [Chapter 04 — pipe and the dual API](../part-1-foundations/04-pipe-and-dual-api.md) — full derivation of why dual exists, how `pipe` enables data-last style, and when to prefer one form over the other
- [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md) — explains why `Cache` (as a `Context.Tag` subclass) is itself a valid `Effect` value, enabling `Effect.flatMap(Cache, f)`
- [Chapter 47 — designing the public API](./47-public-api.md) — the `CacheService` interface and `Cache` tag were defined here; `Cache.get` et al. are wrappers around the same interface
- [Chapter 56 — tests](./56-tests.md) — exercises both call forms of every dual combinator added here
- `repos/effect/packages/effect/src/Function.ts:31-103` — JSDoc-inclusive source for `dual`, including the arity vs. predicate overloads and three worked examples
- `repos/effect/packages/effect/src/Effect.ts:8782-8847` — `Effect.flatMap` JSDoc-inclusive — a production dual combinator at scale, showing the exact call-signature pattern used in this chapter
- [Research catalog — Dual data-first / data-last](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — pattern entry with source citations, anti-patterns, and related patterns
- [Research catalog — pipe vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining) — explains when to prefer `pipe(value, f)` vs `.pipe(f)` vs direct function application

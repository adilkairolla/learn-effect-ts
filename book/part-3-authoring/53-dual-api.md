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

When the arity form is used — `dual(2, body)` — `dual` checks `arguments.length` at runtime. If two or more arguments are present it runs the body directly (data-first). If fewer arguments are present it returns a curried function that accepts the subject later (data-last).

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
export const get: {
  (key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError, Cache>
  (cache: CacheService, key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError>
} = dual(2, (cache: CacheService, key: CacheKey) => cache.get(key))
```

The arity is `2` because the data-first form takes two arguments: `(cache, key)`. When called with one argument (`key` only), `dual` returns `(cache: CacheService) => cache.get(key)`. The data-last type signature `(key: CacheKey): Effect<..., Cache>` does not literally return a function-of-service — instead, TypeScript sees the return type as `Effect<..., Cache>`, which reads the service from the environment at execution time. This matches Effect's convention throughout the core library (see `Effect.flatMap` at `repos/effect/packages/effect/src/Effect.ts:8844-8847`).

The full `Cache.ts` lines are `worked-example/src/Cache.ts:97-100`.

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
export const set: {
  (key: CacheKey, value: unknown, ttlMillis: number): Effect.Effect<void, CacheError, Cache>
  (cache: CacheService, key: CacheKey, value: unknown, ttlMillis: number): Effect.Effect<void, CacheError>
} = dual(4, (cache: CacheService, key: CacheKey, value: unknown, ttlMillis: number) =>
  cache.set(key, value, ttlMillis))
```

Note that `ttlMillis` is **required** here (`number`, not `number | undefined`). See the design discussion below for why.

Full lines: `worked-example/src/Cache.ts:117-121`.

#### `Cache.delete`

`delete` is a JavaScript reserved word. You cannot write `export const delete = ...` at the top level of a module. The workaround is an internal name with an explicit re-export rename:

```ts
export const _delete: {
  (key: CacheKey): Effect.Effect<void, CacheError, Cache>
  (cache: CacheService, key: CacheKey): Effect.Effect<void, CacheError>
} = dual(2, (cache: CacheService, key: CacheKey) => cache.delete(key))
export { _delete as delete }
```

Callers see `Cache.delete(key)` and `Cache.delete(service, key)` exactly as they would for any other combinator. The `_delete` name is an internal implementation detail. Full lines: `worked-example/src/Cache.ts:135-139`.

#### `Cache.invalidate`

`invalidate` on the `CacheService` interface is a property of type `Effect.Effect<void, CacheError>`, not a function. It takes no key and no extra arguments — there is nothing to curry. Adding `dual` here would mean `dual(1, ...)`, which the `dual` runtime explicitly disallows (it throws a `RangeError` for arity below 2). The correct pattern for a zero-arg service member is a plain `Effect` value built with `Effect.flatMap`:

```ts
/**
 * Drop all entries from the cache.
 *
 * @since 0.1.0
 * @category combinators
 */
export const invalidate: Effect.Effect<void, CacheError, Cache> = Effect.flatMap(
  Cache,
  (s) => s.invalidate
)
```

`Effect.flatMap(Cache, f)` reads the `Cache` service from the context, passes it to `f`, and flattens the result. `Cache` here is both the class and a valid `Effect` that yields the service — a property of `Context.Tag` subclasses (see [Chapter 08 — Context and Tags](../part-1-foundations/08-context-and-tags.md)). Full lines: `worked-example/src/Cache.ts:152-155`.

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

JavaScript's reserved words (`delete`, `in`, `new`, `typeof`, and others) cannot appear as top-level variable declarations. The three options are: rename the export (`remove`), prefix it (`_delete`), or declare internally under a prefixed name and re-export with `export { _delete as delete }`. The third option is used here because callers see the idiomatic `Cache.delete` name, IDEs autocomplete it correctly, and the rename is entirely invisible at the call site. The precedent exists in the Effect source: see `Array.ts` in the effect repository, which similarly wraps reserved identifiers.

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

# Chapter 50 — Branded types for cache keys — `CacheKey`

> **Worked-example commit:** `worked-example/` chapter 50 — `feat: brand CacheKey for nominal typing`
> **Patterns demonstrated:** [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all)
> **Reads from:** [Chapter 13 — Branded types](../part-1-foundations/13-branded-types.md)
> **Reads into:** Chapter 51 (memory layer keys), Chapter 52 (eviction keys), Chapter 53 (dual API), Chapter 55 (event keys)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

The previous three chapters established the structural skeleton of `@example/effect-cache`: a service tag (`Cache`), a typed error channel (`CacheError`), and a schema-validated configuration object (`CacheConfig`). That skeleton compiles and exports cleanly — but one detail was left as a deliberate placeholder: the `CacheKey` type inside `src/Cache.ts` was declared as `type CacheKey = string`, a plain alias that gives the type a name but no additional safety.

A plain type alias is structurally equivalent to `string`. That means any function accepting a `CacheKey` parameter will also accept a raw `string`, a `URL.pathname`, a Redis cluster shard key, or any other string-shaped value. There is nothing at the type level stopping a caller from passing a database row ID to a method that expects a cache key for a user-preferences lookup. The TypeScript compiler offers no pushback.

This chapter promotes `CacheKey` from a plain alias to a **nominal type** — a type that is structurally a `string` but is distinct at the type system level from every other string. The mechanism is `Brand.nominal<CacheKey>()`, which generates a zero-cost constructor. At runtime the constructor is an identity function: it returns the value it was given, unchanged. At the type level it marks the value as `string & Brand.Brand<"CacheKey">`, a type that cannot be satisfied by a bare string literal or any other string-shaped value that has not been explicitly constructed via `CacheKey("...")`.

The change touches four files and adds one: `src/CacheKey.ts` (new), `src/Cache.ts`, `src/CacheError.ts`, and `src/index.ts`. The diff is small. The design payoff is large: every downstream chapter, every Layer implementation, and every test helper that deals with keys must now use the branded constructor. Bugs from accidental key misuse are caught at compile time, not at runtime.

---

## What we already have

After Chapter 49, `worked-example/` has six commits (most recent: `5f19af5 feat: schema-driven CacheConfig with Config integration`).

`src/Cache.ts` carries two forward-declaration comments:

```ts
// src/Cache.ts — after Ch 49
type CacheKey = string               // replaced in this chapter
type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }
                                     // replaced in Ch 55
```

`src/CacheError.ts` defines the `Missing`, `Backend`, and `Encoding` error classes. `Missing` carries a `key: string` field — the key that was looked up but not found. That field should be `CacheKey` once the brand lands, so both files need updating together.

`src/CacheConfig.ts` and `src/index.ts` are complete and do not change shape in this chapter. The index currently re-exports `Cache`, `CacheError`, and `CacheConfig`. It will also re-export `CacheKey` after this chapter.

There is no implementation yet — `Cache.make()` still calls `Effect.die(...)`. The type changes in this chapter are purely compile-time: they enforce key discipline before any runtime code is written.

---

## What we're adding

| File | Change |
|---|---|
| `src/CacheKey.ts` | **New.** `CacheKey` branded type (`string & Brand.Brand<"CacheKey">`) and `CacheKey` constructor via `Brand.nominal<CacheKey>()`. |
| `src/Cache.ts` | **Modified.** Remove `type CacheKey = string`. Add `import type { CacheKey } from "./CacheKey.js"`. Method signatures unchanged — the type name was already correct, now it refers to the branded type. |
| `src/CacheError.ts` | **Modified.** Import `CacheKey`. Update `Missing.key` field from `string` to `CacheKey`. |
| `src/index.ts` | **Modified.** Add `export * from "./CacheKey.js"`. |

After this commit, all four `CacheKey` references in `CacheService` (`get`, `set`, `delete`) and the one in `Missing.key` resolve to the branded type. Callers must produce a `CacheKey` via the constructor — passing a raw string will be a compile error.

---

## The code

### `src/CacheKey.ts` (new)

```ts
import * as Brand from "effect/Brand"

/**
 * A branded cache key. Distinct from a plain `string` at the type level —
 * callers cannot accidentally pass an unbranded string in any cache method.
 * Construct via `CacheKey("...")`.
 *
 * @since 0.1.0
 * @category models
 */
export type CacheKey = string & Brand.Brand<"CacheKey">

/**
 * Constructor for `CacheKey`. Wraps a string at the type level — no runtime work,
 * no validation. If you need length limits or charset checks, use `Brand.refined`
 * instead (foreshadowed below).
 *
 * @since 0.1.0
 * @category constructors
 */
export const CacheKey = Brand.nominal<CacheKey>()
```

Two declarations share the name `CacheKey`. TypeScript's declaration merging makes both valid in the same module: the `type` declaration is consumed wherever a type annotation is needed; the `const` declaration is consumed wherever the constructor function is called. This is the canonical Effect idiom for branded types — see [Chapter 13 — Branded types](../part-1-foundations/13-branded-types.md) for the full treatment.

#### `Brand.Brand<K>` — the type-level marker

`Brand.Brand<"CacheKey">` is defined at `repos/effect/packages/effect/src/Brand.ts:50-60` (JSDoc-inclusive starting at the `/**` on line 50):

```ts
/**
 * A generic interface that defines a branded type.
 *
 * @since 2.0.0
 * @category models
 */
export interface Brand<in out K extends string | symbol> {
  readonly [BrandTypeId]: {
    readonly [k in K]: K
  }
}
```

The type is a mapped-type wrapper around a unique symbol (`BrandTypeId`). The string key `"CacheKey"` is encoded in the object's index signature, making `string & Brand.Brand<"CacheKey">` and `string & Brand.Brand<"SessionToken">` structurally incompatible — TypeScript cannot satisfy one with the other because the index signatures differ. That incompatibility is exactly what we want.

The intersection `string & Brand.Brand<"CacheKey">` means: "a value that is both a `string` and carries the brand marker for `"CacheKey"`." At runtime the brand is absent — it exists only in the TypeScript type graph.

#### `Brand.nominal<A>()` — the zero-cost constructor

`Brand.nominal` is defined at `repos/effect/packages/effect/src/Brand.ts:246-279` (JSDoc-inclusive starting at the `/**` on line 246):

```ts
/**
 * This function returns a `Brand.Constructor` that **does not apply any runtime checks**,
 * it just returns the provided value.
 * ...
 * @since 2.0.0
 * @category constructors
 */
export const nominal = <A extends Brand<any>>(): Brand.Constructor<A> => {
  // @ts-expect-error
  return Object.assign((args) => args, {
    [RefinedConstructorsTypeId]: RefinedConstructorsTypeId,
    option: (args: any) => Option.some(args),
    either: (args: any) => Either.right(args),
    is: (_args: any): _args is Brand.Unbranded<A> & A => true
  })
}
```

The implementation is a function that returns its argument unchanged. The runtime cost of calling `CacheKey("user:42")` is exactly the same as returning `"user:42"` — one function call frame, immediately discarded. There is no allocation, no validation, no branching.

The type parameter to `Brand.nominal<A>()` is the **branded type** — the full intersection `string & Brand.Brand<"CacheKey">`. It is not the brand-key string `"CacheKey"`. This is a common source of confusion: you are not parameterising by the brand label; you are parameterising by the complete branded type that the constructor will produce.

### `src/Cache.ts` (modified)

```diff
  import * as Context from "effect/Context"
  import * as Effect from "effect/Effect"
  import * as Option from "effect/Option"
  import * as Stream from "effect/Stream"
  import type { CacheError } from "./CacheError.js"
+ import type { CacheKey } from "./CacheKey.js"

- // Forward declarations — these types land in later chapters.
- // Ch 50 introduces CacheKey; Ch 55 introduces CacheEvent.
- // CacheError variants (Missing | Backend | Encoding) were introduced in Ch 48.
- type CacheKey = string
- type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }
+ // Forward declaration — CacheEvent lands in Ch 55.
+ type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }
```

The `CacheService` interface methods (`get`, `set`, `delete`) already carried `CacheKey` in their signatures; those signatures do not change. Replacing the local type alias with an import from `./CacheKey.js` is what upgrades them from `string` to the branded type. The diff in signatures is invisible in source form but significant in the type-checker's view.

### `src/CacheError.ts` (modified)

```diff
  import * as Data from "effect/Data"
  import type * as ParseResult from "effect/ParseResult"
+ import type { CacheKey } from "./CacheKey.js"

  export class Missing extends Data.TaggedError("Missing")<{
-   readonly key: string
+   readonly key: CacheKey
  }> {}
```

`Missing.key` was previously typed as `string`. After this change it is `CacheKey`. Any caller constructing a `new Missing({ key: someString })` must now provide a `CacheKey` — if they have a raw string, they call `CacheKey(someString)` first. This is correct: if the cache can only be queried with `CacheKey` values, then a `Missing` error can only be raised for a `CacheKey` that was looked up.

### `src/index.ts` (modified)

```diff
  export * from "./Cache.js"
  export * from "./CacheError.js"
  export * from "./CacheConfig.js"
+ export * from "./CacheKey.js"
```

The addition makes both the `CacheKey` type and the `CacheKey` constructor available to consumers of `@example/effect-cache` without a deep import. A consumer can write:

```ts
import { CacheKey } from "@example/effect-cache"

const key = CacheKey("user:42")
```

---

## Why this design choice

**`Brand.nominal` over a plain type alias**

The placeholder `type CacheKey = string` is a documentation-level distinction — it tells the reader that a `string` parameter represents a cache key. But TypeScript's structural type system treats `string` and `type CacheKey = string` as identical. A function accepting `CacheKey` happily receives any `string`. The alias adds no compile-time enforcement.

`Brand.nominal<CacheKey>()` changes this. The branded type `string & Brand.Brand<"CacheKey">` is incompatible with `string`. A function that expects a `CacheKey` will reject a bare string literal at the type level. The rejection happens in the IDE and at `tsc`, before any test is run, before any staging deployment is made.

The runtime cost is zero. The source at `repos/effect/packages/effect/src/Brand.ts:269-279` confirms this: the nominal constructor is a plain `(args) => args` identity function. No allocation, no validation, no branching. The brand lives entirely in the TypeScript type graph and is erased at runtime.

**`Brand.nominal` over `Brand.refined`**

`Brand.refined` is the right choice when the brand requires a runtime predicate — for example, "this string must be between 1 and 256 characters and must not contain control characters." `Brand.refined` is defined at `repos/effect/packages/effect/src/Brand.ts:188-244` (JSDoc-inclusive). It accepts either a predicate `(unbranded: string) => boolean` paired with an error producer, or a predicate that returns `Option<BrandErrors>`. When the predicate fails, calling the constructor throws a `BrandErrors` exception or — more gracefully — returns `Either.left(errors)` via the `.either(...)` accessor.

For `CacheKey`, no runtime validation is needed at this point in the worked example. The chapter deliberately leaves charset validation and length bounds as a future exercise, noted in the `CacheKey.ts` JSDoc: "If you need length limits or charset checks, use `Brand.refined` instead." That forward-reference keeps the scope of this chapter tight while making the upgrade path obvious.

**Production precedent: `FileDescriptor` in `@effect/platform`**

`Brand.nominal` is not a toy abstraction invented for this book. The `@effect/platform` package uses it to distinguish file descriptors — integers that represent open file handles — from plain integers. The relevant source is at `repos/effect/packages/platform/src/FileSystem.ts:523-573` (JSDoc-inclusive from the `File` namespace declaration):

```ts
export declare namespace File {
  // ...
  export type Descriptor = Brand.Branded<number, "FileDescriptor">
}

/**
 * @since 1.0.0
 * @category constructor
 */
export const FileDescriptor = Brand.nominal<File.Descriptor>()
```

`File.Descriptor` is `number & Brand.Brand<"FileDescriptor">`. The OS gives you integers when you call `open(2)`. Wrapping those integers with `FileDescriptor(fd)` marks them as "this integer came from a real `open(2)` call" — not as a port number, not as a PID, not as a random count. The type system then enforces that `FileDescriptor` values only flow into file-operation functions, not into network-operation functions that also accept integers. The same principle applies to `CacheKey`: the brand marks "this string is a cache key," not a URL path, not a user display name.

**Why the type and constructor share the same name**

TypeScript allows a `type` declaration and a `const` declaration to share a name in the same module — the compiler resolves them in separate namespaces (type space vs. value space). The `CacheKey` name therefore serves double duty: as a type annotation in signatures and as a constructor function in expressions. This dual-name pattern is used throughout the Effect ecosystem for branded types and is covered in [Chapter 13 — Branded types](../part-1-foundations/13-branded-types.md).

---

## What's still missing

- **No in-memory Layer yet.** `CacheService` methods accept `CacheKey` but there is still no implementation. Chapter 51 introduces `Cache.layerMemory`, the first real Layer that creates an in-memory map keyed by `CacheKey`.
- **No dual API.** `Cache.get`, `Cache.set`, and `Cache.delete` as module-level functions (the "data-last" style that works without `yield*`) do not exist yet. Chapter 53 adds those, building on the branded key types introduced here.
- **`CacheKey` carries no validation.** As noted in the JSDoc, the current constructor accepts any string. Chapter — or a project-specific fork — could add a `Brand.refined` variant that enforces a maximum key length or rejects keys containing whitespace. That would be the right place to use `Brand.refined`.
- **`CacheEvent.key` is still `string`.** The forward-declaration `CacheEvent` in `Cache.ts` uses `readonly key: string`. Chapter 55 replaces `CacheEvent` with a proper branded-key type when the event stream is introduced.

---

## Commit

```bash
cd worked-example
git add src/CacheKey.ts src/Cache.ts src/CacheError.ts src/index.ts
git commit -m "feat: brand CacheKey for nominal typing"
```

Produced commit `10d38f4` on branch `main`.

---

## See also

- [Chapter 13 — Branded types](../part-1-foundations/13-branded-types.md) — introduces `Brand.nominal`, `Brand.refined`, the type-value name-sharing pattern, and when to use each
- [Chapter 48 — Defining the error channel](48-error-channel.md) — introduced `Missing.key: string`, now upgraded to `CacheKey`
- [Chapter 51 — Memory layer](51-memory-layer.md) — uses `CacheKey` as the `Map` key in the in-memory implementation
- [Chapter 53 — Dual API](53-dual-api.md) — module-level `Cache.get` / `Cache.set` / `Cache.delete` functions that accept `CacheKey` directly
- [Chapter 55 — Event keys](55-event-keys.md) — replaces the `CacheEvent.key: string` forward declaration with the branded `CacheKey` type
- [`Brand.nominal` / `refined` / `all` pattern catalog entry](../../research/02-patterns-catalog.md#brandnominal--refined--all) — when to use each constructor, anti-patterns replaced, and related patterns
- [`Schema.brand` / `filter` — constraints pattern catalog entry](../../research/02-patterns-catalog.md#schemabrand--filter--constraints) — alternative branding path through the Schema module for decode/encode round-trips

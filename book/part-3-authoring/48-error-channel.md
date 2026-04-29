# Chapter 48 — Defining the error channel — `CacheError` and typed failures

> **Worked-example commit:** `worked-example/` chapter 48 — `feat: define CacheError variants with Data.TaggedError`
> **Patterns demonstrated:** [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror), [`Effect.catchTag` / `catchTags` / `sandbox` — error handling](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
> **Reads from:** [Chapter 06 — Typed errors](../part-1-foundations/06-typed-errors.md), [Chapter 07 — Cause model](../part-1-foundations/07-cause-model.md)
> **Reads into:** Chapter 51 (memory layer raises `Missing`), Chapter 52 (eviction emits `Backend` errors), Chapter 56 (tests assert on tagged errors)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Chapter 47 left `CacheService` with a placeholder — `type CacheError = unknown`. That placeholder was honest: until Chapter 48, the cache has no running implementation and raises no typed errors. But `unknown` in the error channel is a library author's broken promise. Consumers of `@example/effect-cache` need to know exactly which failures can cross the error channel, so they can write `Effect.catchTag("Missing", ...)` to handle a cache miss, or `Effect.catchTag("Backend", ...)` to route storage failures to a fallback, or let `Encoding` errors surface as unhandled defects if they indicate a programming error rather than a recoverable condition.

This chapter introduces `CacheError` as a proper discriminated union of three `Data.TaggedError` variants: `Missing`, `Backend`, and `Encoding`. Each variant carries its own typed payload. Together they replace `CacheError = unknown` in `src/Cache.ts`, giving the TypeScript compiler — and every IDE that reads the generated declaration files — exact information about what can go wrong at each method boundary.

The `Data.TaggedError` choice is load-bearing. It extends the JavaScript built-in `Error` class (via `core.YieldableError`, covered below), which means stack traces are captured and browser devtools display these errors correctly. It also implements Effect's `YieldableError` interface, which means an instance can be yielded directly inside `Effect.gen` — `yield* new Missing({ key })` — without wrapping it in `Effect.fail`. Both of those properties matter for the downstream chapters that write the actual Layer implementations.

There is a secondary design goal: the error variants stay narrow. Each carries only the information its callers need to make a recovery decision. `Missing` carries the key so a logging handler knows which entry was absent. `Backend` carries the raw `cause` and the name of the failing `operation` so an observability layer can tag metrics by operation. `Encoding` carries a `ParseResult.ParseIssue` so a diagnostic layer can format the parse tree without any string-based guessing. Narrow, discriminated, typed: that is what Effect's error channel is for.

---

## What we already have

After Chapter 47, `worked-example/` has two source files and five configuration files across five commits:

```bash
$ git -C worked-example log --oneline
770a49e feat: define Cache tag and CacheService interface
79d5da5 fix: typecheck script uses -p not -b for --noEmit
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes
```

`src/Cache.ts` defines the `Cache` tag class, the `CacheService` interface with five methods, and a `make` stub that calls `Effect.die`. Three local type aliases stand in for types that have not been introduced yet:

```ts
// src/Cache.ts (before Ch 48)
type CacheKey = string        // replaced in Ch 50
type CacheError = unknown     // replaced NOW (Ch 48)
type CacheEvent = { ... }     // replaced in Ch 55
```

`src/index.ts` is a single-line barrel: `export * from "./Cache.js"`.

The `CacheService` interface uses `CacheError` in the error channel of every method that can fail. With `CacheError = unknown`, the compiler accepts anything as an error — and callers cannot write `Effect.catchTag` on `unknown`. This chapter fixes that.

---

## What we're adding

Three changes across three files:

| File | Change |
|---|---|
| `src/CacheError.ts` | **New.** Three `Data.TaggedError` subclasses (`Missing`, `Backend`, `Encoding`) and the `CacheError` union type. |
| `src/Cache.ts` | **Modified.** Replace `type CacheError = unknown` with `import type { CacheError } from "./CacheError.js"`. |
| `src/index.ts` | **Modified.** Add `export * from "./CacheError.js"`. |

After this commit the public API surface exports `Missing`, `Backend`, `Encoding`, and `CacheError` as named types. Consumers can import individual variants directly or handle the union in a single `Effect.catchTags` block.

---

## The code

### `src/CacheError.ts` (new)

```ts
import * as Data from "effect/Data"
import type * as ParseResult from "effect/ParseResult"

/**
 * Error raised when a `get` finds no entry for the requested key.
 * @since 0.1.0
 * @category errors
 */
export class Missing extends Data.TaggedError("Missing")<{
  readonly key: string
}> {}

/**
 * Error raised when the underlying storage backend fails an operation.
 * @since 0.1.0
 * @category errors
 */
export class Backend extends Data.TaggedError("Backend")<{
  readonly cause: unknown
  readonly operation: "get" | "set" | "delete" | "invalidate"
}> {}

/**
 * Error raised when Schema decode/encode fails on a stored value.
 * @since 0.1.0
 * @category errors
 */
export class Encoding extends Data.TaggedError("Encoding")<{
  readonly parseIssue: ParseResult.ParseIssue
}> {}

/**
 * Union of all CacheError variants. Use `Effect.catchTag("Missing", ...)` or
 * `Effect.catchTags({ Missing: ..., Backend: ..., Encoding: ... })` to handle them.
 * @since 0.1.0
 * @category errors
 */
export type CacheError = Missing | Backend | Encoding
```

#### `Data.TaggedError` — what it does

`Data.TaggedError` is declared at `repos/effect/packages/effect/src/Data.ts:576-590`. Its signature at line 580 is:

```ts
export const TaggedError = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A as P extends "_tag" ? never : P]: A[P] }>
) => Cause.YieldableError & { readonly _tag: Tag } & Readonly<A>
```

Calling `Data.TaggedError("Missing")` returns a constructor class. Passing it a type parameter `<{ readonly key: string }>` further constrains the constructor argument type. The result is a class whose instances satisfy:

- `Cause.YieldableError` — meaning the instance is an ES `Error`, is `Pipeable`, is `Inspectable`, and implements `[Symbol.iterator]()` so it can be yielded directly in `Effect.gen`.
- `{ readonly _tag: "Missing" }` — the discriminant field, set to the exact literal type you passed as the tag string.
- `Readonly<{ key: string }>` — the payload fields you provided as the type parameter.

The `_tag` field is auto-set by the constructor body at line 585: `readonly _tag = tag`. You never pass `_tag` as a constructor argument — the type parameter at line 581 explicitly excludes it (`P extends "_tag" ? never : P`). So `new Missing({ key: "user:42" })` produces an instance with `._tag === "Missing"` and `.key === "user:42"`.

#### Extends ES `Error` — not `Data.Structural`

A common misconception: `Data.TaggedError` is not the same as `Data.Class` or `Data.Struct`. `Data.Class` and `Data.Struct` implement `Equal.Equal` and `Hash.Hash` via `Structural` prototype methods, giving them value-equality semantics — two instances with the same fields are considered equal. `Data.TaggedError` extends `core.YieldableError` (which extends ES `Error`), not `Structural`. Two distinct `Missing` instances with the same `key` are **not** structurally equal by default. They are separate JavaScript objects with separate identity.

This matters when writing test assertions. If you write:

```ts
expect(error).toEqual(new Missing({ key: "user:42" }))
```

Vitest's `toEqual` performs a deep structural comparison that will pass regardless of `Equal.Equal`. But if you write:

```ts
expect(error).toBe(new Missing({ key: "user:42" }))
```

that will fail because `toBe` uses `===` (reference equality), and these are two different object instances. This is standard ES `Error` behaviour — Effect does not change it for `TaggedError`.

`YieldableError` is declared at `repos/effect/packages/effect/src/Cause.ts:305-317`. Its JSDoc (lines 305–309) reads: _"Represents an error object that can be yielded in `Effect.gen`."_ The interface at lines 311–316 shows the four type IDs it satisfies — `Effect`, `Stream`, `Sink`, and `Channel` — meaning a `TaggedError` instance is a valid "Effect that fails immediately with itself" across all four channel types. That is what makes `yield* new Missing({ key })` work without `Effect.fail`.

#### The `ParseResult` import

`Encoding` stores a `ParseResult.ParseIssue` — the structured parse failure tree produced by Schema operations. The import at the top of `src/CacheError.ts` is:

```ts
import type * as ParseResult from "effect/ParseResult"
```

The `effect/ParseResult` subpath is valid. The `package.json` for the `effect` package at version 3.21.2 exposes a wildcard export map (`./*` → `./src/*.ts`), which makes `effect/ParseResult` resolve to `repos/effect/packages/effect/src/ParseResult.ts`. `ParseResult` is also re-exported from the main `effect` barrel at `repos/effect/packages/effect/src/index.ts:1091` as `export * as ParseResult from "./ParseResult.js"`, so an alternative import `import { ParseResult } from "effect"` would also work — but the subpath form is the conventional style throughout Effect's own library code.

`ParseResult.ParseIssue` is the discriminated union defined at `repos/effect/packages/effect/src/ParseResult.ts:23-39`:

```ts
export type ParseIssue =
  | Type | Missing | Unexpected | Forbidden   // leaf variants
  | Pointer | Refinement | Transformation | Composite  // composite variants
```

Storing a `ParseIssue` rather than a `string` in `Encoding.parseIssue` is intentional: Chapter 49 will use `Schema.decodeUnknownEither` to validate config, and Chapter 56's tests will assert against the exact `ParseIssue` tree using `Schema.formatIssue` or `ParseResult.isType`. A stringified error message would make those assertions brittle.

> _Note: `ParseResult.Missing` is a parse-issue class, not the same type as `CacheError.Missing` defined in this chapter. The namespace separation keeps them unambiguous._

#### `src/Cache.ts` (modified)

The change is targeted: remove `type CacheError = unknown`, add the import.

```diff
 import * as Context from "effect/Context"
 import * as Effect from "effect/Effect"
 import * as Option from "effect/Option"
 import * as Stream from "effect/Stream"
+import type { CacheError } from "./CacheError.js"

 // Forward declarations — these types land in later chapters.
-// Ch 48 introduces CacheError variants; Ch 50 introduces CacheKey; Ch 55 introduces CacheEvent.
-// For Ch 47 we use placeholders so the interface signature is clear without the imports.
+// Ch 50 introduces CacheKey; Ch 55 introduces CacheEvent.
+// CacheError variants (Missing | Backend | Encoding) were introduced in Ch 48.
 type CacheKey = string
-type CacheError = unknown
 type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }
```

The `CacheService` interface is unchanged in shape — every method that previously used `CacheError` (the `unknown` alias) now uses `CacheError` (the `Missing | Backend | Encoding` union). The change is invisible at the surface level but material to the type system. Now when a Layer implementation (Chapter 51) writes:

```ts
Effect.fail(new Missing({ key }))
```

the compiler verifies that `Missing` is assignable to the declared error channel of `CacheService.get`. Before this chapter, with `CacheError = unknown`, the compiler would have accepted `Effect.fail("any string")` in that position.

#### `src/index.ts` (modified)

```ts
export * from "./Cache.js"
export * from "./CacheError.js"
```

Both wildcard re-exports use `.js` extensions, as required under `"moduleResolution": "NodeNext"`. Consumers who install `@example/effect-cache` can import any of the error variants directly:

```ts
import { Missing, Backend, Encoding, type CacheError } from "@example/effect-cache"
```

---

## Why this design choice

### Three variants over one omnibus error

A single-variant design is tempting:

```ts
export class CacheError extends Data.TaggedError("CacheError")<{
  readonly kind: "Missing" | "Backend" | "Encoding"
  readonly detail: unknown
}> {}
```

This compiles. It fails at the call site. `Effect.catchTag("CacheError", handler)` catches every `CacheError` regardless of `kind`. The handler receives the full union and must switch on `kind` itself — a manual dispatch that the Effect runtime would otherwise perform for free. The three-variant design delegates that dispatch to `Effect.catchTag` and `Effect.catchTags`, which are built precisely to narrow by `_tag`.

`Effect.catchTag` is declared at `repos/effect/packages/effect/src/Effect.ts:3825-3890`. Its JSDoc (lines 3825–3881) documents the pattern: the function reads the error's `_tag` field to match the handler, narrows the error type passed to the handler callback, and removes the matched tag from the downstream error union. `catchTags` (lines 3892–3948) accepts an object literal whose keys are tag strings, dispatching to the appropriate handler for each. Together they let a caller handle all three cache error variants in one expression:

```ts
program.pipe(
  Effect.catchTags({
    Missing: (e) => Effect.succeed(fallback),
    Backend: (e) => logAndFail(e),
    Encoding: (e) => Effect.die(e)   // re-raise as defect — programming error
  })
)
```

Without separate variants that carry literal `_tag` types, none of that works. `Match.tag` (from `effect/Match`) also reads `_tag` — so the same variants work with pattern matching when Effect's `Match` module is used in Chapter 53.

### `_tag` over `kind` over class checking

Why `_tag` and not a `kind` field or `instanceof` checks? Two reasons. First, Effect's standard convention — every tagged type in the Effect ecosystem uses `_tag` as the discriminant, including `Option`, `Either`, `Exit`, `Cause`, and all `Data.TaggedError` subclasses. Deviating from this convention means the `catchTag` / `catchTags` / `Match.tag` family of APIs cannot be used without adaptation. Second, `instanceof` checks break across module boundaries when code is bundled, duplicated, or loaded in different realms (e.g., iframes, workers). `_tag` is a plain string comparison that survives serialization, cloning, and realm hopping.

### Why `cause: unknown` on `Backend` rather than a typed error

`Backend.cause` is typed `unknown` because the storage layer backing the cache is not yet defined. Chapters 51 and 52 will use a simple in-memory `Map` — that implementation never produces a `Backend` error at all. A future Redis or SQLite backend would wrap its native client errors in `Backend`. Keeping `cause: unknown` here preserves the widest possible slot for the runtime implementation to fill without changing the public type signature when the concrete storage lands.

---

## What's still missing

After this chapter, `src/CacheError.ts` defines the three variants but nothing raises them yet:

- **`Missing` not raised yet.** Chapter 51 (`Cache.layerMemory`) adds the in-memory implementation. Its `get` method returns `Option.none()` (a successful cache miss) for now; it will raise `Missing` when a separate "fail-on-miss" mode is added — or when the caller explicitly maps `Option.none()` to `Missing` via `Effect.flatMap`. The exact boundary is decided in Chapter 51.
- **`Backend` not raised yet.** No storage backend exists. Chapter 52 (`Cache.layerMemoryWithEviction`) introduces time-based eviction via `Schedule`; if eviction itself can fail, `Backend` is the error. Chapter 51's pure in-memory layer has no backend failures.
- **`Encoding` not raised yet.** Chapter 49 introduces `CacheConfig` as a `Schema.Class`. The `Encoding` variant will be used when a stored value fails its Schema decode — the exact wiring depends on whether the cache stores typed values (Chapter 50 introduces a typed key; a typed value schema is a possible Chapter 53 extension).
- **`CacheKey` still a `string` placeholder.** Chapter 50 replaces `type CacheKey = string` with a `Brand.nominal` brand. `Missing.key` is typed `string` here deliberately — Ch 50 will update `Missing.key` to `CacheKey` once the brand exists, so the error carries the branded key rather than a raw string.
- **`ParseIssue` field type.** `Encoding.parseIssue` is typed `ParseResult.ParseIssue` — the full discriminated union of eight parse-issue variants. Chapter 49's `CacheConfig` schema integration will be the first site that actually constructs an `Encoding` instance, so the integration test for `Encoding` lives in Chapter 56.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add src/CacheError.ts src/Cache.ts src/index.ts
git commit -m "feat: define CacheError variants with Data.TaggedError"
```

After this commit, `git log --oneline` shows:

```bash
209bb04 feat: define CacheError variants with Data.TaggedError
770a49e feat: define Cache tag and CacheService interface
79d5da5 fix: typecheck script uses -p not -b for --noEmit
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
99b1b8f fix: CacheKey constructor call, README imports
10c9764 chore: initial README and design notes
```

---

## See also

- [Chapter 51 — First Layer — `Cache.layerMemory` with `Layer.effect`](../part-3-authoring/51-layer-memory.md) — the first Layer implementation raises `Missing` for absent keys; `Backend` may be raised if the map operation throws unexpectedly
- [Chapter 52 — Eviction Layer — `Cache.layerMemoryWithEviction` with `Layer.scoped`](../part-3-authoring/52-eviction.md) — the eviction layer raises `Backend` errors when eviction scheduling fails
- [Chapter 56 — Testing — `Effect.runPromise`, `vitest`, and asserting on tagged errors](../part-3-authoring/56-testing.md) — test assertions use `Effect.catchTag` and match on `._tag` to verify that the correct error variant is raised
- [Chapter 06 — Typed errors](../part-1-foundations/06-typed-errors.md) — foundational chapter on why Effect models failures in the error channel rather than via exceptions; the `Data.TaggedError` pattern used here is the production form of the concepts introduced there
- [Chapter 07 — Cause model](../part-1-foundations/07-cause-model.md) — explains `Cause.Fail`, `Cause.Die`, and `Cause.Interrupt`; `Data.TaggedError` instances appear in `Cause.Fail` nodes; `Effect.die(new Encoding(...))` promotes an `Encoding` instance to a `Cause.Die` defect
- [Patterns catalog — `Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror)
- [Patterns catalog — `Effect.catchTag` / `catchTags` / `sandbox` — error handling](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
- `repos/effect/packages/effect/src/Data.ts:576-590` — `Data.TaggedError` declaration with JSDoc
- `repos/effect/packages/effect/src/Cause.ts:305-326` — `YieldableError` interface declaration
- `repos/effect/packages/effect/src/Effect.ts:3825-3890` — `catchTag` JSDoc and declaration
- `repos/effect/packages/effect/src/Effect.ts:3892-3948` — `catchTags` JSDoc and declaration
- `repos/effect/packages/effect/src/ParseResult.ts:23-39` — `ParseIssue` union type

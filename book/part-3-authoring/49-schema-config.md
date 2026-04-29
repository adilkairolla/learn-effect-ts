# Chapter 49 — Schema-driven config — `CacheConfig` and environment loading

> **Worked-example commit:** `worked-example/` chapter 49 — `feat: schema-driven CacheConfig with Config integration`
> **Patterns demonstrated:** [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct), [`Schema.Class` and `Schema.TaggedClass`](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass), [`Config.string` / `integer` / `boolean` / `nested` / `all`](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all)
> **Reads from:** [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md), [Chapter 15 — Schema part 2](../part-1-foundations/15-schema-part-2.md), [Chapter 38 — Config and secrets](../part-2-tour/38-config-and-secrets.md)
> **Reads into:** Chapter 51 (memory layer reads CacheConfig), Chapter 52 (eviction reads TTL from config)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Every non-trivial cache has at least three tunable numbers: how long an entry lives by default, how many entries can coexist before the oldest are evicted, and how frequently the eviction sweep runs. Hard-coding those numbers produces brittle software. Accepting them as unvalidated strings from environment variables produces subtle bugs — a negative TTL or a zero entry limit will cause runtime failures far from the configuration site, with no helpful error message.

This chapter introduces `CacheConfig` — a typed, schema-validated configuration object whose values come from environment variables and are validated at startup. The two-layer design is deliberate: `Config.integer` handles the mechanical work of reading env vars, reporting missing variables, and coercing strings to numbers. `Schema.decode(CacheConfig)` adds the domain invariants: all three integers must be strictly positive. If any env var is absent or invalid, the `load` effect fails fast at startup with a typed error — before any cache operation is attempted.

`CacheConfig` is also the bridge between Part II's chapters on Schema and Config (Chapters 14, 15, 38) and the upcoming Layer implementations. Chapter 51 will receive `CacheConfig` via a Layer dependency; Chapter 52 will read the eviction interval directly from the config object. By introducing the config type now — before the layers exist — we establish the full data flow: environment → validated config → layer wiring → operational cache service.

The design also demonstrates `Schema.Class` over `Schema.Struct`. Both can validate an object. Only `Schema.Class` produces a real class instance, which means `instanceof CacheConfig` works, the class can carry methods, and the identity is stable enough to use as a dependency key if needed in later chapters.

---

## What we already have

After Chapter 48, `worked-example/` contains three committed files across five commits:

```bash
$ git -C worked-example log --oneline
209bb04 feat: define CacheError variants with Data.TaggedError
770a49e feat: define Cache tag and CacheService interface
79d5da5 fix: typecheck script uses -p not -b for --noEmit
8b59b08 chore: initial package.json, tsconfig, vitest.config, gitignore
10c9764 chore: initial README and design notes
```

`src/Cache.ts` defines the `Cache` tag and `CacheService` interface. Three placeholder types remain in that file:

```ts
// src/Cache.ts — still present after Ch 48
type CacheKey = string               // replaced in Ch 50
type CacheEvent = { readonly _tag: "Hit" | "Miss" | "Set" | "Evict"; readonly key: string }
                                     // replaced in Ch 55
```

`src/CacheError.ts` defines `Missing`, `Backend`, and `Encoding` as `Data.TaggedError` subclasses and the `CacheError` union type. `src/index.ts` re-exports both files.

No configuration type exists yet. `CacheService.set` accepts an optional `ttlMillis?: number` parameter that callers can provide, but there is no default TTL and no cap on entry count. The cache is fully configurable by its callers — and fully unconstrained.

---

## What we're adding

Two changes across two files:

| File | Change |
|---|---|
| `src/CacheConfig.ts` | **New.** `CacheConfig` class (via `Schema.Class`) with three fields; `load` helper that reads env vars with `Config.all` then validates with `Schema.decode`. |
| `src/index.ts` | **Modified.** Add `export * from "./CacheConfig.js"`. |

After this commit the public API exports `CacheConfig` as a class and `load` as a typed Effect.

---

## The code

### `src/CacheConfig.ts` (new)

```ts
import * as Config from "effect/Config"
import * as ConfigError from "effect/ConfigError"
import * as Effect from "effect/Effect"
import * as ParseResult from "effect/ParseResult"
import * as Schema from "effect/Schema"

/**
 * Configuration for the cache. All values come from environment variables via
 * `Config`, then validated by `Schema.decode` for stricter type checks (positive
 * integers, sane bounds, etc).
 *
 * @since 0.1.0
 * @category models
 */
export class CacheConfig extends Schema.Class<CacheConfig>("CacheConfig")({
  defaultTtlMillis: Schema.Number.pipe(Schema.int(), Schema.positive()),
  maxEntries: Schema.Number.pipe(Schema.int(), Schema.positive()),
  evictionIntervalMillis: Schema.Number.pipe(Schema.int(), Schema.positive())
}) {}

/**
 * Load `CacheConfig` from process environment via `Config`. Each env var is loaded
 * as an integer, then the whole object is run through `Schema.decode(CacheConfig)`
 * for the per-field invariants (positivity, etc).
 *
 * Default env var names:
 * - `CACHE_DEFAULT_TTL_MS`
 * - `CACHE_MAX_ENTRIES`
 * - `CACHE_EVICTION_INTERVAL_MS`
 *
 * @since 0.1.0
 * @category constructors
 */
export const load: Effect.Effect<CacheConfig, ConfigError.ConfigError | ParseResult.ParseError> =
  Effect.gen(function* () {
    const raw = yield* Config.all({
      defaultTtlMillis: Config.integer("CACHE_DEFAULT_TTL_MS"),
      maxEntries: Config.integer("CACHE_MAX_ENTRIES"),
      evictionIntervalMillis: Config.integer("CACHE_EVICTION_INTERVAL_MS")
    })
    return yield* Schema.decode(CacheConfig)(raw)
  })
```

#### `Schema.Class` — the class factory

`Schema.Class` is defined at `repos/effect/packages/effect/src/Schema.ts:8696-8713`. The JSDoc shows the canonical usage:

```ts
class MyClass extends Schema.Class<MyClass>("MyClass")({
  someField: Schema.String
}) {
  someMethod() {
    return this.someField + "bar"
  }
}
```

The double-application pattern — `Schema.Class<Self>(identifier)(fields)` — is intentional. The first call fixes the `Self` type parameter and the identifier string used for schema annotation and error messages. The second call receives the fields record and returns a base class to extend. `CacheConfig` follows this pattern exactly: no methods are added yet (the body is empty), but the class form is chosen deliberately so methods can be added later without breaking the public API surface.

`Schema.Class` was introduced in v3.10.0 when Schema migrated from the separate `@effect/schema` package into the core `effect` package. If you are reading older code (pre-3.10.0), you may see `import { Schema } from "@effect/schema"` — that import path no longer works for the pinned version used in this book.

#### `Schema.Number`, `Schema.int()`, `Schema.positive()` — field constraints

`Schema.Number` is the primitive number schema, exported at `repos/effect/packages/effect/src/Schema.ts:1231-1240` (as `Number$ as Number` in the export block).

`Schema.int()` is a filter that rejects non-integer numbers (NaN, Infinity, and fractional values), defined at `repos/effect/packages/effect/src/Schema.ts:5099-5116`. It calls the lower-level `filter` combinator with `Number.isSafeInteger`.

`Schema.positive()` is a filter that rejects values ≤ 0, defined at `repos/effect/packages/effect/src/Schema.ts:5244-5251`. It delegates to `greaterThan(0, ...)`.

The pipe chain `Schema.Number.pipe(Schema.int(), Schema.positive())` threads the base number schema through both filters in order. If a field receives `-1`, `Schema.positive` raises the parse error. If it receives `1.5`, `Schema.int` raises it. If it receives `NaN`, `Schema.int` catches that too. The field type remains `number` in TypeScript — these are runtime-only invariants.

#### `Config.integer` and `Config.all`

`Config.integer` is defined at `repos/effect/packages/effect/src/Config.ts:180-186`. It reads an environment variable by name and parses it as an integer. If the variable is absent, Effect raises a `ConfigError.MissingData`; if the value cannot be parsed as an integer, it raises `ConfigError.InvalidData`.

`Config.all` is defined at `repos/effect/packages/effect/src/Config.ts:97-114`. When given a `Record<string, Config<any>>`, it resolves all configs in parallel and returns the same record shape with each value resolved. The error type for a failed `yield* Config.all(...)` inside `Effect.gen` is `ConfigError.ConfigError` — the union type exported from `"effect/ConfigError"`.

#### `Schema.decode` — the validation step

`Schema.decode` is defined at `repos/effect/packages/effect/src/Schema.ts:595-602`:

```ts
export const decode: <A, I, R>(
  schema: Schema<A, I, R>,
  options?: ParseOptions
) => (i: I, overrideOptions?: ParseOptions) => Effect.Effect<A, ParseResult.ParseError, R>
```

Note the error type: `ParseResult.ParseError`, not `ParseResult.ParseIssue`. `ParseError` is a `TaggedError` wrapping a `ParseIssue` tree (defined at `repos/effect/packages/effect/src/ParseResult.ts:214-266`). The `ParseIssue` is the internal recursive structure that represents exactly what went wrong in the decode tree; `ParseError` is the typed `Effect` error that wraps it for the error channel.

`ParseResult` is a separate module, importable as `import * as ParseResult from "effect/ParseResult"`. The `Schema` module uses `ParseResult` internally but does not re-export it as a namespace — `Schema.ParseResult` does not exist.

#### `src/index.ts` (modified)

```diff
  export * from "./Cache.js"
  export * from "./CacheError.js"
+ export * from "./CacheConfig.js"
```

The single-line addition exposes `CacheConfig` and `load` as top-level named exports from the package.

---

## Why this design choice

**`Schema.Class` over `Schema.Struct`**

`Schema.Struct` would produce a schema and a corresponding TypeScript type alias, but no class. `Schema.Class` produces all of that plus a real JavaScript class: the decoded value is an actual `CacheConfig` instance, so `value instanceof CacheConfig` returns `true` and methods can be added in-place without breaking the schema or the decode/encode round-trip.

The catalog entry at `research/02-patterns-catalog.md#schemaclass-and-schemataggedclass` notes that `Schema.Class` is the right choice "when you need domain model objects that carry methods." Even though `CacheConfig` has no methods today, locking in the class form now means Chapter 51 can add a `defaultTtlSeconds()` convenience accessor without touching any consumer of the existing API.

A production reference: `repos/effect/packages/cluster/src/RunnerAddress.ts:24-31` uses `Schema.Class` for `RunnerAddress`:

```ts
export class RunnerAddress extends Schema.Class<RunnerAddress>(SymbolKey)({
  host: Schema.NonEmptyString,
  port: Schema.Int
}) {
  [PrimaryKey.symbol](): string { return `${this.host}:${this.port}` }
  [Equal.symbol](that: RunnerAddress): boolean { ... }
  // ...
}
```

`RunnerAddress` is a config-like domain object (host + port) that adds `PrimaryKey`, `Equal`, and `Hash` implementations as methods. It would be impossible to add those protocols to a plain `Schema.Struct` result. The same extensibility argument applies to `CacheConfig`.

**`Config` + `Schema` over `Config` alone**

`Config.integer` validates that the env var is parseable as an integer. It does not validate that the integer is positive or within a sane range. A misconfigured `CACHE_MAX_ENTRIES=0` would pass `Config.integer` and silently produce a zero-entry cache, which would likely cause every `set` call to immediately evict the value that was just written.

The `Schema.decode(CacheConfig)(raw)` step adds the domain invariants that `Config` cannot express: positivity checks on all three fields. If `CACHE_MAX_ENTRIES=0` is set, the `load` effect fails with a `ParseResult.ParseError` before any cache layer is constructed, with a message that names the failing field and the violated constraint (`positive`). This is the correct place to fail: at startup, before the service is available, rather than silently at runtime during the first eviction sweep.

The combination also makes the config testable: `Config.all` is driven by a `ConfigProvider` that can be replaced with `ConfigProvider.fromMap(new Map([...]))` in tests, and `Schema.decode` is a pure function whose failure cases can be exercised without touching `process.env`.

**`ConfigError.ConfigError | ParseResult.ParseError` as the error union**

The `load` effect's error type is explicit rather than inferred. This documents the two failure modes for readers of the module: the first (from `Config`) means a missing or unparseable env var; the second (from Schema decode) means a structurally valid integer that violates the positivity constraint. A Layer that wraps `load` can choose to handle each case differently — converting a `ConfigError.MissingData` into a logged warning with defaults, for example, while propagating a `ParseError` as a fatal startup failure.

---

## What's still missing

- **No default values.** If `CACHE_DEFAULT_TTL_MS` is absent, `load` fails. Chapter 51 may wrap `load` in a Layer that provides sensible defaults using `Config.withDefault`. This is intentional — the library forces callers to be explicit rather than silently choosing a TTL on their behalf.
- **No `Redacted` fields.** A real-world cache might be backed by Redis and require an authentication token. That token should use `Config.redacted` (or `Config.secret`) rather than `Config.string`, and the schema field would be `Schema.Redacted(Schema.String)`. Chapter 27 of Part II covers `Redacted`; we would apply it here if an auth token field were introduced in a later chapter.
- **`CacheKey` is still `string`.** The `CacheService` methods accept `CacheKey = string` as a placeholder. Chapter 50 introduces a branded `CacheKey` type with `Schema.brand`. Until then, any string is a valid cache key with no structural validation.
- **`CacheConfig` is not yet wired into any Layer.** The `load` Effect exists but nothing calls it. Chapter 51 constructs the in-memory cache layer and receives `CacheConfig` as a Layer dependency; Chapter 52 reads the eviction interval from it.

---

## Commit

```bash
cd worked-example
git add src/CacheConfig.ts src/index.ts
git commit -m "feat: schema-driven CacheConfig with Config integration"
```

Produced commit `5f19af5` on branch `main`.

---

## See also

- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md) — introduces `Schema.Struct`, `Schema.decode`, and the `Schema<A, I, R>` type
- [Chapter 15 — Schema part 2](../part-1-foundations/15-schema-part-2.md) — covers `Schema.Class`, `Schema.brand`, `Schema.filter`, and class-level invariants
- [Chapter 38 — Config and secrets](../part-2-tour/38-config-and-secrets.md) — covers `Config.string`, `Config.integer`, `Config.all`, `ConfigProvider`, and `Redacted`
- [Chapter 51 — Memory layer](51-memory-layer.md) — constructs `Cache.layerMemory` using `CacheConfig` as a Layer dependency
- [Chapter 52 — Eviction layer](52-eviction-layer.md) — reads `evictionIntervalMillis` from `CacheConfig` to drive the sweep schedule
- [`Schema.Struct` pattern catalog entry](../../research/02-patterns-catalog.md#schemastruct) — when to use Struct vs Class
- [`Schema.Class` pattern catalog entry](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass) — class factory, extensions, and production examples
- [`Config.integer` / `Config.all` pattern catalog entry](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all) — env var wiring, record form, `ConfigProvider.fromMap` in tests

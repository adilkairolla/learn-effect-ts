# Chapter 45 — Overview — what we are building and why

> **Worked-example commit:** `worked-example/` chapter 45 — `chore: initial README and design notes`
> **Patterns demonstrated:** [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors) (foreshadowed — the API surface is sketched in `DESIGN.md`; `.make` factories are implemented from Chapter 47 onward)
> **Reads from:** Chapter 11 (Constructors — `.make`, `.of`, `.from*` and the naming conventions); Chapter 22 (Platform services — abstract service tag as a model); Chapter 26 (SQL part 2 — drivers — `Cache.make` for prepared-statement memoization as domain inspiration)
> **Reads into:** Every later Part III chapter (46–60)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Part III is about authoring. Parts I and II gave you the vocabulary — typed errors, `Layer`
composition, `Stream`, branded types, `Schema`, the dual API — and showed you those patterns
in the Effect source and in the official packages. Part III turns the telescope around: you are
now the library author, and the question is how to assemble those patterns into a coherent,
publishable Effect package.

To make that concrete, Part III builds a single worked example from scratch over sixteen chapters:
`@example/effect-cache`, a **TTL cache with pluggable storage layers**. The package is small enough
to fit comfortably in a book — about 400 lines of production source and 200 lines of tests at
completion — but large enough to exercise every pattern that matters:

- **Service design:** a `Context.Tag` with a narrow `CacheService` interface, following the
  abstract-tag convention established by `@effect/platform` (Chapter 22).
- **Layer composition:** two layers — `Cache.layerMemory` (`Layer.effect`) and
  `Cache.layerMemoryWithEviction` (`Layer.scoped`) — showing how resource lifetimes compose.
- **Typed errors:** three `Data.TaggedError` variants (`Missing`, `Backend`, `Encoding`) giving
  callers fine-grained `Effect.catchTag` recovery.
- **Schema-driven config:** `CacheConfig` as a `Schema.Class`, loadable from environment variables
  or hard-coded in tests.
- **Branded keys:** `CacheKey` via `Brand.nominal`, preventing accidental `string` misuse.
- **Event telemetry:** a `Stream<CacheEvent>` backed by `PubSub.unbounded`, so callers can observe
  cache activity without tight coupling.
- **Dual API:** every operation exposed as both a data-first and data-last overload via
  `Function.dual(...)`.
- **Publishing discipline:** exports map, dual ESM/CJS, changesets, and JSDoc — the same checklist
  Effect's own packages follow.

This chapter — Chapter 45 — commits no code. Its job is to orient you: what the package will look
like when finished, why this domain was chosen, and which chapter handles which piece. Every
subsequent chapter (46–60) maps to exactly one commit in the `worked-example/` repository.

---

## What we're adding

This is the first chapter in Part III and the first commit in the `worked-example/` repository.
Because the repository was empty before this chapter (it had zero commits), the "What we already
have" section is skipped — there is nothing to recap.

Two files are committed:

- **`README.md`** — a user-facing introduction to `@example/effect-cache`. It contains one
  orientation paragraph, an intended-usage code sketch showing the full public API in action, the
  final package layout, and a table mapping each chapter to its committed files.

- **`DESIGN.md`** — the design record. It specifies the full intended public API (service tag,
  interface, layers, errors, config, branded keys, events), the layer composition plan, the storage
  plug-point interface, the patterns being demonstrated, and the explicit non-goals. This document
  is not replaced as the implementation progresses — it is updated once more in Chapter 60
  (retrospective) with notes on what the final implementation confirmed or revised.

No `src/` directory exists yet. No `package.json`, no `tsconfig.json`. This chapter is purely a
design commit: we are deciding what to build before writing a single line of TypeScript.

---

## The code

### `README.md` (new)

The README opens with a one-paragraph orientation:

    `@example/effect-cache` is the worked example for Part III of the Effect TS Book. It is a
    TTL cache with pluggable storage layers — small enough to be built chapter by chapter over sixteen
    chapters (45–60), yet large enough to demonstrate the full authoring toolkit: service `Tag` design,
    `Layer` composition, typed error channels, `Schema`-driven configuration, `Brand`ed keys, `Stream`
    event telemetry, the dual data-first / data-last API style, JSDoc conventions, and the versioning
    and publishing checklist that every production Effect package needs.

It then shows the intended public usage in a TypeScript sketch — the full API surface assembled into
a single `Effect.gen` block:

```ts
import { Cache, CacheKey } from "@example/effect-cache"
import { Effect, Stream, Console } from "effect"

const key = CacheKey.make("user:42")

const program = Effect.gen(function* () {
  yield* Cache.set(key, { name: "Alice" }, { ttlMillis: 60_000 })
  const user = yield* Cache.get(key)
  console.log(user)
  yield* Cache.delete(key)
  yield* Cache.invalidate
})

const main = program.pipe(
  Effect.provide(Cache.layerMemoryWithEviction)
)

const monitorEvents = Cache.events.pipe(
  Stream.tap((event) => Console.log("cache event", event)),
  Stream.runDrain
)
```

This sketch is aspirational — none of it compiles yet — but it is the north star for the next
fifteen chapters. Writing the usage example first is a deliberate authoring technique: it forces
you to decide the API shape before you are deep in implementation details and tempted to let
implementation constraints leak into the public surface.

The README also includes a chapter-progression table that maps each of chapters 45–60 to the files
it commits. This table is the book's TOC rendered in the repository itself, so that a reader
cloning `worked-example/` can navigate the history without the book open.

### `DESIGN.md` (new)

`DESIGN.md` is the engineering record. Its sections track directly to the implementation chapters:

**Service tag and interface** — specifies `Cache extends Context.Tag(...)()` and the five-method
`CacheService` interface. The `Context.Tag` class pattern (Chapter 08 in the Foundations) is the
correct choice over a plain `GenericTag` because it gives the tag a stable string identifier
(`"@example/effect-cache/Cache"`) suitable for debugging and serialization. Chapter 47 implements
this.

**Error variants** — three `Data.TaggedError` subclasses inside a `CacheError` namespace. Grouping
related errors under a namespace (rather than exporting `MissingError`, `BackendError` at top
level) keeps the public API surface readable and allows barrel imports like
`import type { CacheError } from "@example/effect-cache"`. Chapter 48 implements this.

**Layer composition plan** — the ASCII diagram in `DESIGN.md` shows both layers sharing the same
`MemoryStorage.make` and `PubSub.unbounded` setup, differing only in whether the eviction fiber
is forked:

```
CacheConfig (required)
    │
    ├── Cache.layerMemory
    │       └── Layer.effect(Cache, Effect.gen(function* () { ... }))
    │
    └── Cache.layerMemoryWithEviction
            └── Layer.scoped(Cache, Effect.gen(function* () {
                    ...
                    yield* eviction.startFiber(storage, config) // forkScoped
                    ...
                }))
```

The key insight captured in the diagram is that `Layer.scoped` — covered in Chapter 10 — is the
right constructor when the layer allocates a resource (the eviction fiber) that must be released
when the layer is torn down. `Effect.forkScoped` ties the fiber's lifetime to the `Scope`, so
interruption is guaranteed even if the program crashes. Chapter 52 implements this.

**Storage plug points** — `DESIGN.md` specifies a `StorageBackend` interface that lives in
`internal/storage.ts` and is never re-exported. This is the `internal/` convention from Chapter 22:
implementation details that could change between minor versions belong inside `internal/` so the
public API contract stays stable. Chapter 54 formalizes this.

**Non-goals** — the section lists six explicit non-goals: LRU eviction, multi-tier cache, distributed
coherence, pluggable value codec, metrics integration, and React/SSR compatibility. Documenting
non-goals in `DESIGN.md` — not just in the README — serves two purposes: it prevents scope creep
during implementation, and it signals to future contributors what was considered and deliberately
deferred rather than forgotten.

---

## Why this design choice

Why `effect-cache` as the worked example, rather than an HTTP client, a job queue, or a logger?

The primary criterion is **pattern coverage per line of code**. A TTL cache naturally requires:

- A service `Tag` (the cache is a dependency, not a singleton)
- At least two `Layer` variants (memory vs. memory-with-eviction), forcing you to distinguish
  `Layer.effect` from `Layer.scoped`
- A `Stream` for events (real use case, not a contrived one)
- A branded key type (`CacheKey` over raw `string`)
- A `Schema.Class` for config (TTL and capacity are environment-configurable)
- Typed errors at three granularities (missing key, backend failure, encoding failure)
- The dual API (every method is both pipeable and callable directly)

No other domain of comparable size forces all seven of these patterns simultaneously.

The secondary criterion is **familiarity**. Every developer has used a cache. The domain requires no
background knowledge about databases, network protocols, or encoding formats. A reader new to Effect
library authoring does not also need to learn the domain.

For comparison, look at the real `Cache.make` in Effect's own source at
`repos/effect/packages/effect/src/Cache.ts:195-208`:

```ts
/**
 * Constructs a new cache with the specified capacity, time to live, and
 * lookup function.
 *
 * @since 2.0.0
 * @category constructors
 */
export const make: <Key, Value, Error = never, Environment = never>(
  options: {
    readonly capacity: number
    readonly timeToLive: Duration.DurationInput
    readonly lookup: Lookup<Key, Value, Error, Environment>
  }
) => Effect.Effect<Cache<Key, Value, Error>, never, Environment> = internal.make
```

Effect's built-in `Cache` is more powerful than `effect-cache`: it is parameterized over both `Key`
and `Value`, it handles concurrent lookup deduplication, and it exposes cache statistics. That scope
would require 30+ chapters, not 16. `effect-cache` deliberately narrows the scope — values are
`unknown`, lookup is caller-side, statistics are left as a non-goal — so the implementation stays
thin enough to fit the book while still demonstrating every authoring pattern.

The `.make` constructor pattern established in Chapter 11 (Constructors) is the pattern this worked
example will follow throughout. Every module in `effect-cache` exposes a `.make` factory: `Cache.make`,
`CacheKey.make`, `MemoryStorage.make`. Naming consistency is not cosmetic — it is how readers of an
Effect package discover its entry points without reading the source.

---

## What's still missing

This chapter leaves everything except the design documents unimplemented. Each bullet below names
the chapter that fills the gap:

- **Chapter 46** — build setup: `package.json`, `tsconfig.json` variants, `vitest.config.ts`, and
  `.gitignore` matching Effect monorepo conventions. Without this, nothing compiles.
- **Chapter 47** — the `Cache` tag, `CacheService` interface, and the `.make` constructor stub.
  This is the first TypeScript in the repository.
- **Chapter 48** — `CacheError` tagged error variants. Until these exist, the error channel
  is `never` and callers have no recovery surface.
- **Chapter 49** — `CacheConfig` as a `Schema.Class` with `Config` integration.
- **Chapter 50** — `CacheKey` branded type. Until this chapter, the signature uses raw `string`.
- **Chapter 51** — `Cache.layerMemory` with the in-memory storage backend. The first runnable layer.
- **Chapter 52** — `Cache.layerMemoryWithEviction` with the scoped eviction fiber. The first
  `Layer.scoped` in the package.
- **Chapter 53** — the dual API: `Cache.get`, `Cache.set`, `Cache.delete`, `Cache.invalidate` as
  `dual(...)` overloads.
- **Chapter 54** — the `internal/` module refactor: `storage.ts` abstract interface, re-exports
  tightened.
- **Chapter 55** — `CacheEvent` tagged enum and the `.events` stream via `PubSub.unbounded`.
- **Chapter 56** — the test suite: `it.effect` and `it.scoped` with `@effect/vitest`.
- **Chapter 57** — JSDoc: `@since`, `@category`, `@example` tags on every public export.
- **Chapter 58** — exports map, `"type": "module"`, dual ESM/CJS, version policy.
- **Chapter 59** — publishing checklist: changesets, peer dependencies, `CHANGELOG.md`.
- **Chapter 60** — retrospective: `DESIGN.md` updated with what the implementation confirmed,
  what it revised, and how each pattern from the catalog manifested.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add README.md DESIGN.md
git commit -m "chore: initial README and design notes"
```

---

## See also

- [`../part-1-foundations/11-constructors.md`](../part-1-foundations/11-constructors.md) — the `.make` / `.of` pattern this package will follow throughout; every `effect-cache` module exposes a `.make` factory consistent with this naming convention
- [`../part-2-tour/22-platform.md`](../part-2-tour/22-platform.md) — how `@effect/platform` uses an abstract `Context.Tag` to decouple interface from implementation; `Cache` follows the same pattern
- [`../part-2-tour/26-sql-drivers.md`](../part-2-tour/26-sql-drivers.md) — how `Cache.make` and `ScopedCache.make` appear in real driver code (prepared-statement memoization); motivation for the cache domain as worked example
- [`../../research/02-patterns-catalog.md#make--of-constructors`](../../research/02-patterns-catalog.md#make--of-constructors) — formal entry for the `.make` / `.of` constructor pattern; the primary pattern foreshadowed in this chapter
- [`../../research/packages/sql.md`](../../research/packages/sql.md) — research note for `@effect/sql`; covers the abstract-tag + pluggable-layer design that `effect-cache` mirrors at smaller scale

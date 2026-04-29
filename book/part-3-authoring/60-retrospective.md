# Chapter 60 — Retrospective — re-reading `effect-cache` against the patterns catalog

> **Worked-example commit:** `worked-example/` chapter 60 — `docs: retrospective notes`
> **Patterns demonstrated:** [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors), [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror), [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all), [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct), [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait), [`PubSub` — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast), [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape)
> **Reads from:** every Part III chapter (45-59)
> **Reads into:** the reader's own future Effect package authoring
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Sixteen chapters ago we opened `DESIGN.md` with a placeholder section: "Retrospective notes — updated in Chapter 60 after all implementation chapters are complete." This is that update.

The goal is not to build anything. Part III has been entirely about construction: each chapter from 46 to 59 added exactly one commit to `worked-example/` and one chapter of prose explaining what was added and why. This chapter turns the telescope around. We re-read the finished package — the roughly 400 lines of production source plus 200 lines of tests — and ask three questions that are easy to skip when you are building under deadline but important to ask before shipping:

1. Which patterns from the catalog earned their place? Which ones delivered the design leverage we expected when we reached for them?
2. What would we do differently if we started over today? Which early decisions created friction later?
3. What is explicitly deferred, and what would a v0.2 release look like?

This kind of retrospective is not optional for a book like this. The Patterns Catalog (Part I) taught you the vocabulary. The Tour (Part II) showed you the patterns in Effect's own source. Part III gave you a complete authoring walkthrough. But none of that answers the question you will face when you sit down to write your own package: "Did these patterns actually work on a real problem, or did the book make them look easier than they are?" A retrospective is the most honest answer we can give.

The worked-example commit for this chapter is a single update to `DESIGN.md`: the "Retrospective" section replaces the placeholder. No source files change.

---

## What we already have

After Chapter 59, `worked-example/` is complete and publish-ready. Here is the full tree with brief annotations:

```
worked-example/
  src/
    Cache.ts            — Cache tag, CacheService interface, layerMemory, layerMemoryWithEviction,
                          dual combinators: get, set, delete, invalidate, events
    CacheConfig.ts      — Schema.Class with Config integration, CacheConfig.Tag, CacheConfig.layer
    CacheError.ts       — Three Data.TaggedError variants: Missing, Backend, Encoding
    CacheKey.ts         — Brand.nominal<CacheKey>() — zero-cost nominal type
    CacheEvent.ts       — Data.taggedEnum discriminated union: Hit, Miss, Set, Evict
    index.ts            — Public barrel: re-exports all five modules, nothing from internal/
    internal/
      storage.ts        — Abstract Storage interface (NOT re-exported)
      MemoryStorage.ts  — Ref<HashMap> implementation of Storage, makeService, make
      eviction.ts       — forkScoped eviction fiber on Schedule.spaced
  test/
    Cache.test.ts       — it.effect + it.scoped tests; TestClock for eviction
  package.json          — version 0.1.0, dual ESM/CJS exports map, peerDependencies
  DESIGN.md             — Living design record (this chapter appends the Retrospective)
  docgen.json           — @effect/docgen config
  README.md             — Package overview and quick-start
  CHANGELOG.md          — Changesets-generated release notes
  tsconfig.json, tsconfig.src.json, tsconfig.build.json
  vitest.config.ts
  .changeset/config.json
```

Every pattern from the Patterns Catalog that was promised in Chapter 45's overview is present and tested. The package is small enough to read in an afternoon and large enough to illustrate all the relevant decisions.

---

## What we're adding

This chapter modifies exactly one file:

| File | Status | Change |
|---|---|---|
| `worked-example/DESIGN.md` | modified | Replaces the "Retrospective notes placeholder" with a full Retrospective section |

The Retrospective section has three subsections:

1. **Patterns that pulled their weight** — seven patterns with a paragraph each on where they appear in `effect-cache` and why they were the right call.
2. **What we'd revisit** — six bulleted design decisions we would reconsider or extend in a v0.2 release.
3. **What's next for v0.2** — a brief roadmap note.

No source file changes. No test changes. The package's public API and runtime behavior are identical to Chapter 59.

---

## The code

The content added to `worked-example/DESIGN.md` (appended in place of the placeholder):

```md
## Retrospective (Chapter 60)

_Written after all 15 implementation chapters are complete. Maps the final implementation against
the Patterns Catalog and records what we would do differently in a v0.2 release._

### Patterns that pulled their weight

#### 1. `Layer.succeed` / `effect` / `scoped` — Layer constructors (Chapters 51–52)

`layerMemory` uses `Layer.effect`; `layerMemoryWithEviction` uses `Layer.scoped`. The distinction
was not arbitrary: `Layer.scoped` is the correct primitive whenever a resource — in this case a
background eviction fiber — must be released when the layer is torn down. Using `Layer.scoped`
with `Effect.forkScoped` meant the eviction fiber's lifetime was wired to the layer's Scope
automatically, with no manual cleanup code anywhere in the package. The alternative — forking with
`Effect.fork` and stashing the fiber for later interruption — would have required callers to
explicitly interrupt the fiber and would have leaked it if they forgot.

See: `worked-example/src/Cache.ts:101` (layerMemory) and `worked-example/src/Cache.ts:133`
(layerMemoryWithEviction); `worked-example/src/internal/eviction.ts:60-69` (runEviction).

#### 2. `Data.TaggedError` — typed errors (Chapter 48)

All three error variants — `Missing`, `Backend`, `Encoding` — extend `Data.TaggedError`. This
gave callers `Effect.catchTag("Missing", ...)` with zero instanceof boilerplate, and TypeScript
exhaustively narrowed the union in `Effect.catchTags`. The `Encoding` variant wraps a
`ParseResult.ParseIssue` directly.

See: `worked-example/src/CacheError.ts:24-53`.

#### 3. `Brand.nominal` — zero-cost nominal typing for keys (Chapter 50)

`CacheKey` is `string & Brand.Brand<"CacheKey">` constructed by `Brand.nominal<CacheKey>()`. At
runtime the key is a plain string. At the type level it is distinct from any other string.

See: `worked-example/src/CacheKey.ts:11-34`.

#### 4. `Schema.Class` — config with built-in validation (Chapter 49)

`CacheConfig` extends `Schema.Class`. Loading from env via `Config.integer(...)` then running
`Schema.decode(CacheConfig)` gave a single structured `ParseError` on bad input.

See: `worked-example/src/CacheConfig.ts:35-48`.

#### 5. Dual data-first / data-last (dual) — consistent public API (Chapter 53)

`Function.dual(arity, body)` produced both `Cache.get(key)` and `Cache.get(service, key)` from
a single implementation body.

See: `worked-example/src/Cache.ts:181-254`.

#### 6. `PubSub` + `Stream.fromPubSub` — decoupled event telemetry (Chapter 55)

Every subscriber gets its own independent subscription. The PubSub manages subscription lifecycle
via Scope. Backpressure and typed events at no extra complexity.

See: `worked-example/src/internal/MemoryStorage.ts:89-128`.

#### 7. The `internal/` folder and `index.ts` re-export shape (Chapter 54)

`internal/storage.ts`, `internal/MemoryStorage.ts`, `internal/eviction.ts` are never re-exported
from `src/index.ts`. The Storage interface can be refactored between minor versions without a
breaking change.

See: `worked-example/src/internal/storage.ts:38-44`; `worked-example/src/index.ts`.

### What we'd revisit in v0.2

- **LRU eviction** — current strategy is TTL-only. True LRU needs access timestamps on every get.
- **Schema-typed values** — get returns Option<unknown>. A generic Cache<A> would encode/decode
  at boundaries.
- **Metrics via Metric.counter / gauge** — hit/miss ratios and live entry counts not exposed.
- **Structured logging via Effect.log** — would route through Effect's logger rather than any
  console calls.
- **Redis / SQLite backend** — Storage interface is in place; no concrete backend ships in v0.1.
- **Distributed coherence** — PubSub is process-local; cross-instance invalidation requires a
  Redis pub/sub channel.

### What's next for v0.2

A realistic v0.2 would focus on: Metric.counter on hit/miss, a Cache<A> generic with Schema
decode/encode at the boundary, and a Redis backend implementing Storage. The existing internal/
boundaries are positioned to absorb all three without breaking the public API.
```

The section replaces only the placeholder at the bottom of the file. Everything above the "Retrospective notes placeholder" heading — Goals, Intended public API, Error variants, Config, Branded keys, Cache events, Layer composition plan, Storage plug points, Patterns used, Explicit non-goals, Open questions — is unchanged.

---

## Why this design choice

_Patterns we'd reach for again_

This section is the chapter's most important content. If you close the book having read only one section from Chapter 60, it should be this one.

### Layer constructors: the right tool for the right resource lifecycle

`Layer.effect` and `Layer.scoped` are not interchangeable. Chapter 51 showed this distinction at the conceptual level; Chapters 51–52 showed it in practice. `layerMemory` (`Layer.effect`) allocates a `Ref<HashMap>` and a `PubSub` — pure in-memory values with no external resources to release, so `Layer.effect` is correct. `layerMemoryWithEviction` (`Layer.scoped`) forks a background fiber that must be interrupted when the layer is released, so `Layer.scoped` is correct.

The key insight: reach for `Layer.scoped` any time you need to call `Effect.forkScoped`. The source is at `repos/effect/packages/effect/src/Layer.ts:727-735`. The eviction fiber is at `worked-example/src/internal/eviction.ts:60-69`.

### Data.TaggedError: typed errors that compose

The `Missing`, `Backend`, and `Encoding` variants each carry a distinct payload (`key`, `cause`, `parseIssue` respectively). That means `Effect.catchTags` can handle all three in one call, with each handler fully typed to the variant's fields. Source: `repos/effect/packages/effect/src/Data.ts:580-585`. Implementation: `worked-example/src/CacheError.ts:24-53`. Introduced in Chapter 48.

The alternative — a single `CacheError` class with a `kind` enum — would have forced callers to reach into the error object for fields that only exist for some variants, with no TypeScript help. `Data.TaggedError` made the right choice the ergonomic one.

### Brand.nominal: one line buys type safety for free

`Brand.nominal<CacheKey>()` at `worked-example/src/CacheKey.ts:34` costs one line and zero runtime overhead. It prevented at least three category of accidental misuse during the dual-API refactor in Chapter 53: raw string literals passed as `CacheKey` arguments, `CacheKey` values accidentally passed as `string` in places expecting the raw key string, and test helpers that constructed keys inconsistently. Source: `repos/effect/packages/effect/src/Brand.ts:269-272`. Introduced in Chapter 50.

### Schema.Class: construction, validation, and Config integration in one

`CacheConfig` as a `Schema.Class` meant the same type served three roles: the plain-object test double (`new CacheConfig({ ... })`), the Config-loaded production value, and the validated boundary where bad env-var inputs fail fast with a structured `ParseError`. Source: `repos/effect/packages/effect/src/Schema.ts:8713-8717`. Implementation: `worked-example/src/CacheConfig.ts:35-48`. Introduced in Chapter 49.

### Function.dual: one implementation, two call styles

The `dual(arity, body)` pattern at `worked-example/src/Cache.ts:181-254` meant that `Cache.get(key)` and `Cache.get(service, key)` share the same implementation body. There is one place to fix bugs, one place to update types, and callers get whichever form fits their context. Source: `repos/effect/packages/effect/src/Function.ts:95-105`. Introduced in Chapter 53. If you are building an Effect-compatible library, this pattern is essentially mandatory — omitting it creates a split between data-first and data-last users that you will never close without a breaking change.

### PubSub + Stream.fromPubSub: decoupled telemetry without a coupling cost

The event system at `worked-example/src/internal/MemoryStorage.ts:89-128` and `worked-example/src/internal/eviction.ts:25-38` shares a single `PubSub.unbounded<CacheEvent>()`. Every subscriber — whether it is a test assertion, a metrics collector, or a log forwarder — gets its own subscription. The cache's primary read/write path is unaffected whether there are zero subscribers or ten. Source: `repos/effect/packages/effect/src/PubSub.ts:85-86`. Introduced in Chapter 55.

### internal/ folder: refactoring freedom without a breaking change

`internal/storage.ts:38-44` defines the `Storage` interface. Because it is not re-exported from `src/index.ts`, it can be extended (adding a `keys` method, changing `Entry` shape) between minor releases without a semver violation. Source: `repos/effect/packages/effect/src/index.ts:687-687`. Introduced in Chapter 54.

---

## What's still missing

_Design decisions we'd revisit in v0.2_

- **LRU eviction** — the current strategy is TTL-only. The eviction fiber in `worked-example/src/internal/eviction.ts` sweeps by `expiresAt`; it has no knowledge of when a key was last accessed. Adding `lastAccessedAt: number` to `Entry` in `internal/storage.ts` and sorting by it in the sweep function would give true LRU without changing the public API.

- **Schema-typed values** — `Cache.get` returns `Option<unknown>` (see `worked-example/src/Cache.ts:182`). A generic `Cache<A>` parameterized by a `Schema.Schema<A>` would call `Schema.encode` at `set` and `Schema.decode` at `get`, surfacing `CacheError.Encoding` automatically. The error variant already exists; the type parameter is the missing piece.

- **Metrics** — hit/miss ratios and live entry counts are not exposed. `Metric.counter("cache.hits")` and `Metric.counter("cache.misses")` inside `makeService` in `worked-example/src/internal/MemoryStorage.ts` would be a three-line change. Chapter 33 (`@effect/opentelemetry`) demonstrates the Metric API.

- **Structured logging via `Effect.log`** — any future debug output should route through Effect's logger. `Effect.logDebug(...)` inside the eviction sweep respects `Logger.withMinimumLogLevel` and the standard log pipeline, rather than leaking to `console` or being silently dropped.

- **Redis backend** — the `Storage` interface at `worked-example/src/internal/storage.ts:38-44` exists precisely to make a Redis implementation possible without touching `Cache.ts`. A `@example/effect-cache-redis` package would implement `Storage` over `ioredis`. See the SQL research note for the approach a SQL backend would take.

- **Distributed coherence** — `PubSub` is process-local. Cross-instance invalidation (multiple Node.js processes sharing a Redis-backed cache) requires a Redis pub/sub channel for broadcasting invalidation messages. This is a non-trivial protocol; acknowledging it as a known gap is more honest than implying the current design scales horizontally.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add DESIGN.md
git commit -m "docs: retrospective notes"
```

This is the final commit in `worked-example/` for Part III of the book.

---

## See also

- [Chapter 45 — Overview — what we are building and why](./45-overview.md)
- [Chapter 46 — Build setup — package.json, tsconfig, vitest](./46-build-setup.md)
- [Chapter 47 — Public API — Cache tag, CacheService interface](./47-public-api.md)
- [Chapter 48 — Error channel — Data.TaggedError variants](./48-error-channel.md)
- [Chapter 49 — Schema-driven config — CacheConfig as Schema.Class](./49-schema-config.md)
- [Chapter 50 — Branded keys — Brand.nominal for CacheKey](./50-branded-keys.md)
- [Chapter 51 — The first Layer — Layer.effect for in-memory storage](./51-layer-memory.md)
- [Chapter 52 — The second Layer — Layer.scoped for the eviction fiber](./52-layer-scoped-eviction.md)
- [Chapter 53 — Dual API — Function.dual for data-first / data-last combinators](./53-dual-api.md)
- [Chapter 54 — Internal modules — the internal/ folder and index.ts re-export shape](./54-internal-modules.md)
- [Chapter 55 — Cache events stream — PubSub and Stream.fromPubSub](./55-cache-events-stream.md)
- [Chapter 56 — Testing — it.effect, it.scoped, TestClock](./56-testing.md)
- [Chapter 57 — Documenting with JSDoc — @since, @category, @example](./57-jsdoc.md)
- [Chapter 58 — Versioning and exports map — package.json exports field](./58-versioning-and-exports.md)
- [Chapter 59 — Publishing checklist — peer deps, changesets, and release](./59-publishing.md)
- [Effect TS Patterns Catalog](../../research/02-patterns-catalog.md)
- [SQL backend research note](../../research/packages/sql.md) — the approach a `@effect/sql`-backed `Storage` implementation would take
- [Book design brainstorming spec](../../docs/superpowers/specs/2026-04-28-effect-ts-book-design.md) — the original brief that shaped Part III
- [Chapter 10 — Layer.scoped and Scope](../part-1-foundations/10-layer-scoped-and-scope.md) — the foundation for `Layer.scoped` and `Effect.forkScoped` used in `layerMemoryWithEviction`
- [Chapter 17 — Fibers and concurrency](../part-1-foundations/17-fibers-and-concurrency.md) — the foundation for the eviction fiber
- [Chapter 22 — Platform services — the abstract runtime layer](../part-2-tour/22-platform.md) — the `Context.Tag` / abstract interface pattern that `Cache` follows

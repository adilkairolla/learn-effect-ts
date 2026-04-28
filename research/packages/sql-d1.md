# @effect/sql-d1

> Source: `repos/effect/packages/sql-d1/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/experimental`, `@effect/sql` (all peer dependencies; runtime dependency: `@cloudflare/workers-types`)

## What it does

`@effect/sql-d1` is the `@effect/sql` driver for [Cloudflare D1](https://developers.cloudflare.com/d1/), the managed SQLite-compatible edge database inside Cloudflare Workers. It bridges the Worker binding (`D1Database`) — injected at runtime by the platform — to the abstract `SqlClient` interface. Without it, callers invoke `db.prepare(sql).bind(...params).all()` through raw Promise chains, losing Effect's typed error channel, prepared-statement caching, and SqlResolver batching.

## Public API surface

All exports are re-exported from `repos/effect/packages/sql-d1/src/index.ts:4` as the `D1Client` namespace.

- **`D1Client` interface** (`src/D1Client.ts:38-44`) — extends `SqlClient.SqlClient`; `updateValues` is branded `never` (D1 does not support update-returning queries).
- **`D1Client` tag** (`src/D1Client.ts:50`) — `Context.GenericTag` keyed `"@effect/sql-d1/D1Client"`.
- **`D1ClientConfig`** (`src/D1Client.ts:56-64`) — required: `db: D1Database`. Optional: `prepareCacheSize` (200), `prepareCacheTTL` (10 min), `spanAttributes`, `transformResultNames`, `transformQueryNames`.
- **`make`** (`src/D1Client.ts:70-184`) — scoped `Effect` factory; builds the prepared-statement cache and `Connection` implementation.
- **`layer`** (`src/D1Client.ts:208-216`) — accepts `D1ClientConfig`; returns a `Layer` providing both `D1Client` and `SqlClient.SqlClient`.
- **`layerConfig`** (`src/D1Client.ts:190-202`) — same but accepts `Config.Config.Wrap<D1ClientConfig>`.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — both layer constructors use `Layer.scopedContext` so TTL cache fibers are finalised on teardown (`src/D1Client.ts:208-216`).
- [Cache.make / ScopedCache.make — effect-based memoization](../02-patterns-catalog.md#cachemake--scopedcachemake--effect-based-memoization) — `Cache.make` keyed by SQL string stores `D1PreparedStatement` objects, amortising preparation cost across a warm isolate (`src/D1Client.ts:82-89`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` sequences cache construction, connection assembly, and `Client.make` in a single `Effect.gen` (`src/D1Client.ts:73-183`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — both layers publish the concrete and abstract tags together (`src/D1Client.ts:211-215`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — failures surface as `SqlError` (`src/D1Client.ts:88`, `src/D1Client.ts:103-105`).
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` threads config through `Config.unwrap` (`src/D1Client.ts:190-202`).

## What's unique about this package's design

The defining constraint is **no persistent connections**. The Cloudflare Workers isolate has no filesystem, no raw sockets, and no shared state between requests. `D1ClientConfig.db` is the raw Worker binding injected per invocation — there is no DSN to parse (`src/D1Client.ts:57`). The package compensates with an in-memory prepared-statement cache (200 entries, 10-minute TTL) that amortises preparation cost across requests hitting the same warm isolate (`src/D1Client.ts:82-89`).

Transactions and streaming are disabled via `Effect.dieMessage` (`src/D1Client.ts:158-160`, `src/D1Client.ts:166`), making misuse a defect rather than a recoverable error. The test suite confirms this: `withTransaction` defects at runtime (`test/Client.test.ts:31-42`). This reflects D1's HTTP-based API, where each statement is a separate round-trip with no multi-statement transaction surface.

## Conventions observed

- **Single-file driver**: the full implementation is `src/D1Client.ts`, re-exported as a namespace from `src/index.ts:4`.
- **`Reactivity` hidden from callers**: both layer constructors pipe `Layer.provide(Reactivity.layer)` internally (`src/D1Client.ts:202`, `src/D1Client.ts:216`), keeping `@effect/experimental/Reactivity` invisible to application code.
- **`updateValues: never`** — type-level signal rather than a runtime throw (`src/D1Client.ts:43`).
- **Miniflare in tests**: `test/utils.ts:16-37` acquires a `Miniflare` instance via `Effect.acquireRelease` so tests run against real D1 semantics without a Cloudflare account.

## "If you were authoring something similar, copy this"

- **Accept the platform binding as a config field, not a connection string** (`src/D1Client.ts:57`). Edge runtimes inject bindings as JS objects; there is no DSN to parse.
- **Use `Cache.make` for prepared statements** (`src/D1Client.ts:82-89`). TTL eviction and capacity limits prevent unbounded memory growth in warm isolates with no manual bookkeeping.
- **Defect on unsupported operations** (`src/D1Client.ts:158-160`, `src/D1Client.ts:166`). `Effect.dieMessage` keeps the error channel clean and makes misuse visible via `catchAllDefect` in tests.
- **Register both the concrete and abstract tag in one `Layer`** (`src/D1Client.ts:211-215`). One layer satisfies `SqlClient.SqlClient` (driver-agnostic) and `D1Client` (D1-specific) simultaneously.

## Open questions

1. **`db.batch` omission**: D1 exposes `db.batch([...statements])` for a single HTTP round-trip. The driver issues statements individually via `.all()` (`src/D1Client.ts:97-100`). Whether `SqlResolver` batches could map to `db.batch` for lower edge latency is unexplored.
2. **`updateValues: never` vs RETURNING**: D1's SQLite 3.35+ supports `RETURNING`. The comment says only "Not supported in d1" (`src/D1Client.ts:43`) without clarifying whether this is a platform gap or a scope decision.
3. **`layerConfig` in Workers**: Cloudflare Workers receive the `D1Database` binding on the fetch-handler `env` argument, not via `process.env`. How `Config.unwrap` would be wired at request time is not shown in the source or tests.
4. **Cache ROI on short-lived isolates**: the `Cache.make` overhead may outweigh preparation savings on isolates that handle only a few requests before eviction (`src/D1Client.ts:82-89`).

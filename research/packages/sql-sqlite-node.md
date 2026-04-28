# @effect/sql-sqlite-node

> Source: `repos/effect/packages/sql-sqlite-node/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `@effect/platform`, `@effect/experimental` (all peer dependencies; one runtime dependency: `better-sqlite3`)

## What it does

`@effect/sql-sqlite-node` is the canonical SQLite driver for the Effect SQL ecosystem, backed by `better-sqlite3`. It provides a concrete `SqliteClient` service implementing `@effect/sql`'s abstract `SqlClient`, letting application code target the generic interface while this package handles SQLite-specific concerns: synchronous statement execution, WAL mode, PRAGMA configuration, prepared-statement caching, in-memory export, and file backup. Without it, teams would manually bridge `better-sqlite3`'s synchronous API into Effect's fiber runtime and re-implement transaction semantics from scratch.

## Public API surface

Modules are re-exported from `repos/effect/packages/sql-sqlite-node/src/index.ts:1-9`.

- **`SqliteClient`** (`src/SqliteClient.ts:38-47`) — extends `@effect/sql`'s `SqlClient` with `export` (serialize DB to `Uint8Array`), `backup` (online backup to a file path), and `loadExtension`. `updateValues` is typed `never` — SQLite has no `UPDATE ... FROM VALUES`.
- **`SqliteClient.make`** / **`layer`** / **`layerConfig`** (`src/SqliteClient.ts:90-284`) — core constructor and two `Layer` wrappers. `layerConfig` accepts `Config.Config.Wrap<SqliteClientConfig>` for env-var-driven configuration.
- **`SqliteMigrator`** (`src/SqliteMigrator.ts:30-90`) — shells out to the `sqlite3` CLI after each migration run to dump schema and migration table to a file. Re-exports `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem`.

## Patterns used

- [Layer.scoped (resource layers)](../02-patterns-catalog.md#layerscoped-resource-layers) — `layer` and `layerConfig` use `Layer.scopedContext` to acquire the DB connection at layer build time and release it on layer close (`src/SqliteClient.ts:279-284`).
- [Cache.make / ScopedCache.make — effect-based memoization](../02-patterns-catalog.md#cachemake--scopedcachemake--effect-based-memoization) — prepared statements are cached by SQL string; capacity (default 200) and TTL (default 10 min) are user-configurable (`src/SqliteClient.ts:112-120`).
- [Semaphore — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — `Effect.makeSemaphore(1)` serializes all connection access; `transactionAcquirer` holds the permit for the full transaction scope via `uninterruptibleMask` (`src/SqliteClient.ts:216-231`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `runValues` toggles raw-row mode on/off via `acquireUseRelease`, guaranteeing `statement.raw(false)` runs even on failure (`src/SqliteClient.ts:156-173`).
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` takes `Config.Config.Wrap<SqliteClientConfig>` so every config field can come from environment variables (`src/SqliteClient.ts:258-270`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` and `makeConnection` sequence scope registration, cache creation, semaphore creation, and `Client.make` composition in generator style (`src/SqliteClient.ts:93-252`).

## What's unique about this package's design

The central design challenge is bridging `better-sqlite3`'s **fully synchronous** API into Effect's async fiber runtime. The solution is a single-permit semaphore (`src/SqliteClient.ts:216-219`) that acts as a mutex: one fiber holds the connection at a time, and all `better-sqlite3` calls in `runStatement` (`src/SqliteClient.ts:127-140`) are wrapped in `Effect.withFiberRuntime` — synchronous internally, composable Effects externally. Streaming (`executeStream`) is explicitly unsupported and throws `Effect.dieMessage` (`src/SqliteClient.ts:191-193`) rather than silently returning an empty stream.

WAL mode is opt-out rather than opt-in: `db.pragma("journal_mode = WAL")` fires unless `disableWAL: true` is passed (`src/SqliteClient.ts:108-110`). The `SafeIntegers` context flag from `@effect/sql` integrates at execution time — `runStatement` reads `Client.SafeIntegers` from the fiber context and calls `statement.safeIntegers(true)` on the `better-sqlite3` object (`src/SqliteClient.ts:128-130`) with no extra code path.

## Conventions observed

- **Dual tag registration**: `layer` and `layerConfig` both register under `SqliteClient` and `Client.SqlClient` (`src/SqliteClient.ts:263-266`) — no extra `Layer.map` needed.
- **`Reactivity.layer` auto-provided**: piped at the end of both constructors (`src/SqliteClient.ts:270`, `src/SqliteClient.ts:284`) so callers never add it manually.
- **`TypeId` unique symbol** (`src/SqliteClient.ts:26-32`): brands the concrete type apart from abstract `SqlClient`.
- **Config as plain interface**: `SqliteClientConfig` (`src/SqliteClient.ts:68-78`) is a plain `interface` — input-only, no structural equality needed.

## "If you were authoring something similar, copy this"

- **Serialize synchronous driver calls with a single-permit semaphore** (`src/SqliteClient.ts:216-231`). `makeSemaphore(1)` + `uninterruptibleMask` for transactions, `withPermits(1)` for plain queries — the complete pattern for any non-thread-safe synchronous backend.
- **Cache prepared statements with `Cache.make`** (`src/SqliteClient.ts:112-120`). Expose `capacity` and `timeToLive` in the config with sensible defaults (200, 10 min); call `prepareCache.invalidateAll` after any schema-changing operation such as `loadExtension` (`src/SqliteClient.ts:205-211`).
- **Register both concrete and abstract tags in one `Layer`** (`src/SqliteClient.ts:263-266`). `Context.make(SqliteClient, client).pipe(Context.add(Client.SqlClient, client))` inside `Layer.scopedContext` lets framework code depend on `SqliteClient` and generic application code depend on `SqlClient` from the same layer.

## Open questions

- **`executeStream` throws `dieMessage`** (`src/SqliteClient.ts:191-193`): `better-sqlite3` exposes `stmt.iterate()` for lazy row iteration — could this back a `Stream` to avoid loading all rows into memory, or is the semaphore model incompatible with interleaved iteration?
- **Single connection vs. read pool**: all access is serialized through one semaphore permit. For read-heavy workloads, opening additional `readonly: true` connections and routing reads through a `Pool` could improve throughput — is there a monorepo pattern for multi-reader SQLite drivers?

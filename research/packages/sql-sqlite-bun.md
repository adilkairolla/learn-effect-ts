# `@effect/sql-sqlite-bun`

> Source: `repos/effect/packages/sql-sqlite-bun/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `@effect/platform`, `@effect/experimental`

## What it does

`@effect/sql-sqlite-bun` provides a Bun-native SQLite client for the `@effect/sql` abstraction layer. It targets developers running on Bun who want full Effect integration — typed errors, Scope-managed connection lifetimes, transactions, and migrations — without any native build step. Without this package, you would need `better-sqlite3` on Node.js or a hand-rolled `bun:sqlite` wrapper. The package exposes `SqliteClient` (driver) and `SqliteMigrator` (schema migration runner) as its two top-level modules.

## Public API surface

- **`SqliteClient`** (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts`) — the connection layer. Exports `make` (scoped constructor), `layer` and `layerConfig` (Layer entry points), the `SqliteClient` service tag, and `SqliteClientConfig`. Extends `@effect/sql`'s generic `SqlClient` with two Bun-specific extras: `export` (serialize the DB to `Uint8Array` via `db.serialize()`) and `loadExtension`.
- **`SqliteMigrator`** (`repos/effect/packages/sql-sqlite-bun/src/SqliteMigrator.ts`) — migration runner. Re-exports everything from `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem`, then adds a Bun-specific `run` and `layer` that shell out to the `sqlite3` CLI for schema dumps.
- **`index.ts`** (`repos/effect/packages/sql-sqlite-bun/src/index.ts:1-9`) — namespace-style re-export (`SqliteClient`, `SqliteMigrator`).

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `make(options)` is the scoped constructor; `Context.make` + `Context.add` populate both `SqliteClient` and generic `SqlClient` tags (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:181-196`).
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — `make` sequences semaphore creation, connection initialization, and `Client.make` assembly in a single generator (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:81-198`).
- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` and `layerConfig` both use `Layer.scopedContext` with `Layer.provide(Reactivity.layer)` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:204-230`).
- [`Config.string` / `integer` / `boolean` / `nested` / `all`](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` accepts `Config.Config.Wrap<SqliteClientConfig>` for env-driven configuration (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:204-216`).
- [`Semaphore` — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — `Semaphore(1)` serializes the synchronous connection; `transactionAcquirer` holds the permit for the transaction's full duration via `uninterruptibleMask` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:163-177`).
- [`Effect.acquireRelease` / `acquireUseRelease`](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `Effect.addFinalizer` registers `db.close()` on `Scope` close (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:95`).

## What's unique about this package's design

The key difference from `@effect/sql-sqlite-node` is what is absent. The Node driver imports `better-sqlite3` (a native add-on requiring compilation), builds a time-bounded `Cache` of prepared statements, and exposes a `backup` API. The Bun driver uses `bun:sqlite` — a runtime built-in — so there is no install step and no prepare cache; each `run` call invokes `db.query(sql)` fresh (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:101-115`). The `SafeIntegers` context tag is read inside `Effect.withFiberRuntime` at call time, not at prepare time, because there are no long-lived statement objects to toggle (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:105-110`). An `as any` cast on the `Database` constructor options (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:90-94`) acknowledges that Bun's type definitions lag its runtime.

## Conventions observed

- Standard two-file module split (`SqliteClient.ts`, `SqliteMigrator.ts`) with a thin namespace index, consistent with all `@effect/sql-*` drivers.
- Both `layer(config)` and `layerConfig(Config.Config.Wrap<...>)` are exported, matching the pairing used by every other driver (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:204-230`).
- `TypeId` as a `unique symbol` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:24-30`) brands the concrete client type.
- `executeStream` dies with a message (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:148-150`) and `updateValues` is typed `never` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:43`) — both are standard SQLite driver conventions across the monorepo.
- WAL mode on by default, suppressed with `disableWAL: true` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:96-99`).

## "If you were authoring something similar, copy this"

- **Dual tags in `Layer.scopedContext`**: register both the concrete `SqliteClient` tag and the generic `SqlClient` tag so consumers can depend on either (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:181-196`).
- **Semaphore-per-connection for synchronous drivers**: `Semaphore(1)` serializes the blocking connection without a pool; `transactionAcquirer` holds the permit across transaction boundaries via `uninterruptibleMask` (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:163-177`).
- **`Effect.withFiberRuntime` for per-call flags**: reading `SafeIntegers` from fiber context at execution time lets callers opt into bigint without rebuilding statements (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:105-110`).
- **Bake in dependency layers**: `Layer.provide(Reactivity.layer)` is applied inside `layer`/`layerConfig` so callers never have to wire `Reactivity` manually (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:216,230`).

## Open questions

- `db.query(sql)` is called fresh on every `run` with no explicit caching. Does `bun:sqlite` cache statements internally, or is there a throughput penalty vs. `sql-sqlite-node`'s `Cache`-based approach for repeated identical queries?
- The `@ts-ignore` comments on lines 109 and 125 and the `as any` cast on line 94 (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:94,109,125`) work around missing Bun type definitions (PR `oven-sh/bun#26627`). Once upstream ships those types, these suppressions should be removed.
- `SqliteMigrator` shells out to the `sqlite3` CLI for schema dumps (`repos/effect/packages/sql-sqlite-bun/src/SqliteMigrator.ts:37-51`). Minimal Docker images without `sqlite3` in `PATH` will silently pass startup but fail at first migration.
- The Vitest test file is a no-op stub (`repos/effect/packages/sql-sqlite-bun/test/Client.test.ts:1-6`); real coverage lives in `examples/Client.test.ts` under Bun's test runner. Standard CI running Vitest does not exercise any database code.

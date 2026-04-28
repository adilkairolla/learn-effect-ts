# @effect/sql-pg

> Source: `repos/effect/packages/sql-pg/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `@effect/platform`, `@effect/experimental` (all peer dependencies; runtime dependencies: `pg`, `pg-connection-string`, `pg-cursor`, `pg-pool`, `pg-types`)

## What it does

`@effect/sql-pg` is the PostgreSQL driver for the Effect ecosystem — a concrete `SqlClient.SqlClient` implementation wrapping `pg` / `pg-pool` / `pg-cursor` inside Effect's resource and concurrency model. Application code depends only on the abstract `SqlClient` tag from [`@effect/sql`](./sql.md); this package is wired in at the `Layer` boundary. It is the canonical reference for "writing a SQL driver": it shows how pool lifecycle, cursor streaming, transaction pinning, LISTEN/NOTIFY, and `pg_dump` all compose with structured concurrency and typed errors.

## Public API surface

All modules are re-exported from `repos/effect/packages/sql-pg/src/index.ts:1-9`.

- **`PgClient`** (`src/PgClient.ts:52-97`) — extends `SqlClient.SqlClient` with `config`, `json` (a `PgJson` custom segment for `jsonb` binding), and `listen(channel)` / `notify(channel, payload)`. Tag is a `Context.GenericTag` (`src/PgClient.ts:64`).
- **`PgClient.layer`** / **`layerConfig`** / **`layerFromPool`** (`src/PgClient.ts:575-597`) — `layer` takes a plain config object; `layerConfig` takes `Config.Config.Wrap<PgClientConfig>`; `layerFromPool` accepts an externally-owned pool. All register both `PgClient` and `Client.SqlClient` tags in the output context.
- **`PgClient.makeCompiler`** (`src/PgClient.ts:603-644`) — Postgres `Statement.Compiler`: `$N` placeholders, double-quoted identifiers, `PgJson` custom handler. Exported for use without a live connection.
- **`PgMigrator`** (`src/PgMigrator.ts:31-105`) — re-exports `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem`; adds a Postgres `run` / `layer` that run `pg_dump` via `@effect/platform/Command` after each migration.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `Layer.scopedContext` manages pool lifetime; both `PgClient` and `SqlClient.SqlClient` tags are registered in the output context (`src/PgClient.ts:557-597`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — pool health-checked with `SELECT 1` on acquire, drained with `pool.end()` on release (`src/PgClient.ts:430-449`); transaction connections finalized via `Scope.addFinalizer` (`src/PgClient.ts:300-309`).
- [RcRef and RcMap — reference-counted resources](../02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources) — LISTEN/NOTIFY dedicated `pg.Client` is an `RcRef` (`src/PgClient.ts:317-341`), shared across concurrent `listen` streams.
- [Stream.async* family (asyncPush, fromAsyncIterable)](../02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable) — `listen` uses `Stream.asyncPush` for Postgres notification events (`src/PgClient.ts:362-380`); `executeStream` pages a `pg-cursor` with `Stream.repeatEffectChunkOption` (`src/PgClient.ts:245-272`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — used in `makeClient`, `make`, and `fromPool` (`src/PgClient.ts:111`, `402`, `495`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `PgClient` is a `Context.GenericTag` (`src/PgClient.ts:64`) registered alongside `Client.SqlClient`.
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — all failures are `new SqlError({ cause, message })` (`src/PgClient.ts:182-184`, `384-387`).
- [Effect.fn (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `fromPool` uses `Effect.fnUntraced` (`src/PgClient.ts:495`) to avoid adding a span for an internal constructor.

## What's unique about this package's design

The layer registers **two tags simultaneously** — `PgClient` and `Client.SqlClient` — in one `Context` (`src/PgClient.ts:562-568`). Application code depends on the abstract tag; Postgres-specific utilities (`PgMigrator`) depend on `PgClient` for `config.host` / `config.password` to invoke `pg_dump`. This is the canonical pattern for extending an abstract service with driver-specific capabilities.

Listen/notify requires a dedicated `pg.Client` (the pool returns connections after each query). The driver wraps it in an `RcRef` (`src/PgClient.ts:317-341`); each `listen(channel)` call acquires the shared client, issues `LISTEN`, and adds a scope finalizer for `UNLISTEN` (`src/PgClient.ts:362-380`).

Query cancellation wires fiber interruption to the Postgres wire protocol: a `WeakMap<Pg.PoolClient, Effect>` caches `pg_cancel_backend(processID)` per client (`src/PgClient.ts:531-551`) so interrupted fibers abort backend queries immediately.

## Conventions observed

- **No `internal/` folder**: `make` and `makeClient` are module-private unexported functions — sufficient for a two-module package. `"./internal/*": null` appears in `package.json:35` defensively per monorepo standard.
- **`TypeId` as a string literal**: `PgClient.TypeId = "~@effect/sql-pg/PgClient"` (`src/PgClient.ts:40-46`), not a `unique symbol` — lighter branding adequate for a domain-tier driver.
- **`Reactivity.layer` provided internally**: all three layer constructors pipe `Layer.provide(Reactivity.layer)` (`src/PgClient.ts:569`, `583`, `597`), hiding the `@effect/experimental` requirement from callers.
- **`pg_dump` via `@effect/platform/Command`**: `PgMigrator` runs `pg_dump` through `Command.make` / `Command.string` with env vars sourced from `sql.config` (`src/PgMigrator.ts:38-65`), keeping schema-dump composable in the fiber tree.

## "If you were authoring something similar, copy this"

- **Register both concrete and abstract tags in one `Context`** (`src/PgClient.ts:562-568`). Application code depends on the abstract tag; driver utilities depend on the concrete one.
- **Wrap auxiliary connections in `RcRef`** (`src/PgClient.ts:317-341`). Reference-counted lifecycle beats one-per-consumer or a permanently open connection for any driver feature needing a dedicated wire.
- **Cache interruption-cancellation in a `WeakMap`** (`src/PgClient.ts:531-551`). Build the cancellation effect once per pool client; interrupted fibers abort the backend query without re-querying the process ID.
- **Provide a `fromPool` escape hatch** (`src/PgClient.ts:475-529`) alongside the default config-based constructor for callers that already manage their own pool.
- **Health-check with `Effect.timeoutFail` at layer startup** (`src/PgClient.ts:441-449`) to surface bad connection strings as a typed `SqlError` before the first real query.

## Open questions

1. **`SafeIntegers` not wired**: `@effect/sql`'s `SafeIntegers` `Context.Reference` is never read in `PgClient`; safe integer parsing must be wired via `types?: Pg.CustomTypesConfig` (`src/PgClient.ts:424`). Intentional or omission is undocumented.
2. **Silent pool error handler**: `pool.on("error", (_err) => {})` (`src/PgClient.ts:427-429`) prevents Node crash-on-unhandled-rejection but hides server-restart / network-drop events from fibers.
3. **Cursor batch size hardcoded to 128** (`src/PgClient.ts:258`) with no config option — may warrant a `PgClientConfig` knob for row-size extremes.
4. **`pg_dump` absence produces a generic error**: `MigrationError { reason: "failed" }` (`src/PgMigrator.ts:64`) with no hint the binary is missing from `PATH`.

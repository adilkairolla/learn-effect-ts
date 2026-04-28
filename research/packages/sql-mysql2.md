# @effect/sql-mysql2

> Source: `repos/effect/packages/sql-mysql2/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/sql`, `@effect/experimental` (all peer dependencies; one runtime dependency: `mysql2 ^3.11.0`)

## What it does

`@effect/sql-mysql2` wraps the `mysql2` connection pool in a `MysqlClient` service that satisfies `@effect/sql`'s abstract `SqlClient` interface, so application code written against `SqlClient.SqlClient` runs unchanged against MySQL. Without this package, MySQL users would bridge callback-based `mysql2` APIs into Effect's fiber runtime and reinvent pool lifecycle and statement compilation. It also provides `MysqlMigrator`, which shells out to `mysqldump` for schema snapshots.

## Public API surface

Two modules re-exported from `repos/effect/packages/sql-mysql2/src/index.ts:1-9`:

- **`MysqlClient`** (`src/MysqlClient.ts`) — `MysqlClient` tag (`src/MysqlClient.ts:52`), `MysqlClientConfig` interface (`src/MysqlClient.ts:58-79`), `make` factory returning `Effect<MysqlClient, SqlError, Scope | Reactivity>` (`src/MysqlClient.ts:85-269`), `layer` / `layerConfig` constructors (`src/MysqlClient.ts:275-301`), and `makeCompiler` for the MySQL `?`-placeholder / backtick-quoting dialect (`src/MysqlClient.ts:307-324`).
- **`MysqlMigrator`** (`src/MysqlMigrator.ts`) — re-exports `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem`, then adds a MySQL `run` + `layer` that shell out to `mysqldump` to persist the schema snapshot alongside migration records (`src/MysqlMigrator.ts:37-98`).

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` / `layerConfig` use `Layer.scopedContext` for pool lifecycle and `Layer.provide(Reactivity.layer)` to satisfy `@effect/experimental` (`src/MysqlClient.ts:287`, `src/MysqlClient.ts:301`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — pool lifetime (`src/MysqlClient.ts:198-226`) and per-transaction connection checkout (`src/MysqlClient.ts:230-241`) are each an acquire/release pair.
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` and `dumpSchema` both sequence async steps with `Effect.gen` (`src/MysqlClient.ts:88`, `src/MysqlMigrator.ts:40`).
- [Stream.async* family (asyncPush, fromAsyncIterable)](../02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable) — `queryStream` wraps the `mysql2` `Readable` in `asyncPauseResume`, propagating back-pressure via `.pause()` / `.resume()` (`src/MysqlClient.ts:328-357`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `MysqlClient` is a `Context.GenericTag`; `layer` registers both it and `Client.SqlClient` into the same context (`src/MysqlClient.ts:52`, `src/MysqlClient.ts:279-300`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — driver failures surface as `SqlError` (`src/MysqlClient.ts:113`, `src/MysqlClient.ts:202`, `src/MysqlClient.ts:233`).
- [Config — Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` calls `Config.unwrap` on a `Config.Wrap<MysqlClientConfig>` before building the layer (`src/MysqlClient.ts:275-287`).

## What's unique about this package's design

The `execute` / `executeUnprepared` split is MySQL-specific and absent from `sql-pg`: `execute` uses the binary prepared-statement protocol; `executeUnprepared` forces the text `query` path (`src/MysqlClient.ts:103-153`), required for DDL and multi-statement scripts.

`supportBigNumbers: true` is hardcoded on every pool (`src/MysqlClient.ts:174`, `src/MysqlClient.ts:190`). Without it `mysql2` silently truncates `BIGINT` beyond `Number.MAX_SAFE_INTEGER` — there is no equivalent opt-in in `sql-pg` because `pg` returns large integers as strings by default. Out-of-range values become JS strings, not `BigInt` — callers with `Schema.BigInt` fields must verify their decode path.

Streaming uses a microtask batch buffer (`src/MysqlClient.ts:335-349`): synchronous `data` events coalesce into one `emit.array` per tick, cutting per-row overhead inside Effect's stream machinery.

## Conventions observed

- **No `internal/` folder**: all implementation is directly in `MysqlClient.ts` and `MysqlMigrator.ts` — no `internal/` subdirectory (`src/index.ts:1-9`).
- **Backtick identifier quoting**: `Statement.defaultEscape("`")` (`src/MysqlClient.ts:326`) vs. `sql-pg`'s double-quote escaping.
- **`multipleStatements: true` unconditional**: required for `Migrator` batched DDL but widens injection surface for `executeUnprepared` (`src/MysqlClient.ts:173`, `src/MysqlClient.ts:189`).
- **`maxIdle: 0` default** (non-URI path): idle connections released immediately unless overridden via `poolConfig.maxIdle` (`src/MysqlClient.ts:192`).
- **OTel span attributes**: `db.system.name = "mysql"`, server address/port from config or defaulted to `localhost:3306` (`src/MysqlClient.ts:248-257`).

## "If you were authoring something similar, copy this"

- **Register both the concrete and abstract tags in one `Context`** (`src/MysqlClient.ts:279-286`): `Context.make(MysqlClient, client).pipe(Context.add(Client.SqlClient, client))` so callers can depend on either.
- **Startup health check with timeout** (`src/MysqlClient.ts:198-226`): `SELECT 1` wrapped in `Effect.timeoutFail` converts an unreachable DB into a typed `SqlError` at layer build time.
- **Hardcode flags that prevent silent data corruption** (`src/MysqlClient.ts:174`, `src/MysqlClient.ts:190`): opt-in `supportBigNumbers` would be silently forgotten; the driver enforces it.
- **Microtask row buffer for stream bridging** (`src/MysqlClient.ts:328-357`): accumulate synchronous `data` events, flush as `emit.array` on `queueMicrotask` — reusable for any high-frequency Node.js `Readable`.

## Open questions

1. **`BIGINT` decode shape**: out-of-range values return as `string`, in-range as `number` (`src/MysqlClient.ts:174`). Interaction with `Schema.BigInt` / `Model.Class` fields is untested.
2. **`UNSIGNED BIGINT` precision**: no unsigned-aware decode helper; values above `Number.MAX_SAFE_INTEGER` lose precision unless `mysql2` returns them as strings.
3. **`multipleStatements` injection surface**: unconditional (`src/MysqlClient.ts:173`); no warning that `executeUnprepared` with untrusted input is unsafe.
4. **Vitess layer unused**: `test/utils.ts:25-38` has `MysqlContainer.LiveVitess` but no test file uses `ClientLiveVitess`; `AUTO_INCREMENT` DDL compatibility is unverified.
5. **`connectionTTL` vs server `wait_timeout`**: mapped to `mysql2`'s `idleTimeout` (`src/MysqlClient.ts:177`); server-side connection close before `idleTimeout` fires may produce broken connections with no documented reconnect path.

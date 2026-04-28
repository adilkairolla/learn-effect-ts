# @effect/sql-mssql

> Source: `repos/effect/packages/sql-mssql/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/experimental`, `@effect/sql` (all peer dependencies; one runtime dependency: `tedious@^18.3.0`)

## What it does

`@effect/sql-mssql` is the Microsoft SQL Server driver for the Effect SQL ecosystem. It wraps the `tedious` TDS client in an Effect-native connection pool, satisfies the abstract `@effect/sql` `SqlClient` interface, and adds two MSSQL-specific capabilities absent from every other driver: typed stored-procedure calls (input and output parameters) and T-SQL-aware query compilation (`@N` named placeholders, bracket-escaped identifiers, `OUTPUT INSERTED.*` instead of `RETURNING`). Without it, applications targeting SQL Server would manage `tedious` callbacks manually with no Effect integration.

## Public API surface

All modules re-exported from `repos/effect/packages/sql-mssql/src/index.ts:1-31`.

- **`MssqlClient`** (`src/MssqlClient.ts:47-65`) — extends `SqlClient.SqlClient` with `.param(type, value, options)` (explicit `DataType` fragment) and `.call(procedure)` (stored-procedure execution). `Context.GenericTag` at line 71. Layer constructors: `MssqlClient.layer(config)` and `MssqlClient.layerConfig(wrapped)` (`src/MssqlClient.ts:451-459`).
- **`MssqlMigrator`** (`src/MssqlMigrator.ts:24-38`) — thin re-export of `@effect/sql/Migrator`. No MSSQL DDL customisation is needed; idempotency relies on T-SQL `CREATE OR ALTER`.
- **`Parameter`** (`src/Parameter.ts:24-46`) — data type pairing a `tedious` `DataType` with a name and `ParameterOptions`. Building block for `Procedure`.
- **`Procedure`** (`src/Procedure.ts:29-81`) — pipeable builder for stored-procedure descriptors. Chain `make` → `param<A>()` → `outputParam<A>()` → `withRows<A>()` → `compile` to produce a `ProcedureWithValues` accepted by `MssqlClient.call`.
- **`MssqlTypes`** — re-export of `TYPES` from `tedious` (`src/index.ts:9-10`).

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` wraps `make(config)` in `Layer.scopedContext`, publishing both `MssqlClient` and abstract `SqlClient.SqlClient` tags (`src/MssqlClient.ts:451-459`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — entire `make` factory written in `Effect.gen` (`src/MssqlClient.ts:123-427`).
- [Effect.acquireRelease / acquireUseRelease — resource management](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `Effect.addFinalizer(() => conn.close())` at `src/MssqlClient.ts:172` guarantees socket cleanup on pool-slot release.
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — all failures wrapped as `SqlError` with `cause` carrying the raw `tedious` error (`src/MssqlClient.ts:176-179`).
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` accepts `Config.Config.Wrap<MssqlClientConfig>` for env-var-driven credentials (`src/MssqlClient.ts:433-445`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `MssqlClient.MssqlClient` is a `Context.GenericTag` (`src/MssqlClient.ts:71`).
- [Dual data-first / data-last (dual and pipeable trait)](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `Procedure` implements `Pipeable` (`src/Procedure.ts:33`, `src/Procedure.ts:91-93`).

## What's unique about this package's design

The T-SQL compiler in `makeCompiler` (`src/MssqlClient.ts:465-501`) differs from pg/mysql2 on three points: placeholders are `@N` (via `numberToParamName`, `src/MssqlClient.ts:507-509`); identifiers are bracket-escaped with `.` split into `].[` so `sql("dbo.people")` → `[dbo].[people]` (`src/MssqlClient.ts:505`); and `RETURNING` is replaced by `OUTPUT INSERTED.*` emitted before `VALUES` / `FROM` (`src/MssqlClient.ts:477-499`), keeping `sql.insert({...}).returning("*")` valid across dialects.

The stored-procedure abstraction is unique to this driver. `Procedure.make` → `param` → `outputParam` → `withRows` → `compile` accumulates type parameters via intersection (`Simplify<I & { [K in N]: Parameter<A> }>`) at `src/Procedure.ts:112-129`, yielding a `call` result typed as `Procedure.Result<O, A>` with distinct `output` and `rows` fields (`src/Procedure.ts:75-82`).

## Conventions observed

- `rowCollectionOnRequestCompletion: true` (`src/MssqlClient.ts:154`) buffers rows until request completion; `executeStream` is intentionally unimplemented and `dieMessage`s (`src/MssqlClient.ts:285-287`).
- Migration example uses `INT IDENTITY(1,1) PRIMARY KEY` and `DEFAULT GETDATE()` (`repos/effect/packages/sql-mssql/examples/migrations/0001_create_people.ts:7-10`) — T-SQL idioms absent from pg/mysql2 equivalents.
- Idempotent procedure creation via `CREATE OR ALTER PROC` shown in `repos/effect/packages/sql-mssql/examples/migrations.ts:19-25`.

## "If you were authoring something similar, copy this"

- **Scope every raw connection** with `Effect.addFinalizer` (`src/MssqlClient.ts:172`) — the pool scope makes cleanup unconditional.
- **Publish abstract and concrete tags from one layer** (`src/MssqlClient.ts:438-440`) — callers depending only on `SqlClient` need no driver import.
- **Incremental generic accumulation for typed builders** (`src/Procedure.ts:112-129`, `src/Procedure.ts:135-152`) — each `param` / `outputParam` call widens the type map without a class hierarchy.
- **Expose `defaultParameterTypes` as an override point** (`src/MssqlClient.ts:514-524`) — callers can remap `number` → `Decimal` or `string` → `NVarChar` without patching the driver.

## Open questions

1. **`executeStream` omission** (`src/MssqlClient.ts:285-287`) — `tedious` emits row-by-row events compatible with `SqlStream.asyncPauseResume`; it is unclear if the gap is intentional or pending.
2. **`authType` cast as `any`** (`src/MssqlClient.ts:162`) — no compile-time guard against invalid auth strategy strings (e.g. `"ntlm"`, Azure MSI variants).
3. **Savepoint name length** (`src/MssqlClient.ts:378`) — `effect_sql_<counter>` prefix; SQL Server caps savepoint names at 32 characters with no guard on counter growth.
4. **`Reactivity.layer` always provided** (`src/MssqlClient.ts:445`, `src/MssqlClient.ts:459`) — cost is unconditional even when reactive queries are unused.

# @effect/sql-kysely

> Source: `repos/effect/packages/sql-kysely/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `kysely` (all peer dependencies; see `repos/effect/packages/sql-kysely/package.json:67-71`)

## What it does

`@effect/sql-kysely` bridges [Kysely](https://kysely.dev/), a fully type-safe TypeScript query builder, into the Effect ecosystem. It gives every Kysely builder object (select, insert, update, delete, DDL) the ability to be `yield*`-ed directly inside `Effect.gen`, integrating with Effect's error channel, dependency injection, and structured concurrency without any manual promise interop. Without this package, callers must `.execute()` Kysely builders manually, catch raw driver errors, and wire transactions by hand.

Two modes are available: a **`SqlClient`-backed mode** (the dialect modules `Sqlite`, `Pg`, `Mysql`, `Mssql`) where Kysely only compiles SQL and `@effect/sql`'s driver executes it, and a **native Kysely driver mode** (the root `Kysely` module) where any Kysely `Dialect` drives execution directly.

## Public API surface

All modules are individually importable via `@effect/sql-kysely/<ModuleName>`.

- **`Kysely`** (`repos/effect/packages/sql-kysely/src/Kysely.ts:10`) — `make(config: KyselyConfig)` using the native Kysely driver; any `Dialect` can be passed. Builders are patched in-place to be Effect-aware.
- **`Sqlite`** (`repos/effect/packages/sql-kysely/src/Sqlite.ts:12-21`) — `make<DB>(config?)` wiring `SqliteAdapter + DummyDriver + SqliteQueryCompiler`; execution delegates to `SqlClient` from context.
- **`Pg`** / **`Mysql`** / **`Mssql`** (`repos/effect/packages/sql-kysely/src/Pg.ts:12-21`, `Mysql.ts:12-21`, `Mssql.ts:12-21`) — same shape as `Sqlite`, dialect-specific adapters and compilers.
- **`patch.types`** (re-exported from all modules, `repos/effect/packages/sql-kysely/src/patch.types.ts:8-32`) — `declare module "kysely"` augmentations merging `Effect.Effect<Array<O>, SqlError>` onto every builder interface, plus the `EffectKysely<DB>` type.

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — all five entry-point modules expose a `make` function; the four `SqlClient`-backed ones yield `SqlClient` from context via `Effect.gen` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:56-67`).
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — `makeWithSql` uses `Effect.gen` to acquire `SqlClient.SqlClient` before constructing the `Kysely<DB>` instance.
- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — callers wrap `make` in `Layer.effect(MyTag, ...)` and provide a driver layer (`repos/effect/packages/sql-kysely/examples/sqlite.ts:21`).
- [`Data.TaggedError`](../02-patterns-catalog.md#datataggederror) — failures are wrapped in `SqlError` from `@effect/sql/SqlError` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:3,32,77`).
- [`Effect.withSpan` / `annotateCurrentSpan` — distributed tracing](../02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing) — native-driver execution wraps each call with `Effect.withSpan("kysely.execute", { kind: "client", attributes: { "db.query.text": sql } })` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:75-85`).
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — runtime logic lives in `src/internal/`; public modules expose only `make` and the type augmentations.

## What's unique about this package's design

The central design is **prototype patching via `Effectable.CommitPrototype`**. On import, `patch(BuilderClass.prototype)` is called for each exported Kysely builder, mixing in `CommitPrototype` so instances satisfy `Effect.EffectTypeId` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:15-27`). The real `commit` is installed via a `Proxy` when `make` is called (`repos/effect/packages/sql-kysely/src/internal/patch.ts:34-63`), not on the shared prototype, so multiple independent `Kysely<DB>` instances with different backends coexist safely.

`SelectQueryBuilder` is not exported by Kysely, so it is reached by calling `db.selectFrom("" as any)` once at construction time and reading `Object.getPrototypeOf(result)` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:63-65`, `77-78`).

The **`DummyDriver`** pattern (`repos/effect/packages/sql-kysely/src/Sqlite.ts:5,14`) replaces Kysely's driver with a no-op stub; the `SqlClient` from context executes I/O via `client.unsafe(sql, parameters)` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:67-70`). Kysely contributes only a typed AST and compiled SQL string; connection pooling and transactions belong to `@effect/sql`.

Compared to `sql-drizzle`, which relies on a mutable `currentRuntime` variable (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:8,45-72`) to thread the Effect runtime through Drizzle's callback driver, `sql-kysely` has no shared mutable state: the `Proxy` closes over each instance's `commit` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:51-52`).

## Conventions observed

- **`sideEffects` in `package.json`** (`repos/effect/packages/sql-kysely/package.json:32-37`): dialect imports run `patch(BuilderClass.prototype)` immediately — a global mutation that must not be tree-shaken.
- **Module augmentation as public type API**: `patch.types.ts` is a `declare module "kysely"` block only (`repos/effect/packages/sql-kysely/src/patch.types.ts:8-32`), re-exported via `export type *` from each dialect.
- **`Omit<KyselyConfig, "dialect">`** on `SqlClient`-backed constructors (`repos/effect/packages/sql-kysely/src/Sqlite.ts:12`): the dialect is built internally, preventing driver/adapter mismatches.
- **`withTransaction` bridge**: `EffectKysely<DB>` drops Kysely's promise-based `transaction()` and exposes `withTransaction` from `SqlClient` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:60`, `src/patch.types.ts:38-40`).
- **`@since 1.0.0` + `@category`** JSDoc on every export — monorepo standard.

## "If you were authoring something similar, copy this"

- **`DummyDriver` to decouple SQL compilation from execution** (`repos/effect/packages/sql-kysely/src/Sqlite.ts:5,14-20`): any ORM with a pluggable dialect can delegate I/O to an Effect service this way.
- **Prototype-patch with `Effectable.CommitPrototype`** (`repos/effect/packages/sql-kysely/src/internal/patch.ts:15-27`): builders become `yield*`-able without call-site `Effect.promise(...)` wrappers.
- **Install `commit` per proxy, not per prototype** (`repos/effect/packages/sql-kysely/src/internal/patch.ts:34-63`): the prototype holds a sentinel; the real backend commit is captured inside the proxy closure, enabling safe multi-instance use.
- **Reach unexported prototypes via a throwaway instance** (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:63-65`): `Object.getPrototypeOf(db.selectFrom("" as any))` avoids unsafe casts.
- **List side-effectful entry points in `sideEffects`** (`repos/effect/packages/sql-kysely/package.json:32-37`): prototype mutations at import time must be declared or bundlers will tree-shake them.

## Open questions

- The README compatibility matrix only covers Kysely up to `0.27.3` but `package.json` now pins `^0.28.2` (`repos/effect/packages/sql-kysely/package.json:65`, `repos/effect/packages/sql-kysely/README.md:3-8`). Is the matrix stale or is the instability disclaimer still current?
- `makeWithSql` is defined in `internal/kysely.ts:55-67` but never exported publicly. Is it a future public API or permanently internal?
- `effectifyWith` recursively wraps every builder method return value in a new `Proxy` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:58`). What is the performance impact of deeply chained builders, and is a short-circuit planned?
- `WheneableMergeQueryBuilder` is patched (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:47-48`) but no test covers MERGE queries. Is MERGE functional across all four dialects or speculative?

# @effect/sql-drizzle

> Source: `repos/effect/packages/sql-drizzle/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql` (both peer dependencies; see `repos/effect/packages/sql-drizzle/package.json:67-71`)

## What it does

`@effect/sql-drizzle` bridges the Drizzle ORM query-builder into the Effect ecosystem. Drizzle builds typed SQL ASTs and normally executes them via a driver-specific `execute` callback returning a `Promise`. This package replaces that callback with one backed by `@effect/sql`'s `SqlClient`, making every Drizzle query object directly `yield*`-able inside `Effect.gen`. Without it, developers who want both Drizzle's type-safe DSL and Effect's structured concurrency must manually bridge the two worlds for every query — mapping `Promise` rejections to `SqlError` and losing the fiber-local context that carries transaction connections.

## Public API surface

No `index.ts`; each dialect is a standalone module (`repos/effect/packages/sql-drizzle/package.json:37-41`).

- **`@effect/sql-drizzle/Pg`** (`repos/effect/packages/sql-drizzle/src/Pg.ts:1-68`) — `PgDrizzle` tag, `make` / `makeWithConfig` constructors, `layer` / `layerWithConfig`, and the Postgres prototype patch.
- **`@effect/sql-drizzle/Mysql`** (`repos/effect/packages/sql-drizzle/src/Mysql.ts:1-69`) — same shape for `MysqlDrizzle` / `MySqlRemoteDatabase`.
- **`@effect/sql-drizzle/Sqlite`** (`repos/effect/packages/sql-drizzle/src/Sqlite.ts:1-69`) — same shape for `SqliteDrizzle` / `SqliteRemoteDatabase`.
- **`internal/patch`** (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:1-72`) — the shared engine: `makeRemoteCallback` (the Drizzle remote-proxy callback as an `Effect`) and `patch` (mutates a `QueryPromise` prototype to satisfy the `Effect` interface).

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — each dialect module exports a `layer` wrapping `make()` in `Layer.effect` (or `Layer.scoped` for SQLite, `repos/effect/packages/sql-drizzle/src/Sqlite.ts:53`), providing the Drizzle handle as a standard tagged service.
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `PgDrizzle`, `MysqlDrizzle`, and `SqliteDrizzle` are `Context.Tag` subclasses (`repos/effect/packages/sql-drizzle/src/Pg.ts:44-47`), giving each Drizzle handle a typed Context key.
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `makeRemoteCallback` and the three `make` constructors use `Effect.gen` to acquire `SqlClient` and thread it into `drizzle(...)` (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:45-72`).
- [Effect.succeed / fail / sync / promise / tryPromise](../02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise) — `commit` wraps `this.execute()` with `Effect.tryPromise`, mapping rejections to `new SqlError(...)` (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:18-33`).
- [Runtime — pre-built runtime for executing Effects](../02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects) — `makeRemoteCallback` captures `Effect.runtime<never>()` at construction; `Runtime.runPromise` re-enters Effect from inside the Drizzle callback (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:47-49`).
- [Effect.Service class](../02-patterns-catalog.md#effectservice-class) — tests pass `make()` to `Effect.Service` to define a typed ORM service (`repos/effect/packages/sql-drizzle/test/Sqlite.test.ts:33-35`).
- [The internal/ folder and index.ts re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all shared logic lives in `src/internal/patch.ts`; dialect modules import only two named exports from it.

## What's unique about this package's design

The central trick is the **prototype patch** (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:10-42`). Rather than wrapping each query in an adapter, `patch(prototype)` installs `Effectable.CommitPrototype` properties directly onto Drizzle's `QueryPromise.prototype` and each dialect's `SelectBase.prototype`. Every instance of those classes then satisfies `Effect.EffectTypeId`, so the runtime calls `commit()` when one is yielded. This is the transferable pattern for making any third-party "thenable" class `yield*`-able without per-value wrapping.

The second design is the **mutable `currentRuntime` cell** (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:8`). `commit` captures `Effect.runtime()`, stores it in `currentRuntime`, calls `this.execute()` synchronously, then restores the prior value. The remote callback prefers `currentRuntime` over the construction-time runtime, so queries inside `sql.withTransaction(...)` use the transactional connection automatically (`repos/effect/packages/sql-drizzle/test/Mysql.test.ts:35-55`).

The **`sideEffects` declaration** (`repos/effect/packages/sql-drizzle/package.json:32-36`) is load-bearing: each module calls `patch(QueryPromise.prototype)` at import time. Marking those files side-effectful prevents bundlers from tree-shaking the patch away, which would silently break `yield*`.

## Conventions observed

- **No top-level `index.ts`**: three peer-level dialect modules exposed via `exports` (`repos/effect/packages/sql-drizzle/package.json:37-41`); `"./internal/*": null` blocks direct imports.
- **Module augmentation for the error channel**: each dialect adds `interface QueryPromise<T> extends Effect.Effect<T, SqlError> {}` via `declare module "drizzle-orm"` (`repos/effect/packages/sql-drizzle/src/Pg.ts:64-66`), retroactively typing all query objects without touching Drizzle's source.
- **Side-effectful imports**: `patch(...)` runs at module top-level, matching the `"sideEffects"` array in `package.json` — consumers must import the dialect module (or use `layer`) for the patch to activate.
- **`@since 1.0.0` + `@category` JSDoc** on every export, consistent with the monorepo standard.

## "If you were authoring something similar, copy this"

- **`Effectable.CommitPrototype` + `Object.assign(prototype, PatchProto)`** to make any external class `yield*`-able (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:10-42`). Guard with `if (Effect.EffectTypeId in prototype) return` for idempotency.
- **Capture `Effect.runtime()` inside `commit()`** to carry transaction connections and `FiberRef` state across the Effect–Promise boundary (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:19-21`).
- **Use the library's "proxy" driver mode as the seam** (`repos/effect/packages/sql-drizzle/src/Pg.ts:9`). Drizzle's `pg-proxy`, `mysql-proxy`, and `sqlite-proxy` accept a plain async callback — any DSL with a similar escape hatch suits this pattern.
- **Pass `make()` to `Effect.Service` in tests** (`repos/effect/packages/sql-drizzle/test/Sqlite.test.ts:33-35`) to verify the constructor composes with standard DI.

## Open questions

1. **`currentRuntime` race**: the cell is a module-level `let`, not a `FiberRef`. Two concurrent fibers in different `sql.withTransaction` blocks could race on the write/restore. Safety relies on `this.execute()` completing synchronously — needs auditing under Effect's cooperative scheduler.
2. **`Layer.scoped` vs `Layer.effect` for SQLite**: `Sqlite.layer` uses `Layer.scoped` (`repos/effect/packages/sql-drizzle/src/Sqlite.ts:53`) while the other two use `Layer.effect`. Nothing in `Sqlite.make()` acquires a scoped resource, suggesting a latent inconsistency.
3. **Drizzle version ceiling**: `drizzle-orm: ">=0.43.1 <0.50"` (`repos/effect/packages/sql-drizzle/package.json:69`). The upper bound implies `QueryPromise.prototype` shape may change in 0.50; no migration path is documented.
4. **No Effect Schema on results**: unlike `SqlSchema.findAll`, results are returned as Drizzle-decoded rows. Applications needing `ParseError` type safety must add their own `Schema.decode` step.

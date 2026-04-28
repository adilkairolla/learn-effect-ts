# @effect/sql-sqlite-do

> Source: `repos/effect/packages/sql-sqlite-do/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect` (peer), `@effect/sql` (peer), `@effect/experimental` (peer)

## What it does

`@effect/sql-sqlite-do` bridges the `@effect/sql` `SqlClient` interface to Cloudflare Durable Objects' built-in SQLite storage. Every Durable Object instance exposes a `SqlStorage` handle (`this.ctx.storage.sql`) that holds an embedded SQLite database scoped to that object — no external process, no network round-trip. This package wires that handle into the Effect SQL stack so code written against `SqlClient` runs unchanged inside a Durable Object. Without it, authors would manually translate SQL fragments into `SqlStorage.exec` calls, handle `ArrayBuffer`-to-`Uint8Array` blob coercions, and reinvent transaction serialization outside Effect's typed error channel.

## Public API surface

Both modules are re-exported from `repos/effect/packages/sql-sqlite-do/src/index.ts:1-9`.

- **`SqliteClient`** (`src/SqliteClient.ts:38-62`) — the concrete service interface (extends `@effect/sql/SqlClient`) and its `Context.GenericTag`. `SqliteClientConfig.db` accepts a `SqlStorage` handle directly; `transformResultNames`, `transformQueryNames`, and `spanAttributes` mirror the other SQLite drivers. `layer(config)` takes a plain config object (`src/SqliteClient.ts:214-222`); `layerConfig(config)` accepts a `Config.Config.Wrap<SqliteClientConfig>` for environment-driven wiring (`src/SqliteClient.ts:196-208`).
- **`SqliteMigrator`** (`src/SqliteMigrator.ts:19-33`) — thin re-export of `@effect/sql/Migrator` calling `Migrator.make({})` with no dialect options. Exposes `run` and `layer` so migrations look identical to every other driver.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — both `layer` and `layerConfig` use `Layer.scopedContext` to publish the client under two tags at once and bake in `Layer.provide(Reactivity.layer)` (`src/SqliteClient.ts:196-222`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `SqliteClient` is a `Context.GenericTag` keyed `"@effect/sql-sqlite-do/SqliteClient"` (`src/SqliteClient.ts:50`), keeping driver call sites agnostic.
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` sequences compiler creation, connection construction, and semaphore acquisition (`src/SqliteClient.ts:71-190`).
- [Semaphore — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — a 1-permit semaphore serializes all execution and powers the transaction acquirer via `uninterruptibleMask` + `semaphore.take(1)` (`src/SqliteClient.ts:157-173`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — statement failures surface as `SqlError` (`src/SqliteClient.ts:100-103`, `src/SqliteClient.ts:115-119`), typed and catchable via `Effect.catchTag`.
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` resolves a `Config.Config.Wrap<SqliteClientConfig>` via `Config.unwrap` at layer build time (`src/SqliteClient.ts:199-200`).

## What's unique about this package's design

The defining constraint: `SqlStorage` is a Cloudflare-proprietary API available only inside a Durable Object handler. The `db` field (`src/SqliteClient.ts:57`) is typed as `SqlStorage` from `@cloudflare/workers-types` — no file path, no connection string, no pool. The caller injects `this.ctx.storage.sql`; the layer wraps it. There is no `layerFromPath` variant.

The row iterator (`src/SqliteClient.ts:80-94`) converts raw row arrays into column-keyed objects and coerces `ArrayBuffer` blob values to `Uint8Array` inline (`src/SqliteClient.ts:88-92`) — a transformation `SqlStorage` does not perform automatically.

Durable Objects enforce single-threaded execution per instance, making the semaphore a no-op in practice, but its presence keeps `withTransaction` semantics identical to all other `@effect/sql` drivers.

## Conventions observed

- **Dual-tag layer**: `SqliteClient` and `Client.SqlClient` are published together via `Context.make(...).pipe(Context.add(...))` (`src/SqliteClient.ts:219-221`) — the standard dual-publish convention across `@effect/sql` drivers.
- **`updateValues: never`**: marks SQLite's missing `UPDATE ... RETURNING` as a compile-time constraint (`src/SqliteClient.ts:43`), not a runtime error.
- **No-option migrator**: `SqliteMigrator.run` calls `Migrator.make({})` with no dialect options (`src/SqliteMigrator.ts:25`).
- **`ATTR_DB_SYSTEM_NAME = "db.system.name"` span attribute** (`src/SqliteClient.ts:20`) for OpenTelemetry semantic convention compliance.
- **`@since 1.0.0` + `@category` on every export**, consistent with the monorepo standard.

## "If you were authoring something similar, copy this"

- **Accept the runtime handle directly in config** (`src/SqliteClient.ts:56-62`). When the platform gives you an opaque object, put it in the config struct — no path variants, no lazy init.
- **1-permit semaphore for single-connection databases** (`src/SqliteClient.ts:157-165`): correct transaction semantics at near-zero cost.
- **Inline blob coercion at the row cursor** (`src/SqliteClient.ts:88-92`, `src/SqliteClient.ts:113-118`). Platform wire-format quirks belong in the innermost loop, not schema decoders.
- **Dual-tag in one `Layer.scopedContext`** (`src/SqliteClient.ts:217-221`): concrete tag and `SqlClient.SqlClient` together, no extra `Layer.merge`.

## Open questions

1. **Transactional durability**: whether `BEGIN` / `COMMIT` via `SqlStorage.exec` participates in the DO input gate or survives a mid-transaction crash is undocumented — unlike `storage.put` whose atomicity is explicitly guaranteed.
2. **`executeStream` and CPU limits**: lazy row iteration (`src/SqliteClient.ts:141-154`) may span multiple event-loop ticks; whether this can exceed Durable Objects' per-request CPU budget is unaddressed.
3. **`layerConfig` use case**: wrapping a `SqlStorage` handle inside `Config.Config.Wrap` is unusual — `SqlStorage` is not an environment variable. The practical motivation for `layerConfig` over `layer` in a DO context is unclear.
4. **No integration tests**: `test/Client.test.ts:1-6` is a no-op placeholder; NULL handling, transaction rollback, and blob coercion are untested.

# @effect/sql-clickhouse

> Source: `repos/effect/packages/sql-clickhouse/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/platform-node`, `@effect/sql`, `@effect/experimental` (all peer; one runtime dep: `@clickhouse/client ^1.6.0`)

## What it does

`@effect/sql-clickhouse` wraps `@clickhouse/client` — the official HTTP driver for ClickHouse, a columnar OLAP database — inside the Effect `SqlClient` interface. ClickHouse speaks HTTP rather than a wire protocol, so result rows arrive as a Node.js `Readable` stream body; `NodeStream.fromReadable` from `@effect/platform-node` bridges that into an Effect `Stream`. This is why it requires `@effect/platform-node` as a peer — no other `@effect/sql-*` driver in the monorepo does this. Without the package, callers would manually handle HTTP sessions, format negotiation (`JSONEachRow`, `JSONCompact`), server-side query cancellation, and bulk-insert plumbing outside the Effect runtime.

## Public API surface

Re-exported from `repos/effect/packages/sql-clickhouse/src/index.ts:1-9`.

- **`ClickhouseClient`** (`src/ClickhouseClient.ts:44-68`) — extends `SqlClient.SqlClient` with: `insertQuery` for typed bulk insert accepting any `Clickhouse.DataFormat`; `withQueryId` and `withClickhouseSettings` for fiber-scoped per-request options (both dual); three exported `FiberRef`s (`currentClientMethod`, `currentQueryId`, `currentClickhouseSettings`).
- **`ClickhouseMigrator`** (`src/ClickhouseMigrator.ts:24-42`) — thin re-export of `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem` with `run` and `layer` pre-configured via `Migrator.make({})`.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer`/`layerConfig` use `Layer.scopedContext`; session acquired on build, released via `client.close()` (`src/ClickhouseClient.ts:100-116`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `SELECT 1` health-check as acquire, `client.close()` as release, 5-second timeout (`src/ClickhouseClient.ts:101-116`).
- [FiberRef — fiber-local state](../02-patterns-catalog.md#fiberref--fiber-local-state) — `currentClientMethod`, `currentQueryId`, `currentClickhouseSettings` scoped per-fiber, each via `globalValue` for HMR safety (`src/ClickhouseClient.ts:301-323`).
- [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `withQueryId` and `withClickhouseSettings` are `dual(2, ...)` (`src/ClickhouseClient.ts:283-292`).
- [Stream.async* family](../02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable) — `executeStream` calls `NodeStream.fromReadable(() => result.stream())` then batches `row.json()` per chunk in `Promise.all` (`src/ClickhouseClient.ts:199-230`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `ClickhouseClient` is a `Context.GenericTag`; both layer constructors register it alongside `SqlClient.SqlClient` (`src/ClickhouseClient.ts:74`, `src/ClickhouseClient.ts:337-356`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — all failures wrap into `SqlError` (`src/ClickhouseClient.ts:9, 104, 111, 152, 213`).
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` accepts `Config.Config.Wrap<ClickhouseClientConfig>`, resolved via `Config.unwrap` (`src/ClickhouseClient.ts:330-342`).

## What's unique about this package's design

`executeStream` forces `JSONEachRow` format and bridges the HTTP body via `NodeStream.fromReadable` — the only `@effect/sql-*` driver that imports a Node.js stream API. Per-chunk `Promise.all` over `row.json()` (`src/ClickhouseClient.ts:215-227`) amortizes the async boundary across a full chunk rather than per row.

Every query and bulk insert registers an `AbortController`. On fiber interruption the `Effect.async` finalizer calls `controller.abort()` and then `KILL QUERY WHERE query_id = '...'` on the server (`src/ClickhouseClient.ts:156-160`, `src/ClickhouseClient.ts:276-279`).

`makeCompiler` encodes ClickHouse's named placeholder syntax `{p1: Type}` and infers types from JS values via `typeFromUnknown` (`src/ClickhouseClient.ts:358-404`): `number` → `"Decimal"`, `bigint` → `"Int64"`, `Date` → `"DateTime()"`, arrays → `"Array(T)"`. No other sql driver does JS-to-DB-type inference at the compiler level.

## Conventions observed

- **Module namespace re-exports**: `export * as ClickhouseClient` / `export * as ClickhouseMigrator` in `src/index.ts:4-9`.
- **Dual tag registration**: both layer constructors register the client under `ClickhouseClient` and `SqlClient.SqlClient` in one `Context` (`src/ClickhouseClient.ts:337-356`).
- **No connection pool**: ClickHouse's stateless HTTP model makes pooling unnecessary.
- **`onRecordUpdate` is a no-op**: `makeCompiler` returns `["", []]` (`src/ClickhouseClient.ts:398-400`) — `sql.update(...)` is silently unsupported, deliberate for an append-optimized store.

## "If you were authoring something similar, copy this"

- **`Effect.async` + `AbortController` as the interruption finalizer** (`src/ClickhouseClient.ts:128-160`): callback return value is the cancellation effect — abort client-side then issue a server kill.
- **`FiberRef` + `Effect.locally` + `dual`** for per-request ambient context (`src/ClickhouseClient.ts:253-292`): scope is one effect tree; outer fiber untouched; both pipe and direct-call ergonomics.
- **Batch async deserialization per chunk** with `Promise.all` in `Stream.mapEffect` (`src/ClickhouseClient.ts:215-227`): one await per chunk, not per row.
- **Delegate migrations to `Migrator.make({})`** for any DB that uses standard DDL (`src/ClickhouseMigrator.ts:30`).

## Open questions

1. **Transaction safety**: `make` passes `beginTransaction: "BEGIN TRANSACTION"` (`src/ClickhouseClient.ts:243`), but ClickHouse only supports lightweight transactions under specific conditions — `sql.withTransaction(...)` may silently succeed while the database ignores the boundary.
2. **`asCommand` misuse**: no guard prevents running a `SELECT` via `asCommand`, silently discarding results — no type-level prevention.
3. **`executeValues` + `JSONCompact`**: forced `JSONCompact` format (`src/ClickhouseClient.ts:192-194`) — unclear which `@effect/sql` feature consumes this or whether `Statement.defaultTransforms` handles the compact row-array layout.
4. **Streaming backpressure**: whether `NodeStream.fromReadable` pauses the socket under a slow consumer or buffers the full HTTP response is not visible from this package's source.

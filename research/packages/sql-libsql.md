# @effect/sql-libsql

> Source: `repos/effect/packages/sql-libsql/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/experimental`, `@effect/sql` (all peer dependencies; one runtime dependency: `@libsql/client ^0.12.0`)

## What it does

`@effect/sql-libsql` is the Effect driver for [libSQL](https://github.com/libsql/libsql), the Turso fork of SQLite that speaks both a local file protocol and a remote HTTP/WebSocket protocol. It provides a `LibsqlClient` service that satisfies `@effect/sql`'s abstract `SqlClient` interface, so application code written against `SqlClient` can target a local `.db` file for development and a Turso edge database for production by swapping one `Layer`. Without this package, wiring libSQL's promise-based `@libsql/client` SDK into Effect requires manual `acquireRelease` lifecycle, error mapping, transaction semantics, and semaphore-based concurrency — roughly the same code that lives here.

## Public API surface

Both modules are re-exported from `repos/effect/packages/sql-libsql/src/index.ts:1-9`.

- **`LibsqlClient`** (`src/LibsqlClient.ts:37-40`) — the concrete service interface. Extends `SqlClient.SqlClient`; carries a branded `TypeId` and exposes `config: LibsqlClientConfig`. Key exports:
  - `make(options)` — scoped `Effect` that builds the client; requires `Scope | Reactivity.Reactivity` (`src/LibsqlClient.ts:136-138`).
  - `layer(config)` — the standard `Layer` constructor for literal config objects (`src/LibsqlClient.ts:318-326`).
  - `layerConfig(config)` — variant that reads config from `Config.Config.Wrap<LibsqlClientConfig>`, enabling env-var–driven setup (`src/LibsqlClient.ts:300-312`).
  - `LibsqlClientConfig` namespace — two config shapes: `Full` (URL + auth/encryption tokens + sync options) and `Live` (pre-built `@libsql/client` instance) (`src/LibsqlClient.ts:62-123`).
- **`LibsqlMigrator`** (`src/LibsqlMigrator.ts:1-38`) — re-exports `@effect/sql/Migrator` and `@effect/sql/Migrator/FileSystem` verbatim, then exposes `run` and `layer` bound to `Migrator.make({})` (no extra options needed for SQLite). Application code calls `LibsqlMigrator.layer(options)` without touching the base migrator directly.

## Patterns used

- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — the `@libsql/client` SDK instance is acquired with `Effect.sync(() => Libsql.createClient(...))` and released with `sdk.close()` inside `acquireRelease`, scoping the connection lifetime to the `Layer` (`src/LibsqlClient.ts:229-248`).
- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` and `layerConfig` both use `Layer.scopedContext` and register both the concrete `LibsqlClient` tag and the abstract `SqlClient.SqlClient` tag in the returned `Context`, so callers can depend on either (`src/LibsqlClient.ts:300-326`).
- [Semaphore — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — a `Semaphore(1)` serialises all statement executions against the single libSQL connection; the `acquirer` gates non-transaction queries, and `withTransaction` takes the permit before opening a transaction object (`src/LibsqlClient.ts:249`, `src/LibsqlClient.ts:272-278`).
- [Config.string / integer / boolean / nested / all](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `layerConfig` accepts `Config.Config.Wrap<LibsqlClientConfig>`, allowing `Config.all({ url: Config.string("DB_URL"), authToken: Config.redacted("DB_TOKEN") })` without any manual env reading (`src/LibsqlClient.ts:300-312`).
- [Redacted — prevent secret values from leaking to logs/spans](../02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans) — `authToken` and `encryptionKey` are typed as `Redacted.Redacted`; `Redacted.value(...)` is called only at the moment the SDK is constructed, keeping secrets out of spans and logs (`src/LibsqlClient.ts:87-90`, `src/LibsqlClient.ts:234-239`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `LibsqlClient` is a `Context.GenericTag`; the internal `LibsqlTransaction` is a second `GenericTag` used to propagate the active transaction object down the fiber context (`src/LibsqlClient.ts:46`, `src/LibsqlClient.ts:48-50`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` is written entirely as `Effect.gen`, sequencing compiler setup, connection acquisition, semaphore creation, and client assembly in a readable top-to-bottom flow (`src/LibsqlClient.ts:139-294`).

## What's unique about this package's design

The most interesting design point is the **dual-mode config union** (`LibsqlClientConfig.Full | LibsqlClientConfig.Live`). The `Full` variant accepts a URL string that the libSQL SDK dispatches to the correct transport: `file:./local.db` for in-process SQLite, `http://`/`https://` for Turso's remote HTTP protocol, `ws://`/`wss://` for WebSocket, and `libsql://` for TLS-enabled remote. The `Live` variant bypasses URL parsing entirely and accepts a pre-built `Libsql.Client`, enabling injection of mocked or custom clients in tests. The branch at `src/LibsqlClient.ts:226-248` chooses between these at construction time with a simple `"liveClient" in options` check — no subclassing or factory indirection required.

Compared to the bare SQLite drivers in the same monorepo (`@effect/sql-sqlite-node`, `@effect/sql-sqlite-bun`), libsql's transaction model is fundamentally different. The bare drivers use a single synchronous connection with a `Semaphore(1)` acquirer that re-uses the connection for both transactional and non-transactional queries. libsql must call `client.transaction("write")` to obtain an explicit `Transaction` object, then `commit()` or `rollback()` on it — reflected in the dedicated `beginTransaction`, `commit`, and `rollback` members on `LibsqlConnectionImpl` (`src/LibsqlClient.ts:203-223`). The bare drivers also add SQLite-specific extras (`export`, `backup`, `loadExtension`, `prepareCacheSize`) that libsql omits because the remote mode makes them inapplicable.

`executeStream` is explicitly unimplemented (`Effect.dieMessage`) at `src/LibsqlClient.ts:200-202` — libSQL's HTTP batch mode has no server-side cursor, so streaming is a genuine capability gap rather than an oversight.

## Conventions observed

- **No `internal/` directory**: unlike `@effect/sql`, this driver has no `internal/` folder. The `LibsqlConnectionImpl` class is declared locally inside `make` as a closure-private class, keeping implementation details out of the public API without the file-level convention (`src/LibsqlClient.ts:152-224`).
- **`Reactivity.layer` bundled into every `Layer`**: both `layer` and `layerConfig` end with `.pipe(Layer.provide(Reactivity.layer))` (`src/LibsqlClient.ts:312`, `src/LibsqlClient.ts:326`). Consumers never need to provide `Reactivity.Reactivity` manually — it is an implementation detail, not a requirement imposed on callers.
- **`@since 1.0.0` + `@category` JSDoc on every export**, consistent with the monorepo standard (`src/LibsqlClient.ts:24-27`, `src/LibsqlClient.ts:44-47`).
- **Migrator is a thin re-export**: `LibsqlMigrator` does not add any SQLite-specific migration logic; it just binds `Migrator.make({})` and re-exports the file-system loader. The pattern is identical to `@effect/sql-sqlite-node`'s `SqliteMigrator`, making it trivially copy-able for new drivers.

## "If you were authoring something similar, copy this"

- **Use a `Full | Live` config union to support both production and test injection** — `"liveClient" in options` branches at the top of `make`; no factory pattern or subclass needed. The `Live` branch skips `acquireRelease` entirely since lifetime management belongs to the injected client (`src/LibsqlClient.ts:226-248`).
- **Register both the concrete tag and the abstract `SqlClient` tag in one `Layer.scopedContext`** (`src/LibsqlClient.ts:304-310`). This makes the driver usable as a drop-in for any code that depends only on `SqlClient.SqlClient` while still allowing driver-specific code to resolve `LibsqlClient` directly.
- **Store `Redacted` secrets and unwrap them only at SDK construction time** — type the config fields as `Redacted.Redacted`, pass them through the config system opaquely, and call `Redacted.value(...)` only in the synchronous `Effect.sync(() => Libsql.createClient(...))` block (`src/LibsqlClient.ts:234-239`).
- **Use `SAVEPOINT effect_sql_<id>` for nested transactions** — `withTransaction` delegates to `Client.makeWithTransaction` which manages nested savepoints automatically; the driver only needs to implement flat `begin`/`commit`/`rollback` and the `savepoint`/`rollbackSavepoint` string commands (`src/LibsqlClient.ts:251-270`).

## Open questions

- **`concurrency` config vs. internal `Semaphore(1)`**: `LibsqlClientConfig.Full` exposes a `concurrency` field (passed directly to `@libsql/client`) controlling SDK-level HTTP request concurrency (`src/LibsqlClient.ts:113-115`), while the Effect layer independently uses `Semaphore(1)` to serialise Effect-level statement dispatch. The interaction between these two limits — especially for non-transactional parallel queries — is not documented.
- **`syncUrl` / `syncInterval` for embedded replica mode**: libSQL supports an embedded replica that syncs from a remote Turso database on an interval. The fields exist in `LibsqlClientConfig.Full` (`src/LibsqlClient.ts:93-97`) but there is no test coverage for this mode, and it is unclear how schema migrations interact with a replica that may lag behind the primary.
- **`executeStream` gap**: all other Effect SQL drivers either implement streaming (postgres, mysql) or explicitly document why it is absent. libsql's `Effect.dieMessage` (`src/LibsqlClient.ts:200-202`) is a hard runtime crash rather than a type-level `never`, meaning callers who use `SqlClient.SqlClient.stream` against a libsql layer will not get a compile error.
- **`intMode` and Schema mapping**: the `intMode: "bigint"` option changes JavaScript integer representation, but `@effect/sql`'s `Schema` helpers assume `number`. The correct `Schema` types to use when `intMode` is `"bigint"` or `"string"` are not documented.

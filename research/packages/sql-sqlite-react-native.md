# @effect/sql-sqlite-react-native

> Source: `repos/effect/packages/sql-sqlite-react-native/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `@effect/experimental` (all peer dependencies; native peer: `@op-engineering/op-sqlite@7.1.0`)

## What it does

`@effect/sql-sqlite-react-native` wires `@effect/sql`'s abstract `SqlClient` to a React Native SQLite database via the `@op-engineering/op-sqlite` JSI binding. App code targeting `@effect/sql` needs no changes — only the `Layer` entry point differs. Without this package a React Native project would manage the native DB handle directly: opening it per screen, serialising writes by hand, and running migrations outside Effect. The package is thin: two source files, ~220 lines.

## Public API surface

All modules re-exported from `repos/effect/packages/sql-sqlite-react-native/src/index.ts:1-9`.

- **`SqliteClient`** (`src/SqliteClient.ts:38-63`) — extends `@effect/sql`'s `SqlClient` with a `[TypeId]` brand, `config` accessor, and `never`-typed `updateValues` (SQLite has no `UPDATE … RETURNING`). `make(options)` (`src/SqliteClient.ts:86-189`) opens the DB under a `Scope`, wraps it in a single `SqliteConnection`, and serialises access with a 1-permit `Semaphore`. `layer` / `layerConfig` (`src/SqliteClient.ts:213-221`) pipe through `Reactivity.layer` automatically. `asyncQuery` FiberRef / `withAsyncQuery` (`src/SqliteClient.ts:69-78`) is a fiber-local toggle between synchronous JSI (`db.execute`) and async bridge (`db.executeAsync`).

- **`SqliteMigrator`** (`src/SqliteMigrator.ts:1-33`) — re-exports all `@effect/sql/Migrator` symbols and adds `run` and `layer` pre-configured for SQLite.

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer` / `layerConfig` use `Layer.scopedContext`; DB opened on build, closed via `Effect.addFinalizer` (`src/SqliteClient.ts:107, 216-221`).
- [FiberRef — fiber-local state](../02-patterns-catalog.md#fiberref--fiber-local-state) — `asyncQuery` is `FiberRef<boolean>` (default `false`) read via `Effect.withFiberRuntime`; `withAsyncQuery` flips it with `Effect.locally` without touching sibling fibers (`src/SqliteClient.ts:69-78, 113-127`).
- [Semaphore — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — 1-permit semaphore serialises all queries; `transactionAcquirer` holds the permit via `uninterruptibleMask` (`src/SqliteClient.ts:156-171`).
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — `make` and `makeConnection` are `Effect.gen` generators (`src/SqliteClient.ts:89-189`).
- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `Effect.addFinalizer` ties `db.close()` to the enclosing `Scope` (`src/SqliteClient.ts:107`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — concrete `SqliteClient` tag and abstract `SqlClient` tag both registered in the returned context (`src/SqliteClient.ts:50, 173-188`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — `SqlError` wraps sync and async op-sqlite failures with distinct messages (`src/SqliteClient.ts:117-125`).

## What's unique about this package's design

The standout feature is the **FiberRef-gated dual execution path**. `op-sqlite` exposes `db.execute` (synchronous JSI, blocks the JS thread) and `db.executeAsync` (async, yields it). A single `run` helper reads `asyncQuery` via `Effect.withFiberRuntime` and branches accordingly (`src/SqliteClient.ts:113-127`); callers opt into async mode per-effect with `withAsyncQuery`. No other monorepo sql adapter exposes a fiber-local execution mode toggle. The RN file-system model surfaces in `SqliteClientConfig`: `filename` names the DB, optional `location` passes a path prefix the native layer resolves to the iOS document or Android app-data directory, and optional `encryptionKey` enables at-rest encryption (`src/SqliteClient.ts:57-63, 91-98`).

## Conventions observed

- **`Reactivity.layer` baked in**: both layer constructors call `Layer.provide(Reactivity.layer)` directly (`src/SqliteClient.ts:207, 221`).
- **No `internal/` folder**: two source files; all implementation in `SqliteClient.ts`.
- **`globalValue` for the FiberRef**: `asyncQuery` uses `FiberRef.unsafeMake` inside `globalValue`, ensuring one identity across Metro bundle module instances (`src/SqliteClient.ts:69-72`).
- **`executeStream` as a defect**: `Connection.executeStream` calls `Effect.dieMessage` — programmer error, not a recoverable typed failure (`src/SqliteClient.ts:150-152`).

## "If you were authoring something similar, copy this"

- **Gate sync/async native calls with a FiberRef inside `Effect.withFiberRuntime`** — one implementation, two modes, caller picks per-effect (`src/SqliteClient.ts:113-127`).
- **Bake upstream infrastructure layers** (`Reactivity.layer`) into your `layer` constructor when alternatives are irrelevant to the deployment (`src/SqliteClient.ts:207, 221`).
- **Register both concrete and abstract tags in one `Layer.scopedContext`** so `@effect/sql`-only callers can swap drivers while RN-specific callers access `config` via the concrete tag (`src/SqliteClient.ts:198-207`).
- **Surface platform-native config as optional fields** (`location`, `encryptionKey`) rather than separate constructors (`src/SqliteClient.ts:57-63`).

## Open questions

1. **JSI and UI jank**: `db.execute` is synchronous JSI; the semaphore serialises fibers but does not shift work to a background thread. Must callers use `withAsyncQuery` for all slow queries?
2. **`location` path resolution**: `SqliteClientConfig.location` is forwarded verbatim to op-sqlite; no helper resolves `RNFS.DocumentDirectoryPath`. Does this belong in the package or user space?
3. **Encryption key sourcing**: `encryptionKey` is a plain string in config with no guidance on pulling it from the iOS Keychain or Android Keystore.
4. **`withAsyncQuery` inside transactions**: if a transaction step uses `withAsyncQuery`, the native call may yield between steps; op-sqlite's transaction isolation across async boundaries is not addressed (`src/SqliteClient.ts:160-171`).
5. **Migration loader for Metro**: `SqliteMigrator.run` delegates to `Migrator.make({})` with no options (`src/SqliteMigrator.ts:25`) and provides no Metro-aware SQL file loader — RN apps must inline migrations themselves.

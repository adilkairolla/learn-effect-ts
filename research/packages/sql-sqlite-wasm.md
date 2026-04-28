# @effect/sql-sqlite-wasm

> Source: `repos/effect/packages/sql-sqlite-wasm/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/sql`, `@effect/experimental`, `@effect/wa-sqlite` (all peer; `@effect/wa-sqlite` is the only externally-maintained `@effect/*` package in the graph)

## What it does

`@effect/sql-sqlite-wasm` runs SQLite in the browser by wrapping `@effect/wa-sqlite` — SQLite compiled to WebAssembly — behind the standard `@effect/sql` `SqlClient` interface. Two storage backends exist: in-memory `MemoryVFS` for ephemeral data and OPFS-backed `AccessHandlePoolVFS` for durable persistence (`src/SqliteClient.ts:11-12`, `src/OpfsWorker.ts:8`). The durable path requires a `Worker` or `SharedWorker` because `FileSystemSyncAccessHandle` is only available off the main thread, so the package ships both a main-thread client and a worker-side runtime as separate public modules.

## Public API surface

All three modules are re-exported from `repos/effect/packages/sql-sqlite-wasm/src/index.ts:1-14`.

- **`SqliteClient`** (`src/SqliteClient.ts:46-54`) — extends `SqlClient.SqlClient` with `export: Effect<Uint8Array, SqlError>`, `import`, and `updateValues: never`. Provides `layerMemory`, `layerMemoryConfig`, `layer` (worker-backed), and `layerConfig` (`src/SqliteClient.ts:452-510`). Also exports `currentTransferables` (`FiberRef`) and `withTransferables` for zero-copy transfer across the worker boundary (`src/SqliteClient.ts:435-446`).
- **`OpfsWorker`** (`src/OpfsWorker.ts:1-101`) — worker-side runtime. `run(config)` inits the WASM module, registers `AccessHandlePoolVFS`, opens the DB, then enters an `Effect.async` message loop over a `MessagePort`.
- **`SqliteMigrator`** (`src/SqliteMigrator.ts:19-33`) — re-exports `@effect/sql/Migrator` with pre-bound `run` and `layer`.

## Patterns used

- [Effect.acquireRelease / acquireUseRelease](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `sqlite3.open_v2` is wrapped in `acquireRelease` with `sqlite3.close` as finalizer, in both the memory path (`src/SqliteClient.ts:126-132`) and the OPFS worker (`src/OpfsWorker.ts:33-39`).
- [Deferred — one-shot async value](../02-patterns-catalog.md#deferred--one-shot-async-value) — worker-ready gate: main thread awaits `readyDeferred`; worker calls `Deferred.unsafeDone` after posting `["ready"]` (`src/SqliteClient.ts:280-325`).
- [Semaphore — async resource limiting](../02-patterns-catalog.md#semaphore--async-resource-limiting) — single-permit semaphore serializes queries to uphold SQLite's single-writer constraint (`src/SqliteClient.ts:223-238`, `src/SqliteClient.ts:384-397`).
- [ScopedRef — scope-attached mutable reference](../02-patterns-catalog.md#scopedref--scope-attached-mutable-reference) — worker connection held in `ScopedRef.fromAcquire(makeConnection)`; `worker.onerror` calls `ScopedRef.set` to restart transparently (`src/SqliteClient.ts:382`, `src/SqliteClient.ts:310-312`).
- [FiberRef — fiber-local state](../02-patterns-catalog.md#fiberref--fiber-local-state) — `currentTransferables` carries `Transferable[]` for the next postMessage, read via `fiber.getFiberRef` at send time (`src/SqliteClient.ts:435-438`, `src/SqliteClient.ts:342-344`).
- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — all four layer helpers use `Layer.scopedContext` publishing both tags, piped through `Layer.provide(Reactivity.layer)` (`src/SqliteClient.ts:452-510`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `SqliteClient` tag is `Context.GenericTag` (`src/SqliteClient.ts:60`), consistent with every `@effect/sql-*` driver.
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — all failure sites produce `new SqlError({ cause, message })` (`src/SqliteClient.ts:129`, `src/SqliteClient.ts:169`, `src/OpfsWorker.ts:36`).

## What's unique about this package's design

Unlike the Node.js SQLite drivers where queries run synchronously in-process, every query through the worker-backed path becomes `Effect.async`: the main-thread client posts a message, stores a fiber resume in `Map<number, callback>` keyed by an incrementing ID, and the worker's reply calls `pending.get(id)(exit)` (`src/SqliteClient.ts:275`, `src/SqliteClient.ts:331-335`). The typed `OpfsWorkerMessage` tuple-union (`src/internal/opfsWorker.ts:1-7`) keeps the protocol exhaustive without leaking internal types.

The WASM binary is initialized once via two module-level `Effect.cached` effects (`src/SqliteClient.ts:90-97`). `currentTransferables` and `withTransferables` allow callers to zero-copy `import` payloads across the worker boundary (`src/SqliteClient.ts:435-446`).

## Conventions observed

- **Ambient type shim**: `src/sqlite-wasm.d.ts:1-17` adds typed constructors to `@effect/wa-sqlite`'s untyped VFS classes via module augmentation — no separate `@types/` package needed; unique to this driver.
- **`updateValues: never`** (`src/SqliteClient.ts:53`): marks the unsupported bulk-returning mode at the type level.
- **`executeStream` stubbed as defect** in the worker path (`src/SqliteClient.ts:366-368`): streaming is in-memory only; the worker aborts loudly rather than silently returning wrong results.

## "If you were authoring something similar, copy this"

- **`Deferred` as ready-gate** (`src/SqliteClient.ts:280-325`): post `["ready"]` from the worker after full init, block the constructor on `Deferred.await` — the layer resolves only when the worker is queryable.
- **Incrementing-ID callback map** (`src/SqliteClient.ts:275`, `src/SqliteClient.ts:331-335`): `Map<number, ExitCallback>` in closure routes any postMessage protocol back to the right fiber resume.
- **`Effect.cached` for WASM init** (`src/SqliteClient.ts:90-97`): guarantees the binary is compiled once regardless of layer rebuild count.
- **Typed tuple-union worker protocol** (`src/internal/opfsWorker.ts:1-7`): position-0 tag discriminant keeps `OpfsWorker.run`'s switch exhaustive and the wire format internal.

## Open questions

1. **IndexedDB backend**: `src/sqlite-wasm.d.ts:4-7` declares `IDBBatchAtomicVFS` but no public layer exposes it — planned feature or removed?
2. **Pending-map leak on worker crash**: in-flight queries in `pending` when `worker.onerror` fires will never resolve; there is no drain/fail step before `ScopedRef.set` restarts the connection (`src/SqliteClient.ts:310-312`).
3. **`SharedWorker` multi-tab safety**: `SqliteClientConfig.worker` accepts `SharedWorker` (`src/SqliteClient.ts:78`) but SQLite's single-writer model makes multi-tab OPFS sharing non-trivial — is concurrent access explicitly supported?
4. **No real tests**: `test/Client.test.ts:5` is a single no-op; the WASM/OPFS environment cannot run in Node.js Vitest without a custom setup that has not been added.

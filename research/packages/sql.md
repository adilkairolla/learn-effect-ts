# @effect/sql

> Source: `repos/effect/packages/sql/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/platform`, `@effect/experimental` (all peer dependencies; one runtime dependency: `uuid`)

## What it does

`@effect/sql` is the database-agnostic SQL layer for the Effect ecosystem. It exposes a `SqlClient` service that driver packages (such as `@effect/sql-pg` or `@effect/sql-sqlite-node`) implement, so application code is written once against the abstract interface and swapped at the `Layer` boundary. Without this package every driver would reinvent query building, schema validation, transaction management, migration tracking, and batching — and none of it would compose with the rest of the Effect ecosystem. As noted in `research/01-package-inventory.md`, the headline novelty is `SqlResolver`: parameterized request batching that eliminates the N+1 query problem without any manual DataLoader wiring.

## Public API surface

All modules are re-exported from `repos/effect/packages/sql/src/index.ts:1-60`.

- **`SqlClient`** (`src/SqlClient.ts:34-72`) — the core service interface. Extends `Constructor` (the template-literal DSL type) and adds `withTransaction`, `reserve`, `reactive`, and `reactiveMailbox`. Drivers provide this via a `Layer`.
- **`SqlConnection`** (`src/SqlConnection.ts:14-46`) — the raw wire-level abstraction a driver must implement: `execute`, `executeRaw`, `executeStream`, `executeValues`, `executeUnprepared`.
- **`Statement`** (`src/Statement.ts:46-57`, `src/Statement.ts:268-356`) — the `Statement<A>` type (simultaneously a `Fragment` and an `Effect`) and the `Constructor` interface that defines the tagged-template DSL plus helpers: `sql.insert`, `sql.update`, `sql.in`, `sql.and`, `sql.or`, `sql.csv`, `sql.identifier`, `sql.unsafe`, `sql.onDialect`.
- **`SqlResolver`** (`src/SqlResolver.ts:98-111`) — the N+1 solver. Provides four combinators — `ordered`, `grouped`, `findById`, `void` — each wrapping `RequestResolver.makeBatched` to accumulate per-fiber requests into a single batched query.
- **`SqlSchema`** (`src/SqlSchema.ts:16-80`) — thin schema-validated query helpers: `findAll`, `findOne`, `single`, `void`. Each takes a `Request` schema and a `Result` schema and produces a typed function from input to `Effect<A, E | ParseError, R>`.
- **`Model`** (`src/Model.ts:19-32`, `src/Model.ts:684-838`) — a high-level domain model layer built on `@effect/experimental/VariantSchema`. `Model.Class` produces a class with six variants (`select`, `insert`, `update`, `json`, `jsonCreate`, `jsonUpdate`). `Model.makeRepository` and `Model.makeDataLoaders` derive full CRUD operations from a model definition and a table name.
- **`Migrator`** (`src/Migrator.ts:17-67`) — a driver-independent migration runner. Accepts a `Loader<R>` that resolves an ordered list of `ResolvedMigration` tuples and applies unapplied ones in a transaction. Driver packages each export their own loader (e.g., file-system or bundled).
- **`SqlStream`** (`src/SqlStream.ts:15-78`) — a back-pressure-aware streaming helper (`asyncPauseResume`) used internally by drivers to bridge push-based result cursors into `Stream<A, SqlError>`.
- **`SqlEventJournal`** / **`SqlPersistedQueue`** (`src/SqlEventJournal.ts`, `src/SqlPersistedQueue.ts`) — higher-level durability primitives: an append-only event journal and a persistent queue built on top of `SqlClient`, used by `@effect/experimental` and `@effect/workflow`.
- **`SqlError`** (`src/SqlError.ts:19-34`) — two tagged errors: `SqlError` (driver-level failure) and `ResultLengthMismatch` (ordered resolver contract violation).

## Patterns used

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — every driver publishes its concrete `SqlClient` implementation as a `Layer.scoped` (connection pool acquired on layer build, released on layer close); the abstract `SqlClient` tag is consumed by application code.
- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — used pervasively in `Model.makeRepository` and `Model.makeDataLoaders` (`src/Model.ts:715-838`) to sequence service acquisition, schema building, and resolver construction.
- [Schema.Struct](../02-patterns-catalog.md#schemastruct) and [Schema.transform / transformOrFail](../02-patterns-catalog.md#schematransform--transformorfail) — `SqlSchema` wraps every query in `Schema.encode` / `Schema.decodeUnknown`; `Model` fields like `DateTimeFromDate` (`src/Model.ts:324-331`) use `Schema.transform` to bridge JS `Date` ↔ `DateTime.Utc`.
- [Request.of / RequestResolver.make / Effect.request — request batching](../02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching) — `SqlResolver` is the primary consumer of this pattern; `SqlRequest` implements `Request.Request`, and all four resolver variants call `RequestResolver.makeBatched` (`src/SqlResolver.ts:221-256`, `src/SqlResolver.ts:291-337`).
- [Data.TaggedError](../02-patterns-catalog.md#datataggederror) — `SqlError` (`src/SqlError.ts:19-22`) and `MigrationError` (`src/Migrator.ts:57-67`) are both typed tagged errors, enabling `Effect.catchTag` recovery at call sites.
- [Stream.make / fromIterable / fromEffect](../02-patterns-catalog.md#streammake--fromiterable--fromeffect) — `Statement<A>` exposes a `.stream` property; `SqlStream.asyncPauseResume` converts driver cursor push events into an Effect `Stream` (`src/SqlStream.ts:15-78`).
- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `SqlClient.SqlClient` is a `Context.GenericTag` (`src/internal/client.ts:23`); `SafeIntegers` is a `Context.Reference` with a default value (`src/SqlClient.ts:146-148`).

## What's unique about this package's design

The tagged-template `sql` DSL (`src/Statement.ts:268-356`) is the most immediately distinctive feature: any value interpolated into a template literal is automatically treated as a bound parameter (`Parameter` segment), never as raw SQL. Identifiers require explicit `sql("tableName")` calls (producing an `Identifier` segment), making SQL injection structurally impossible through normal use. The `Segment` union (`src/Statement.ts:127-136`) encodes this at the type level, and driver `Compiler` implementations (`src/Statement.ts:413-455`) translate it to dialect-specific placeholder syntax (`$1`, `?`, `@p1`).

The second unique feature is `SqlResolver`. Unlike popular TS SQL libraries (Prisma, Drizzle, Kysely) which have no built-in N+1 mitigation, `SqlResolver` wraps Effect's `Request`/`RequestResolver` machinery to accumulate all `execute(id)` calls that occur in the same Effect fork-batch into a single SQL `IN (...)` query. `SqlResolver.findById` (`src/SqlResolver.ts:345-416`) additionally maintains a `MutableHashMap` by ID so results are routed back to each individual requesting fiber even when the DB returns them in arbitrary order — zero manual DataLoader wiring required.

The third distinctive design is `Model.Class` (`src/Model.ts:19-32`): a single class declaration simultaneously produces six schema variants (`select`, `insert`, `update`, `json`, `jsonCreate`, `jsonUpdate`), with column-level field modifiers (`Generated`, `Sensitive`, `DateTimeInsertFromDate`, `JsonFromString`, `UuidV4Insert`) controlling which variants include each field. This means insert schemas never expose auto-generated columns and JSON APIs never expose `Sensitive` columns, enforced at parse time.

## Conventions observed

- **Module namespace re-exports**: every module is `export * as ModuleName from "./Module.js"` in `index.ts` — callers write `import { SqlClient, SqlResolver } from "@effect/sql"` and access members as `SqlClient.make`, `SqlResolver.ordered`.
- **`internal/` isolation**: `src/internal/client.ts` holds all mutable implementation details; the public `SqlClient.ts` imports only types and the opaque `internal.make` / `internal.clientTag` — matching the conventions in `research/03-conventions.md`.
- **Error tagging via `@effect/platform`**: `SqlError` extends `TypeIdError` from `@effect/platform/Error` (`src/SqlError.ts:4, 19`) rather than `Data.TaggedError` directly, inheriting platform error conventions.
- **`@since 1.0.0` + `@category` JSDoc on every export**: all public exports carry `@since` and `@category` annotations, consistent with the monorepo standard.
- **Dialect-aware helpers**: `Statement.Constructor` exposes `onDialect` and `onDialectOrElse` (`src/Statement.ts:340-356`) so application code and `Model.makeRepository` can emit dialect-specific SQL without leaving the typed DSL.
- **Reserved word collision workaround**: `SqlResolver.void` is defined as `void_` internally and re-exported as `void` via the named export map (`src/SqlResolver.ts:465-473`), a pattern repeated for `SqlSchema.void`.

## "If you were authoring something similar, copy this"

- **Provide the abstract service as a `Context.GenericTag` resolved by a `Layer`** (`src/internal/client.ts:23`). Driver packages call `SqlClient.make(options)` and wrap the result in `Layer.scoped(SqlClient.SqlClient, ...)` — application code never imports a driver directly, only the abstract tag. This is the canonical Effect service-interface pattern applied to databases.
- **Use `Statement<A>` as both `Fragment` and `Effect<ReadonlyArray<A>>`** (`src/Statement.ts:47-57`). The dual nature means a statement can be composed as a fragment (interpolated into a larger template) or awaited directly, with no impedance mismatch between building and executing.
- **Build the `Compiler` interface with a `makeCompiler` factory** (`src/Statement.ts:426-455`). The factory takes dialect-specific callbacks (`placeholder`, `onIdentifier`, `onCustom`, `onInsert`, `onRecordUpdate`) and handles all segment-walking logic. Adding a new driver means implementing these five callbacks, not rewriting the entire compiler.
- **Use `Model.Class` with `VariantSchema` for any schema with multi-context shape** (`src/Model.ts:19-32`). One class, six schemas, zero duplication. The `Generated` / `Sensitive` / `DateTimeInsertFromDate` field modifiers are immediately worth copying for any domain that has DB columns that differ from HTTP API shapes.
- **Wire `SqlResolver` for any repeated single-entity lookup** (`src/Model.ts:923-943`). `makeDataLoaders` shows the complete pattern: create a `findById` resolver with `SqlResolver.findById`, wrap it in a `dataLoader` window, and return a typed `findById: (id) => Effect<Option<T>>` — the batching is fully transparent to callers.
- **Tag migration errors with `reason` discriminants** (`src/Migrator.ts:60-67`). `MigrationError` carries a `reason` union (`"bad-state" | "import-error" | "failed" | "duplicates" | "locked"`) so callers can `catchTag` on `MigrationError` and then switch on `reason` for fine-grained recovery — a refinement of the basic tagged-error pattern.

## Open questions

1. **`Reactivity` requirement**: `SqlClient.make` requires `Reactivity` from `@effect/experimental` in its `R` channel (`src/SqlClient.ts:111`, `src/internal/client.ts:44`). Drivers must provide this. It is unclear whether an application that does not use `reactive` / `reactiveMailbox` still pays the cost of the `Reactivity` service, or whether it is lazily initialized only when those methods are called.
2. **`SafeIntegers` `Context.Reference`**: The `SafeIntegers` reference (`src/SqlClient.ts:146-148`) provides a fiber-local flag for safe integer parsing. It is not documented how drivers are expected to read this — no usage of `yield* SafeIntegers` appears in the abstract layer source; presumably each driver reads it in its own `execute` implementation.
3. **`SqlEventJournal` and `@effect/workflow` contract**: `SqlEventJournal` (`src/SqlEventJournal.ts`) appears to back `@effect/experimental/EventJournal`. The exact table schema and versioning contract between the journal and workflow persistence layers is not documented in the source and would need cross-referencing with `@effect/workflow`'s migration files.
4. **`asyncPauseResume` back-pressure semantics**: `SqlStream.asyncPauseResume` (`src/SqlStream.ts:15-78`) calls `onPause` when the internal queue is full and `onResume` after a dequeue. Whether drivers are expected to propagate this to the underlying cursor (e.g., pausing a `pg` result stream) or merely buffer is left to the driver author.
5. **`Statement.Transformer` and `FiberRef`**: `currentTransformer` is a `FiberRef` (`src/Statement.ts:80`) that allows intercepting every compiled statement. Its interaction with `withTransaction` (which changes the connection context) is not documented — it is unclear whether a transformer applied inside a transaction sees the transaction connection or a fresh one.

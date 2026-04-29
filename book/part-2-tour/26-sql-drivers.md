# Chapter 26 — SQL part 2 — drivers: writing one (`sql-pg` as canonical, with notes on 10 other drivers)

> **Package(s):** `@effect/sql-pg` (canonical), `@effect/sql-mysql2`, `@effect/sql-mssql`, `@effect/sql-sqlite-node`, `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-wasm`, `@effect/sql-sqlite-do`, `@effect/sql-sqlite-react-native`, `@effect/sql-clickhouse`, `@effect/sql-libsql`, `@effect/sql-d1`
> **Patterns introduced:** [`Cache.make` / `ScopedCache.make` — effect-based memoization](../../research/02-patterns-catalog.md#cachemake--scopedcachemake--effect-based-memoization)
> **Reads from:** Chapter 25 (SQL part 1 — the `@effect/sql` abstraction layer), Chapter 09 (Layer — building, merging, and providing services), Chapter 23 (Platform on Node.js — HTTP server, file system, and subprocess)
> **Reads into:** Chapter 27 (SQL part 3 — query builders: Drizzle and Kysely integrations)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 25 established that application code should depend only on `SqlClient.SqlClient`, the abstract tag from `@effect/sql`. That abstraction collapses every SQL operation — parameterized queries, transactions, streaming cursors, schema migrations — into a single typed service. But the abstraction only works if something wires it to a real database at the program's `Layer` boundary.

Every JavaScript database library has its own idiosyncratic connection-management API, and without the Effect SQL drivers you end up writing that wiring yourself for every project:

```ts
// Raw pg — every concern handled manually
import { Pool } from "pg"

const pool = new Pool({
  host: process.env.DB_HOST,
  user: process.env.DB_USER,
  password: process.env.DB_PASS,
  database: process.env.DB_NAME,
  max: 10
})

// No typed error channel — everything throws
async function findUser(id: number) {
  const client = await pool.connect() // must remember to release
  try {
    const { rows } = await client.query("SELECT * FROM users WHERE id = $1", [id])
    return rows[0]
  } finally {
    client.release() // easy to forget on early return
  }
}

// No graceful shutdown — pool stays open on SIGTERM
// No fiber cancellation — query runs to completion even if response already sent
// No prepared-statement caching — pg manages internally but with no visibility
// No typed error — catch block receives `unknown`
```

The problems multiply when you target multiple databases. A microservice that uses Postgres in production and SQLite for integration tests has no shared abstraction — calling code is littered with `if (env === "test")` branches around incompatible driver calls. Switching from `mysql2` to `@clickhouse/client` or adding a React Native SQLite path means rewriting query logic. Error handling strategies diverge. Prepared-statement caching is reinvented on every project.

The eleven `@effect/sql-*` drivers in this chapter each solve the same structural problem: map a specific database library's API to the abstract `SqlClient.SqlClient` tag so all of this — connection pooling, fiber-cancellation, typed errors, transaction semantics, prepared-statement caching — is handled once in the driver and never touched again in application code.

---

## The minimal example

```ts
import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { Effect, Layer } from "effect"

// PgClient.layer accepts a plain config object.
// It registers both PgClient (Postgres-specific) and SqlClient.SqlClient (abstract) tags.
const DbLive = PgClient.layer({
  host: "localhost",
  port: 5432,
  database: "myapp",
  username: "postgres",
  password: undefined
})

// Application code depends only on the abstract SqlClient tag from Chapter 25.
const findUserById = (id: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql`SELECT id, email FROM users WHERE id = ${id}`
    return rows[0] as { id: number; email: string } | undefined
  })

// Provide the Postgres layer at the entry point only.
const program = findUserById(1).pipe(
  Effect.provide(DbLive)
)

Effect.runPromise(program).then(console.log)
```

Swap `PgClient.layer` for any other driver's `layer` call, and `findUserById` — and every other function in the codebase that yields `SqlClient.SqlClient` — works unchanged.

---

## Tour

### `@effect/sql-pg` deep-dive

`@effect/sql-pg` is the PostgreSQL driver and the canonical reference for writing an Effect SQL driver. It wraps `pg` (the `node-postgres` library), `pg-pool`, and `pg-cursor` inside Effect's resource and concurrency model. Source: `repos/effect/packages/sql-pg/src/PgClient.ts`.

**The `PgClient` interface.** The concrete service type (`repos/effect/packages/sql-pg/src/PgClient.ts:48-58`) extends `SqlClient.SqlClient` and adds three Postgres-specific capabilities:

- `json(_: unknown): Fragment` — wraps a value as a `jsonb` parameter binding, so `sql\`INSERT INTO ... VALUES (${sql.json(payload)})\`` stores a structured JSON document.
- `listen(channel: string): Stream<string, SqlError>` — returns a live stream of PostgreSQL `LISTEN`/`NOTIFY` payloads, backed by a dedicated `pg.Client` kept in an `RcRef`.
- `notify(channel, payload): Effect<void, SqlError>` — sends a `NOTIFY` message, usable for lightweight fan-out across connections.

**Layer constructors.** Three layer entry points are exported (`repos/effect/packages/sql-pg/src/PgClient.ts:553-597`):

- `PgClient.layer(config)` — takes a plain `PgClientConfig` object. This is the most common entry point.
- `PgClient.layerConfig(config)` — takes `Config.Config.Wrap<PgClientConfig>`, enabling `Config.string("DB_HOST")` style environment-variable loading (Chapter 38).
- `PgClient.layerFromPool(options)` — accepts an externally-owned `pg.Pool` via an `acquire` Effect, for when you already control the pool lifecycle.

All three register **both** `PgClient` and `SqlClient.SqlClient` in the output context (`repos/effect/packages/sql-pg/src/PgClient.ts:562-568`). Application code depending on the abstract tag gets served automatically; Postgres-specific utilities like `PgMigrator` resolve `PgClient` to access `config.host`, `config.password`, and `config.database` for running `pg_dump`.

**Connection pool.** `PgClient.layer` passes your config to `new Pg.Pool(...)` from `node-postgres`. The pool's default `max` is 10 connections (the `pg` library default) when `maxConnections` is not set (`repos/effect/packages/sql-pg/src/PgClient.ts:395-425`). You can tune `maxConnections`, `minConnections`, `idleTimeout`, `connectTimeout`, and `connectionTTL` through `PgClientConfig`. On layer startup the driver issues `SELECT 1` through the pool and wraps it with `Effect.timeoutFail` (default 5 seconds) to surface bad connection strings as a typed `SqlError` before the first real query (`repos/effect/packages/sql-pg/src/PgClient.ts:430-449`).

**Error types.** All failures surface as `SqlError` via `Data.TaggedError` (Chapter 06), wrapping the raw `pg` error as `cause`. There is no separate "connection error" vs "query error" subtype — both arrive as `SqlError` and can be caught with `Effect.catchTag("SqlError", ...)`.

**Query cancellation.** When a fiber running a Postgres query is interrupted, the driver calls `SELECT pg_cancel_backend(processID)` on the server to abort the backend query immediately. The cancellation Effect is built once per pool client in a `WeakMap` (`repos/effect/packages/sql-pg/src/PgClient.ts:531-551`), so there is no overhead for non-interrupted queries.

**Cursor streaming.** `executeStream` pages results through a `pg-cursor` with a batch size of 128 rows, using `Stream.repeatEffectChunkOption` (`repos/effect/packages/sql-pg/src/PgClient.ts:245-272`). This keeps large result sets out of memory without loading the full result.

**`PgMigrator`.** The `repos/effect/packages/sql-pg/src/PgMigrator.ts` module re-exports `@effect/sql/Migrator` and adds a `run`/`layer` pair that calls `pg_dump` via `@effect/platform/Command` after each migration run (`repos/effect/packages/sql-pg/src/PgMigrator.ts:31-105`). The dump captures a schema snapshot alongside the migration history records.

---

### The Cache pattern: prepared-statement caching

Several `@effect/sql-*` drivers — `sql-sqlite-node`, `sql-d1`, and others — cache prepared statements using `Cache.make` from `effect`. This is the chapter's introduced pattern.

`Cache.make` constructs an Effect-based memoizing cache with a bounded capacity and a TTL-based eviction policy (`repos/effect/packages/effect/src/Cache.ts:195-208`):

```ts
export const make: <Key, Value, Error = never, Environment = never>(
  options: {
    readonly capacity: number
    readonly timeToLive: Duration.DurationInput
    readonly lookup: Lookup<Key, Value, Error, Environment>
  }
) => Effect.Effect<Cache<Key, Value, Error>, never, Environment>
```

The lookup function is an Effect. When two fibers concurrently request the same key, only one lookup fires — the other waits and receives the same result. Failed lookups are not cached. This is the critical advantage over a hand-rolled `Map<string, Promise<Statement>>`: concurrent deduplication, TTL eviction, capacity limits, and correct error handling all come for free.

`ScopedCache.make` (`repos/effect/packages/effect/src/ScopedCache.ts:112-125`) is the scoped variant: each cached value is itself a resource with an `acquireRelease` lifecycle. Use it when cached values must be released (e.g., per-tenant connection objects).

Here is how `@effect/sql-sqlite-node` uses `Cache.make` for prepared statements (`repos/effect/packages/sql-sqlite-node/src/SqliteClient.ts:112-120`):

```ts
import { Cache, Duration, Effect } from "effect"
import { SqlError } from "@effect/sql/SqlError"
import type * as Sqlite from "better-sqlite3"

// Inside the SqliteClient.make factory:
const prepareCache = yield* Cache.make({
  capacity: options.prepareCacheSize ?? 200,
  timeToLive: options.prepareCacheTTL ?? Duration.minutes(10),
  lookup: (sql: string) =>
    Effect.try({
      try: () => db.prepare(sql),
      catch: (cause) => new SqlError({ cause, message: "Failed to prepare statement" })
    })
})
// Later, every query uses: yield* prepareCache.get(sqlString)
```

The `capacity` and `timeToLive` defaults (200 statements, 10 minutes) are surfaced in `SqliteClientConfig` so callers can tune them. `@effect/sql-d1` applies the same pattern for Cloudflare D1 prepared statements (`repos/effect/packages/sql-d1/src/D1Client.ts:82-90`), where preparation cost would otherwise be paid on every cold-isolate request.

---

### Other drivers

The remaining ten drivers follow the same structural convention — `make`, `layer`, `layerConfig`, dual-tag registration, `Reactivity.layer` baked in — but each addresses a distinct runtime environment or database engine.

#### Server SQL drivers

**`@effect/sql-mysql2`** wraps the `mysql2` connection pool for MySQL databases. Unlike Postgres, MySQL's binary prepared-statement protocol and text query protocol are separate, so the driver exposes both `execute` (prepared) and `executeUnprepared` (text, required for DDL) paths. `supportBigNumbers: true` is hardcoded in the pool config to prevent silent truncation of `BIGINT` values beyond `Number.MAX_SAFE_INTEGER`. Streaming uses a microtask-batch buffer to coalesce synchronous `data` events into array chunks before emitting them to the Effect stream (`repos/effect/packages/sql-mysql2/src/MysqlClient.ts:48-301`). `MysqlMigrator` shells out to `mysqldump` for schema snapshots.

**`@effect/sql-mssql`** targets Microsoft SQL Server via the `tedious` TDS driver. It is the only driver in the monorepo that exposes typed stored-procedure calls: a `Procedure` builder (`repos/effect/packages/sql-mssql/src/Procedure.ts:25-81`) chains `make → param → outputParam → withRows → compile` to accumulate type parameters by intersection, yielding a `call` result typed with separate `output` and `rows` fields. The T-SQL compiler uses `@N` named placeholders, bracket-escaped identifiers (`[dbo].[people]`), and emits `OUTPUT INSERTED.*` instead of `RETURNING`. Note that `executeStream` is deliberately unimplemented — `tedious` requires all rows to be buffered before returning (`repos/effect/packages/sql-mssql/src/MssqlClient.ts:285-287`).

**`@effect/sql-clickhouse`** is the only driver in the monorepo that requires `@effect/platform-node` as a peer dependency, because ClickHouse speaks HTTP rather than a wire protocol and result rows arrive as a Node.js `Readable` stream body. `NodeStream.fromReadable` bridges that into an Effect `Stream`. The driver also registers `AbortController` for every query and, on fiber interruption, aborts the client-side request *and* issues `KILL QUERY WHERE query_id = '...'` to cancel the server-side operation (`repos/effect/packages/sql-clickhouse/src/ClickhouseClient.ts:40-116`). There is no connection pool — ClickHouse's stateless HTTP model makes pooling unnecessary.

#### Local SQLite: server-side drivers

**`@effect/sql-sqlite-node`** is the canonical server-side SQLite driver, backed by `better-sqlite3`. The central design challenge is bridging `better-sqlite3`'s fully synchronous API into Effect's async fiber runtime: a single-permit `Semaphore` acts as a mutex, ensuring one fiber holds the connection at a time. Prepared statements are cached with `Cache.make` (capacity 200, TTL 10 minutes, configurable). WAL mode is enabled by default and can be suppressed with `disableWAL: true`. The driver also exposes `export` (serialize to `Uint8Array`) and `backup` (`repos/effect/packages/sql-sqlite-node/src/SqliteClient.ts:34-47`).

**`@effect/sql-sqlite-bun`** targets Bun's built-in `bun:sqlite` module — no native build step, no `node_modules/better-sqlite3`. The key difference from `sql-sqlite-node` is the absence of a prepared-statement cache: `bun:sqlite` handles statement caching internally, so the driver calls `db.query(sql)` fresh on each execution (`repos/effect/packages/sql-sqlite-bun/src/SqliteClient.ts:101-115`). The same single-permit semaphore pattern applies. WAL mode is on by default.

**Why are there two server-side SQLite drivers?** `@effect/sql-sqlite-node` requires `better-sqlite3`, a native C++ addon that must be compiled for the target Node.js version and architecture — no compile step on Bun, which provides its own SQLite runtime as a first-class built-in. `@effect/sql-sqlite-bun` omits `better-sqlite3` entirely, keeping Bun deployments free of native build tooling. Both drivers expose the same `SqliteClient` tag and the same `SqlClient.SqlClient` abstract interface, so migration tests and business logic remain identical across runtimes.

#### Browser and Edge SQLite

**`@effect/sql-sqlite-wasm`** runs SQLite in the browser by wrapping `@effect/wa-sqlite` (SQLite compiled to WebAssembly) behind the standard `SqlClient` interface. Two storage backends are provided: `layerMemory` / `layerMemoryConfig` for in-memory ephemeral data, and `layer` / `layerConfig` for durable OPFS-backed storage. The durable path requires a `Worker` or `SharedWorker` because `FileSystemSyncAccessHandle` is only available off the main thread — the package ships both a main-thread client and a worker-side runtime (`OpfsWorker.run`) as separate public modules. Every query through the worker path becomes an `Effect.async` round-trip over `postMessage`, with a `Map<number, ExitCallback>` keyed by an incrementing ID to route responses back to the waiting fiber (`repos/effect/packages/sql-sqlite-wasm/src/SqliteClient.ts:42-510`). A `Deferred` gate ensures the layer resolves only after the worker signals it is ready.

#### Cloudflare runtime drivers

**`@effect/sql-d1`** targets Cloudflare D1, the managed SQLite-compatible edge database inside Cloudflare Workers. The defining constraint is that there are no persistent connections: the `D1Database` binding is injected per request via the Worker `env` argument and passed directly as `D1ClientConfig.db` — no DSN, no pool. The driver compensates with an in-memory `Cache.make` (200 entries, 10-minute TTL) to amortize preparation cost across requests hitting the same warm isolate (`repos/effect/packages/sql-d1/src/D1Client.ts:34-216`). Transactions and streaming are disabled via `Effect.dieMessage`, reflecting D1's HTTP-based single-statement API.

**`@effect/sql-sqlite-do`** bridges `@effect/sql` to the SQLite storage embedded in Cloudflare Durable Objects. Every Durable Object instance gets a `SqlStorage` handle (`this.ctx.storage.sql`) that holds its own embedded SQLite database — no external process, no network round-trip. The `SqliteClientConfig.db` field accepts this handle directly (`repos/effect/packages/sql-sqlite-do/src/SqliteClient.ts:52-62`). The driver includes a row iterator that converts `SqlStorage`'s raw row arrays into column-keyed objects and coerces `ArrayBuffer` blob values to `Uint8Array`. Durable Objects enforce single-threaded execution per instance, so the 1-permit semaphore is a no-op in practice, but it keeps transaction semantics structurally identical to every other `@effect/sql` driver.

**Why two Cloudflare drivers?** `@effect/sql-d1` integrates with the D1 managed service — a fully external database accessible from any Worker. `@effect/sql-sqlite-do` integrates with the SQLite database *embedded inside each Durable Object instance* — a fundamentally different model where the database is actor-local and single-tenant by design. The use cases are orthogonal: D1 for shared relational data, Durable Object SQLite for per-object mutable state with strong consistency guarantees.

#### Mobile SQLite

**`@effect/sql-sqlite-react-native`** wires `@effect/sql` to React Native via the `@op-engineering/op-sqlite` JSI binding. Its standout feature is a `FiberRef`-gated dual execution path: `db.execute` (synchronous JSI, blocks the JS thread) and `db.executeAsync` (async, yields it). A single `run` helper reads the `asyncQuery` fiber-local value and branches accordingly; callers opt into async mode per-effect with `withAsyncQuery` (`repos/effect/packages/sql-sqlite-react-native/src/SqliteClient.ts:65-127`). The config exposes `location` (iOS document or Android app-data directory prefix) and `encryptionKey` (at-rest encryption) as optional fields. No other driver in the monorepo exposes a fiber-local execution-mode toggle.

#### Distributed SQLite

**`@effect/sql-libsql`** is the Effect driver for libSQL, Turso's fork of SQLite that speaks both a local file protocol and a remote HTTP/WebSocket protocol. The most interesting design point is its dual-mode config union: `LibsqlClientConfig.Full` accepts a URL string dispatched to the correct transport (`file:`, `http://`, `wss://`, `libsql://`) while `LibsqlClientConfig.Live` accepts a pre-built `@libsql/client` instance for test injection (`repos/effect/packages/sql-libsql/src/LibsqlClient.ts:57-248`). Authentication and encryption tokens are typed as `Redacted.Redacted`, unwrapped only at the moment the SDK is constructed, keeping secrets out of spans and logs. This means a single layer swap moves an application from a local `.db` file in development to a Turso edge database in production.

---

## A production example

```ts
import { SqlClient, SqlSchema } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import { SqliteClient } from "@effect/sql-sqlite-node"
import { LibsqlClient } from "@effect/sql-libsql"
import { Config, Effect, Layer, Schema } from "effect"

// ---------------------------------------------------------------------------
// Domain types (Chapter 14 — Schema)
// ---------------------------------------------------------------------------
class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  email: Schema.String,
  tenantId: Schema.String
}) {}

// ---------------------------------------------------------------------------
// Data-access layer — depends only on the abstract SqlClient tag
// ---------------------------------------------------------------------------
const findUser = (id: number) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const query = SqlSchema.findOne({
      Request: Schema.Number,
      Result: User,
      execute: (id) => sql`SELECT id, email, tenant_id FROM users WHERE id = ${id}`
    })
    return yield* query(id)
  })

const upsertUser = (user: typeof User.Encoded) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`
      INSERT INTO users (id, email, tenant_id)
      VALUES (${user.id}, ${user.email}, ${user.tenantId})
      ON CONFLICT (id) DO UPDATE SET email = EXCLUDED.email
    `
  })

// ---------------------------------------------------------------------------
// Layer definitions — only one is active at runtime; all satisfy SqlClient
// ---------------------------------------------------------------------------

// Production: Postgres with env-var config (layerConfig reads from process.env)
const PgLive = PgClient.layerConfig({
  url: Config.redacted("DATABASE_URL"),
  maxConnections: Config.withDefault(Config.integer("DB_MAX_CONNECTIONS"), 20)
})

// Integration tests: local SQLite — same SqlClient interface, zero network
const SqliteTestLive = SqliteClient.layer({
  filename: ":memory:",
  prepareCacheSize: 50
})

// Edge / distributed reads: Turso libsql — same SqlClient interface, global edge
const LibsqlEdgeLive = LibsqlClient.layer({
  url: "libsql://my-app.turso.io",
  authToken: undefined // supply via Config.redacted in real usage
})

// ---------------------------------------------------------------------------
// Program — runs identically against any of the three layers above
// ---------------------------------------------------------------------------
const program = Effect.gen(function* () {
  // Write via Postgres in production
  yield* upsertUser({ id: 1, email: "alice@example.com", tenantId: "acme" })

  // Read via same abstract interface
  const user = yield* findUser(1)
  yield* Effect.log(`Found: ${user?._tag === "Some" ? user.value.email : "not found"}`)
})

// Entry point: swap layer to change backend
const MainLive = PgLive // or SqliteTestLive or LibsqlEdgeLive

Effect.runPromise(program.pipe(Effect.provide(MainLive)))
```

The `SqlSchema.findOne` call in `findUser` returns `Option.Some<User>` or `Option.None`, never `undefined` — the schema decoder from Chapter 14 validates every row. The only line that knows about Postgres is `PgLive`. All query logic, domain types, and error handling are backend-neutral.

---

## Variations

**1. Per-driver Migrator.** Every driver ships a `*Migrator` module that layers schema migration onto the same connection:

```ts
import { PgMigrator } from "@effect/sql-pg"
import { NodeFileSystem } from "@effect/platform-node"

const MigratorLive = PgMigrator.layer({
  loader: PgMigrator.fromFileSystem("./migrations"),
  schemaDirectory: "./schema"
}).pipe(Layer.provide(Layer.merge(DbLive, NodeFileSystem.layer)))
```

After each migration run, `PgMigrator` shells out to `pg_dump` and writes a schema snapshot alongside the migration history (`repos/effect/packages/sql-pg/src/PgMigrator.ts:31-105`).

**2. Pool sizing.** Pass `maxConnections` and `minConnections` to `PgClientConfig` to match your connection limit:

```ts
const DbLive = PgClient.layer({ url: Redacted.make(process.env.DB_URL!), maxConnections: 25, minConnections: 5 })
```

**3. Column name transforms.** All drivers accept `transformResultNames` and `transformQueryNames` for camelCase-to-snake_case mapping:

```ts
import { String } from "effect"
const DbLive = PgClient.layer({ ..., transformResultNames: String.camelToSnake, transformQueryNames: String.snakeToCamel })
```

**4. LISTEN/NOTIFY.** The `PgClient`-specific `listen` method returns a `Stream` of notification payloads:

```ts
import { PgClient } from "@effect/sql-pg"
import { Stream } from "effect"

const notifications = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient
  yield* pg.listen("order_events").pipe(Stream.tap((msg) => Effect.log(msg)), Stream.runDrain)
})
```

**5. React Native async queries.** Opt into the async JSI path per-effect to avoid blocking the JS thread on slow queries:

```ts
import { SqliteClient } from "@effect/sql-sqlite-react-native"

const slowQuery = SqliteClient.withAsyncQuery(
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql`SELECT * FROM large_table`
  })
)
```

**6. libsql embedded replica.** Point `url` at a local file and add `syncUrl` + `syncInterval` to enable Turso's embedded-replica mode — reads from local SQLite, syncs from the remote on an interval:

```ts
const LocalReplicaLive = LibsqlClient.layer({
  url: "file:./local.db",
  syncUrl: "libsql://my-app.turso.io",
  authToken: undefined,
  syncInterval: 60
})
```

---

## Anti-patterns

**1. Importing the concrete driver inside business logic.**

```ts
// Wrong — business logic is now locked to Postgres
import { PgClient } from "@effect/sql-pg"

const findUser = Effect.gen(function* () {
  const pg = yield* PgClient.PgClient   // concrete tag
  return yield* pg`SELECT * FROM users` // pg-specific API
})
```

Depend on the abstract `SqlClient.SqlClient` tag instead. The concrete `PgClient` tag is for Postgres-specific utilities (Migrator, LISTEN/NOTIFY) only:

```ts
// Correct — any driver satisfies this dependency
import { SqlClient } from "@effect/sql"

const findUser = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  return yield* sql`SELECT * FROM users`
})
```

**2. Building the connection layer eagerly inside a request handler.**

```ts
// Wrong — creates a new pool on every request
app.get("/users/:id", async (req, res) => {
  const layer = PgClient.layer({ host: "localhost", ... }) // new pool every time!
  const result = await Effect.runPromise(findUser(req.params.id).pipe(Effect.provide(layer)))
  res.json(result)
})
```

Layers should be constructed once at application startup and reused. Use `Layer.scoped` / `ManagedRuntime.make` (Chapter 11) to build the layer graph once and share the pool across requests:

```ts
// Correct — pool built once, shared across all requests
const runtime = ManagedRuntime.make(PgClient.layer({ host: "localhost", ... }))
app.get("/users/:id", async (req, res) => {
  const result = await runtime.runPromise(findUser(Number(req.params.id)))
  res.json(result)
})
```

**3. Using driver-specific dialect features in shared query helpers.**

```ts
// Wrong — RETURNING clause is Postgres/SQLite only; breaks on MSSQL
const insertUser = (email: string) =>
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    return yield* sql`INSERT INTO users (email) VALUES (${email}) RETURNING id`
  })
```

Confine dialect-specific SQL to driver-specific modules. For cross-driver return-value retrieval, use `@effect/sql`'s `sql.insert({...}).returning("*")` helper which the compiler translates to `RETURNING` on Postgres/SQLite and `OUTPUT INSERTED.*` on MSSQL.

**4. Ignoring `executeStream` limitations on SQLite and D1.**

SQLite drivers (`sql-sqlite-node`, `sql-sqlite-bun`, `sql-sqlite-do`, `sql-sqlite-react-native`) and `sql-d1` call `Effect.dieMessage` when `executeStream` is invoked — this is a programmer error that causes an unrecoverable fiber defect, not a typed `SqlError`. Code that calls `.stream` on a `SqlClient` backed by one of these drivers will crash at runtime with no compile-time warning. Route large result sets through paginated queries or use Postgres/MySQL drivers when streaming is required.

---

## See also

- [Chapter 25 — SQL part 1 — the `@effect/sql` abstraction layer](./25-sql-core.md) — the `SqlClient` tag, `sql` template, `SqlSchema`, `SqlResolver`, and `withTransaction` that these drivers implement.
- [Chapter 09 — Layer: building, merging, and providing services](../part-1-foundations/09-layer.md) — `Layer.scopedContext`, dual-tag registration, and the composition model that all eleven drivers rely on.
- [Chapter 23 — Platform on Node.js — HTTP server, file system, and subprocess](./23-platform-node.md) — `@effect/platform-node` is a peer dependency of `@effect/sql-clickhouse`; `Pool.make` and `KeyedPool` from this chapter are structurally related to connection pool management in server drivers.
- [Chapter 27 — SQL part 3 — query builders: Drizzle and Kysely integrations](./27-sql-query-builders.md) — type-safe query building on top of the `SqlClient` layer established here.
- [`Cache.make` / `ScopedCache.make` — effect-based memoization](../../research/02-patterns-catalog.md#cachemake--scopedcachemake--effect-based-memoization) — the pattern introduced in this chapter; used by `sql-sqlite-node` and `sql-d1` for prepared-statement caching.
- Per-package notes:
  - [`research/packages/sql-pg.md`](../../research/packages/sql-pg.md)
  - [`research/packages/sql-mysql2.md`](../../research/packages/sql-mysql2.md)
  - [`research/packages/sql-mssql.md`](../../research/packages/sql-mssql.md)
  - [`research/packages/sql-sqlite-node.md`](../../research/packages/sql-sqlite-node.md)
  - [`research/packages/sql-sqlite-bun.md`](../../research/packages/sql-sqlite-bun.md)
  - [`research/packages/sql-sqlite-wasm.md`](../../research/packages/sql-sqlite-wasm.md)
  - [`research/packages/sql-sqlite-do.md`](../../research/packages/sql-sqlite-do.md)
  - [`research/packages/sql-sqlite-react-native.md`](../../research/packages/sql-sqlite-react-native.md)
  - [`research/packages/sql-clickhouse.md`](../../research/packages/sql-clickhouse.md)
  - [`research/packages/sql-libsql.md`](../../research/packages/sql-libsql.md)
  - [`research/packages/sql-d1.md`](../../research/packages/sql-d1.md)

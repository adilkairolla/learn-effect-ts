# Chapter 27 — SQL part 3 — query builders: Drizzle and Kysely integrations

> **Package(s):** `@effect/sql-drizzle`, `@effect/sql-kysely`
> **Patterns introduced:** [`Redacted — prevent secret values from leaking to logs/spans`](../../research/02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans)
> **Reads from:** Chapter 25 (SQL part 1 — the `@effect/sql` abstraction layer), Chapter 26 (SQL part 2 — drivers)
> **Reads into:** Chapter 38 (Config and secrets — typed environment loading)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapters 25 and 26 established the full `@effect/sql` stack: a `SqlClient.SqlClient` tag as the database abstraction, a tagged-template DSL for parameterized queries, `SqlSchema` for result decoding, and eleven driver layers that each provide the tag. Every query is an Effect, every transaction is a scoped resource, and nothing escapes the fiber's context.

That stack is complete — but it speaks raw SQL. Most TypeScript teams also want a query builder: a typed API that assembles SQL from composable object expressions, catches column-name typos at compile time, and removes the mental overhead of formatting multi-table joins by hand. The two dominant choices in the TypeScript ecosystem are [Drizzle ORM](https://orm.drizzle.team/) and [Kysely](https://kysely.dev/). Both are excellent in isolation. The problem is integrating either one into Effect without losing everything Chapter 25 gave you.

Without an integration layer, the bridging work falls to you. A Drizzle query returns a `Promise`; Kysely queries do too. To run them inside `Effect.gen` you must wrap each call in `Effect.tryPromise`:

```ts
import { drizzle } from "drizzle-orm/pg-proxy"
import { users } from "./schema"
import { Effect } from "effect"

// Pain: manual Promise wrapping on every query
const findUser = (id: number) =>
  Effect.tryPromise({
    try: () => db.select().from(users).where(eq(users.id, id)),
    catch: (cause) => new Error(`DB error: ${cause}`)
  })
```

That `Effect.tryPromise` wrapper has three problems. First, it drops the `SqlError` type: the error is untyped `unknown` until you cast it. Second, it breaks transactions. If `findUser` runs inside `client.withTransaction(...)`, the transaction connection is threaded through a `FiberRef` in the Effect runtime. `Effect.tryPromise` crosses the Effect–Promise boundary, and that `FiberRef` context is not available on the other side. The query runs on a fresh connection from the pool, outside the transaction. Third, it loses fiber-level cancellation: if the fiber is interrupted while the Promise is in flight, the Postgres server continues executing the query.

The same problems apply to every Kysely query. And there is a second problem that appears before any query runs: connection strings. A production database URL looks like `postgres://alice:s3cr3t@db.example.com:5432/myapp`. If you pass that string to a driver layer config and the config object is logged or serialized into an OpenTelemetry span (which happens automatically for Layer errors), the password leaks. The query-builder integration packages must pair with `Redacted` from `effect` to keep credentials out of structured logs.

`@effect/sql-drizzle` and `@effect/sql-kysely` solve both problems. They each patch the query builder's prototype so every builder instance satisfies `Effect.EffectTypeId` and can be yielded directly inside `Effect.gen`. Queries run through `SqlClient`, not through a separate connection — so transactions, fiber-local context, and cancellation all work. And `Config.redacted` provides the `Redacted<string>` wrapper for connection strings so passwords cannot leak into logs.

---

## The minimal example

The smallest runnable Drizzle program over SQLite shows the full integration in under 30 lines. A Drizzle table schema, two queries, and no `Promise` wrapping anywhere:

```ts
import { SqlClient } from "@effect/sql"
import * as SqliteDrizzle from "@effect/sql-drizzle/Sqlite"
import { SqliteClient } from "@effect/sql-sqlite-node"
import * as D from "drizzle-orm/sqlite-core"
import { Effect, Layer } from "effect"

// Drizzle table schema — the usual drizzle-orm/sqlite-core columns
const users = D.sqliteTable("users", {
  id: D.integer("id").primaryKey(),
  name: D.text("name")
})

// Driver layer provides SqlClient.SqlClient.
const SqlLive = SqliteClient.layer({ filename: ":memory:" })
// Drizzle layer wraps that SqlClient in a SqliteDrizzle tag.
// repos/effect/packages/sql-drizzle/src/Sqlite.ts:53
const DrizzleLive = SqliteDrizzle.layer.pipe(Layer.provide(SqlLive))
const AppLive = Layer.mergeAll(SqlLive, DrizzleLive)

const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const db = yield* SqliteDrizzle.SqliteDrizzle

  // Create the table through the raw SqlClient DSL (Chapter 25)
  yield* sql`CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)`

  // Drizzle builders are directly yield*-able — no Effect.tryPromise wrapper
  yield* db.insert(users).values({ id: 1, name: "Alice" })
  const rows = yield* db.select().from(users)
  console.log(rows) // [{ id: 1, name: 'Alice' }]
})

Effect.runPromise(program.pipe(Effect.provide(AppLive)))
```

The key line is `yield* db.select().from(users)`. No `.execute()`, no `Effect.promise(...)`, no error wrapping. The `SqliteDrizzle.layer` import ran `patch(QueryPromise.prototype)` as a side effect, so every Drizzle query object is already an Effect.

---

## Tour

### `@effect/sql-drizzle`

`@effect/sql-drizzle` exposes three independent modules, one per SQL dialect: `@effect/sql-drizzle/Pg`, `@effect/sql-drizzle/Mysql`, and `@effect/sql-drizzle/Sqlite`. There is no top-level `index.ts` — each dialect is its own entry point declared in the package's `exports` map.

**The dialect modules.** Each module follows an identical shape. Taking Postgres as the example (`repos/effect/packages/sql-drizzle/src/Pg.ts:1-68`):

```ts
// repos/effect/packages/sql-drizzle/src/Pg.ts:16-47
/**
 * @since 1.0.0
 * @category constructors
 */
export const make = <TSchema extends Record<string, unknown> = Record<string, never>>(
  config?: Omit<DrizzleConfig<TSchema>, "logger">
): Effect.Effect<PgRemoteDatabase<TSchema>, never, Client.SqlClient> =>
  Effect.gen(function*() {
    const db = drizzle(yield* makeRemoteCallback, config)
    return db
  })

/**
 * @since 1.0.0
 * @category tags
 */
export class PgDrizzle extends Context.Tag("@effect/sql-drizzle/Pg")<
  PgDrizzle,
  PgRemoteDatabase
>() {}

/**
 * @since 1.0.0
 * @category layers
 */
export const layer: Layer.Layer<PgDrizzle, never, Client.SqlClient> = Layer.effect(PgDrizzle, make())
```

`make` yields `makeRemoteCallback` — an Effect that acquires `SqlClient` from context and builds a Drizzle remote-proxy callback backed by it. That callback is passed to `drizzle(...)` from `drizzle-orm/pg-proxy`, which uses it to execute compiled SQL. The result is a `PgRemoteDatabase`, the standard Drizzle handle with full type-safe DSL. The `PgDrizzle` tag is a `Context.Tag` subclass giving the handle a named slot in the Effect Context. `layer` wraps the whole construction in `Layer.effect` so it composes with any standard Layer pipeline.

The MySQL module (`repos/effect/packages/sql-drizzle/src/Mysql.ts:1-69`) provides `MysqlDrizzle` and `MySqlRemoteDatabase` following the same shape. SQLite (`repos/effect/packages/sql-drizzle/src/Sqlite.ts:53`) uses `Layer.scoped` for its `layer` export rather than `Layer.effect`.

**The prototype patch.** The real mechanism is in `repos/effect/packages/sql-drizzle/src/internal/patch.ts:1-72`. When a dialect module is imported, it calls `patch(QueryPromise.prototype)` and `patch(PgSelectBase.prototype)` (or their dialect equivalents) at module top level. `patch` copies `Effectable.CommitPrototype` onto the target prototype, making every instance of those classes satisfy `Effect.EffectTypeId`. The `commit` method captures `Effect.runtime()` to get the current fiber's runtime, then calls `this.execute()` — the standard Drizzle execution path — synchronously with a `currentRuntime` cell temporarily set to the captured runtime. Inside Drizzle's callback, `Runtime.runPromise(currentRuntime)` re-enters Effect using that runtime, so `FiberRef` state — including the transactional connection stored by `client.withTransaction` — is available. Failures are mapped to `new SqlError(...)`.

A module augmentation at the bottom of each dialect file retroactively types all Drizzle query objects with the Effect error channel:

```ts
// repos/effect/packages/sql-drizzle/src/Pg.ts:64-66
declare module "drizzle-orm" {
  export interface QueryPromise<T> extends Effect.Effect<T, SqlError> {}
}
```

This is TypeScript module augmentation, not runtime code. After the import, `db.select().from(users)` has type `PgSelectBase & Effect.Effect<User[], SqlError>`, so TypeScript knows it is both a Drizzle builder and an Effect.

### `@effect/sql-kysely`

`@effect/sql-kysely` takes the same prototype-patch approach with a more nuanced design. It exposes five modules: `Kysely` (native driver mode), `Pg`, `Mysql`, `Mssql`, and `Sqlite` (`SqlClient`-backed mode). The split matters: in `SqlClient`-backed mode Kysely only compiles SQL; in native mode Kysely's own driver executes it.

**`SqlClient`-backed mode.** The `Pg`, `Mysql`, `Mssql`, and `Sqlite` modules each call `internal.makeWithSql` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:55-67`). Here is the Postgres variant:

```ts
// repos/effect/packages/sql-kysely/src/Pg.ts:1-27
/**
 * @since 1.0.0
 */
export const make = <DB>(config?: Omit<KyselyConfig, "dialect">) =>
  internal.makeWithSql<DB>({
    ...config,
    dialect: {
      createAdapter: () => new PostgresAdapter(),
      createDriver: () => new DummyDriver(),
      createIntrospector: (db) => new PostgresIntrospector(db),
      createQueryCompiler: () => new PostgresQueryCompiler()
    }
  })
```

The `DummyDriver` is the key: it is a no-op stub that satisfies Kysely's interface contract but performs no I/O. Kysely uses the adapter and query compiler to produce a SQL string and parameters. Then `makeWithSql` wires the actual execution to `client.unsafe(sql, parameters)` from `SqlClient`. Connection pooling, transactions, and cancellation remain entirely in the `@effect/sql` layer.

Inside `makeWithSql`, after constructing the `Kysely<DB>` instance, `db.withTransaction` is replaced with `client.withTransaction` from context. This is the bridge that makes the Effect `withTransaction` API work on the Kysely handle. Because `SelectQueryBuilder` is not a public Kysely export, its prototype is reached by constructing a throwaway instance: `Object.getPrototypeOf(db.selectFrom("" as any))` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:63-65`).

The entire wrapped handle is returned as an `EffectKysely<DB>` — defined in `repos/effect/packages/sql-kysely/src/patch.types.ts:38-40`:

```ts
export interface EffectKysely<DB> extends Omit<Kysely<DB>, "transaction"> {
  withTransaction: <R, E, A>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E | SqlError, R>
}
```

**Native driver mode.** `@effect/sql-kysely/Kysely` exports `make(config: KyselyConfig)` which calls `makeWithExecute` (`repos/effect/packages/sql-kysely/src/internal/kysely.ts:74-80`). This mode passes any standard Kysely `Dialect` — including the real `PostgresDialect` backed by a `pg.Pool` — directly to `new Kysely(config)`. Execution goes through Kysely's own driver pipeline. Each query is wrapped in `Effect.tryPromise` and annotated with an OpenTelemetry span via `Effect.withSpan("kysely.execute", ...)` (`repos/effect/packages/sql-kysely/src/internal/patch.ts:74-85`), so queries appear in traces even without a `SqlClient` layer.

**Module augmentation.** Like `@effect/sql-drizzle`, the package adds `Effect.Effect` to every Kysely builder interface via a `declare module "kysely"` block in `repos/effect/packages/sql-kysely/src/patch.types.ts:8-32`. After importing any dialect module, `db.selectFrom("users").selectAll()` has type `SelectQueryBuilder<DB, "users", User> & Effect.Effect<Array<User>, SqlError>`.

### Redacted — keeping connection strings out of logs

Both `@effect/sql-drizzle` and `@effect/sql-kysely` ultimately connect through an `@effect/sql` driver layer. Driver layers accept a config object or a `Config.Config.Wrap<...>` config. When something goes wrong during layer construction — a bad hostname, a refused connection — Effect logs the Layer failure. If the layer config contains a plain `string` password field, that password appears in the log output.

`Redacted` from `effect` (`repos/effect/packages/effect/src/Redacted.ts:1-144`) is the type-level solution. A `Redacted<A>` wraps any value and overrides `toString`, `toJSON`, and `util.inspect` to return `"<redacted>"`. The value is visible only to code that explicitly calls `Redacted.value(r)`:

```ts
// repos/effect/packages/effect/src/Redacted.ts:62-75
/**
 * This function creates a `Redacted<A>` instance from a given value `A`,
 * securely hiding its content.
 *
 * @example
 * ```ts
 * import { Redacted } from "effect"
 *
 * const API_KEY = Redacted.make("1234567890")
 * ```
 *
 * @since 3.3.0
 * @category constructors
 */
export const make: <A>(value: A) => Redacted<A> = redacted_.make

// repos/effect/packages/effect/src/Redacted.ts:77-94
/**
 * @since 3.3.0
 * @category getters
 */
export const value: <A>(self: Redacted<A>) => A = redacted_.value
```

`Redacted.unsafeWipe` (`repos/effect/packages/effect/src/Redacted.ts:96-118`) erases the underlying value from memory once it is no longer needed, preventing it from persisting in the heap.

In practice, connection strings should come from `Config.redacted`, which reads an environment variable and wraps the result in `Redacted<string>`. Driver layers like `PgClient.layerConfig` accept `Config.Config.Wrap<PgClientConfig>`, which expects `Config.redacted("DATABASE_URL")` for the password field. Chapter 38 covers `Config` and `Config.redacted` in full depth. For now, the pattern is:

```ts
import { Config, Redacted } from "effect"
import { PgClient } from "@effect/sql-pg"

// Config.redacted reads DATABASE_PASSWORD from env and wraps it in Redacted<string>.
// toString() → "<redacted>"; value only available inside Layer construction.
const DbLive = PgClient.layerConfig({
  host: Config.string("DB_HOST"),
  database: Config.string("DB_NAME"),
  username: Config.string("DB_USER"),
  password: Config.redacted("DB_PASSWORD")
})
```

If a Layer failure causes Effect to log the config, the password field prints as `<redacted>`. The actual string is accessible only by calling `Redacted.value(password)` inside the driver, which logs nothing.

---

## A production example

This example combines `@effect/sql-drizzle` with a Postgres driver, `Config.redacted` for credentials, a typed Drizzle schema, and `client.withTransaction` for atomic writes. It follows the "typed repository" pattern: a service tag exposes domain operations; all SQL is confined to the service implementation; the caller sees only Effect signatures.

```ts
import { SqlClient } from "@effect/sql"
import { PgClient } from "@effect/sql-pg"
import * as PgDrizzle from "@effect/sql-drizzle/Pg"
import * as D from "drizzle-orm/pg-core"
import { eq } from "drizzle-orm"
import { Config, Context, Effect, Layer, Redacted } from "effect"

// ─── Drizzle schema ───────────────────────────────────────────────────────────

const accounts = D.pgTable("accounts", {
  id: D.serial("id").primaryKey(),
  owner: D.varchar("owner", { length: 100 }).notNull(),
  balance: D.integer("balance").notNull().default(0)
})

// ─── Service tag ──────────────────────────────────────────────────────────────

interface AccountRepo {
  readonly credit: (owner: string, amount: number) => Effect.Effect<void, never>
  readonly transfer: (
    from: string,
    to: string,
    amount: number
  ) => Effect.Effect<void, never>
  readonly balance: (owner: string) => Effect.Effect<number, never>
}

class AccountRepository extends Context.Tag("AccountRepository")<
  AccountRepository,
  AccountRepo
>() {}

// ─── Implementation ───────────────────────────────────────────────────────────

const AccountRepositoryLive = Layer.effect(
  AccountRepository,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    const db = yield* PgDrizzle.PgDrizzle

    const credit = (owner: string, amount: number) =>
      Effect.gen(function* () {
        yield* db
          .insert(accounts)
          .values({ owner, balance: amount })
          .onConflictDoUpdate({
            target: accounts.owner,
            set: { balance: D.sql`${accounts.balance} + ${amount}` }
          })
      }).pipe(Effect.orDie)

    const transfer = (from: string, to: string, amount: number) =>
      sql.withTransaction(
        Effect.gen(function* () {
          // Both updates run in the same transaction connection
          yield* db
            .update(accounts)
            .set({ balance: D.sql`${accounts.balance} - ${amount}` })
            .where(eq(accounts.owner, from))
          yield* db
            .update(accounts)
            .set({ balance: D.sql`${accounts.balance} + ${amount}` })
            .where(eq(accounts.owner, to))
        })
      ).pipe(Effect.orDie)

    const balance = (owner: string) =>
      Effect.gen(function* () {
        const rows = yield* db
          .select({ balance: accounts.balance })
          .from(accounts)
          .where(eq(accounts.owner, owner))
        return rows[0]?.balance ?? 0
      }).pipe(Effect.orDie)

    return { credit, transfer, balance }
  })
)

// ─── Layers ───────────────────────────────────────────────────────────────────

// Config.redacted keeps the password out of logs and spans.
// Full Config coverage in Chapter 38 (Config and secrets).
const DbLive = PgClient.layerConfig({
  host: Config.string("DB_HOST"),
  database: Config.string("DB_NAME"),
  username: Config.string("DB_USER"),
  password: Config.redacted("DB_PASSWORD")
})

const DrizzleLive = PgDrizzle.layer.pipe(Layer.provide(DbLive))

const AppLive = AccountRepositoryLive.pipe(
  Layer.provide(Layer.mergeAll(DbLive, DrizzleLive))
)

// ─── Program ──────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const repo = yield* AccountRepository
  yield* repo.credit("alice", 1000)
  yield* repo.credit("bob", 500)
  yield* repo.transfer("alice", "bob", 200)
  const aliceBalance = yield* repo.balance("alice")
  const bobBalance = yield* repo.balance("bob")
  console.log({ aliceBalance, bobBalance }) // { aliceBalance: 800, bobBalance: 700 }
})

Effect.runPromise(program.pipe(Effect.provide(AppLive)))
```

The `transfer` function calls `sql.withTransaction(...)` from the `SqlClient` service, not Drizzle's transaction API. The two Drizzle `update` calls inside that block automatically use the transactional connection because the prototype patch's `commit` method captures `Effect.runtime()` and reads `currentRuntime` at execution time (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:19-33`).

---

## Variations

**Use Kysely instead of Drizzle.** Swap the dialect import and tag:

```ts
import * as PgKysely from "@effect/sql-kysely/Pg"
import { Context, Effect, Layer } from "effect"

class KyselyDB extends Context.Tag("KyselyDB")<
  KyselyDB,
  PgKysely.EffectKysely<Database>
>() {}

const KyselyLive = Layer.effect(KyselyDB, PgKysely.make<Database>()).pipe(
  Layer.provide(DbLive)
)

const findUsers = Effect.gen(function* () {
  const db = yield* KyselyDB
  return yield* db.selectFrom("users").selectAll()
})
```

**Native Kysely driver mode.** Use `@effect/sql-kysely/Kysely` when you want full Kysely semantics — including its own connection pool and `transaction()` API — but still want queries to be `yield*`-able Effects:

```ts
import { make as makeKysely } from "@effect/sql-kysely/Kysely"
import { PostgresDialect } from "kysely"
import pg from "pg"

// Any Kysely Dialect works; execution bypasses SqlClient entirely.
const db = makeKysely<Database>({
  dialect: new PostgresDialect({ pool: new pg.Pool({ connectionString: "..." }) })
})

const rows = yield* db.selectFrom("users").selectAll()
```

**Mix raw `sql` with a query builder.** Both packages coexist. Use Drizzle or Kysely for typed reads; use the `SqlClient` tagged-template for DDL, upserts with non-standard syntax, or ad-hoc debug queries:

```ts
const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const db = yield* PgDrizzle.PgDrizzle

  // DDL stays in the raw DSL (Chapter 25)
  yield* sql`CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_users_email ON users(email)`

  // Typed reads use Drizzle
  const active = yield* db.select().from(users).where(eq(users.active, true))
  return active
})
```

**Schema-typed results.** Drizzle returns rows as its own inferred types; Kysely returns rows typed by your `Database` interface. Both skip `SqlSchema.findAll` validation. If you need `ParseError` type safety from Effect Schema (Chapter 14), add a decode step:

```ts
import { Schema } from "@effect/schema"
import { Effect } from "effect"

const UserSchema = Schema.Struct({ id: Schema.Number, name: Schema.String })

const findUserById = (id: number) =>
  Effect.gen(function* () {
    const db = yield* PgDrizzle.PgDrizzle
    const rows = yield* db.select().from(users).where(eq(users.id, id))
    return yield* Schema.decodeUnknown(Schema.Array(UserSchema))(rows)
  })
```

**Drizzle migrations with drizzle-kit.** Drizzle has a companion CLI tool, `drizzle-kit`, for generating and running schema migrations. `drizzle-kit` operates outside the Effect runtime — it reads your schema files and outputs SQL migration files or runs them via a direct database connection you configure in `drizzle.config.ts`. The `@effect/sql-drizzle` package does not integrate with `drizzle-kit`; migration execution stays in `drizzle-kit`'s own CLI or in your deploy pipeline. For migrations inside Effect programs, `@effect/sql` provides `SqlSchema.findAll` and `SqlClient.withTransaction` as the building blocks (Chapter 25).

---

## Anti-patterns

**Hard-coding connection strings in plain strings.**

```ts
// Wrong — password visible in Layer errors, logs, and OTel spans
const DbLive = PgClient.layer({
  host: "db.example.com",
  password: "s3cr3t"   // leaks on Layer failure
})
```

Use `Config.redacted` so the value is wrapped in `Redacted<string>` before it enters the Layer pipeline. The password prints as `<redacted>` in all structured output.

```ts
// Correct — Redacted.make wraps the string; toString() → "<redacted>"
// repos/effect/packages/effect/src/Redacted.ts:75-75
const DbLive = PgClient.layerConfig({
  host: Config.string("DB_HOST"),
  password: Config.redacted("DB_PASSWORD")
})
```

**Running Drizzle or Kysely directly, bypassing `SqlClient`.**

```ts
// Wrong — creates a second pg.Pool outside Effect's resource management
import { drizzle } from "drizzle-orm/node-postgres"
import { Pool } from "pg"

const db = drizzle(new Pool({ connectionString: process.env.DATABASE_URL }))

const findUser = (id: number) =>
  Effect.tryPromise(() => db.select().from(users).where(eq(users.id, id)))
```

This bypasses connection pooling that Effect manages via `Layer.scoped`, breaks fiber-level cancellation, loses transaction semantics, and re-introduces the `Effect.tryPromise` error-type problem. Use the dialect layer (`PgDrizzle.layer` or `Layer.effect(tag, PgKysely.make<DB>())`) and provide it with the `@effect/sql` driver layer instead.

**Mixing Drizzle's `transaction()` with Effect's `withTransaction`.**

```ts
// Wrong — Drizzle's transaction uses a different connection from Effect's
const program = Effect.gen(function* () {
  const db = yield* PgDrizzle.PgDrizzle
  // This opens a second, parallel transaction connection
  await db.transaction(async (tx) => {
    await tx.insert(users).values({ name: "Alice" })
  })
})
```

After the prototype patch, `db` is an Effect inside `Effect.gen`. Calling `.transaction(callback)` directly — Drizzle's Promise-based transaction API — creates a new connection scope that Effect does not manage. Inside the callback, `tx` is not the same connection that `client.withTransaction` would use. Use `sql.withTransaction(...)` from `SqlClient.SqlClient` for all transactions; Drizzle queries inside that block automatically pick up the transactional connection via `currentRuntime` (`repos/effect/packages/sql-drizzle/src/internal/patch.ts:8,45-72`).

---

## See also

- **Chapter 25** — [SQL part 1 — the `@effect/sql` abstraction layer](25-sql-core.md): `SqlClient.SqlClient` tag, tagged-template DSL, `SqlSchema`, `SqlResolver`, and `withTransaction`. Query builders sit on top of this foundation.
- **Chapter 26** — [SQL part 2 — drivers](26-sql-drivers.md): driver layers (`PgClient.layer`, `SqliteClient.layer`, etc.) that provide `SqlClient.SqlClient`. Both query-builder packages require a driver layer below them.
- **Chapter 14** — [Schema part 1 — declaring shapes with `Struct`, `Class`, and `TaggedClass`](../part-1-foundations/14-schema-part-1.md): Drizzle and Kysely return rows typed by their own schemas; add `Schema.decodeUnknown` when you need Effect Schema's `ParseError` guarantees on query results.
- **Chapter 38** — [Config and secrets — typed environment loading](38-config-and-secrets.md): `Config.redacted` is the canonical way to load database passwords and connection strings. `Redacted` (introduced in this chapter) lives in the core `effect` package; `Config.redacted` is the Config system integration covered fully in Chapter 38.
- **Patterns catalog** — [`Redacted — prevent secret values from leaking to logs/spans`](../../research/02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans): the canonical entry for `Redacted.make`, `Redacted.value`, and `Redacted.unsafeWipe`.
- **Per-package notes** — [`research/packages/sql-drizzle.md`](../../research/packages/sql-drizzle.md): deep notes on the `currentRuntime` mutable cell, the prototype patch mechanism, `sideEffects` declarations, and Drizzle version ceiling.
- **Per-package notes** — [`research/packages/sql-kysely.md`](../../research/packages/sql-kysely.md): `DummyDriver` pattern, `Proxy`-based per-instance commit, `EffectKysely<DB>` type, and comparison with the Drizzle approach.

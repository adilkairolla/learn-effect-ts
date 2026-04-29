# Chapter 25 — SQL part 1 — the @effect/sql abstraction layer

> **Package(s):** `@effect/sql`
> **Patterns introduced:** [`Request.of` / `RequestResolver.make` / `Effect.request` — request batching](../../research/02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching)
> **Reads from:** Chapter 14 (Schema part 1 — declaring shapes with `Struct`, `Class`, and `TaggedClass`), Chapter 15 (Schema part 2 — transforms, refinements, and brand integration), Chapter 22 (Platform services — the abstract runtime layer)
> **Reads into:** Chapter 26 (SQL part 2 — drivers), Chapter 27 (SQL part 3 — query builders: Drizzle and Kysely), Chapter 28 (Type-safe RPC with @effect/rpc)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Raw SQL access in TypeScript has four recurring pain points that accumulate as a codebase grows.

**SQL injection from string concatenation.** When you build queries by splicing user input into strings, the database cannot distinguish your SQL from an attacker's payload:

```ts
// Every filtered column is a potential injection vector
async function findUsers(email: string): Promise<unknown[]> {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = '${email}'`
  )
  return rows
}
```

Pass `' OR 1=1 --` as the email and the `WHERE` clause evaporates. Libraries that use parameterized queries solve injection, but their APIs are stringly-typed and the calling code must remember to always use placeholders — there is no structural enforcement.

**Results typed as `any[]`.** Even with parameterized queries, the raw driver returns untyped rows:

```ts
const { rows } = await pool.query<any>(
  "SELECT id, email, created_at FROM users WHERE id = $1",
  [userId]
)
// rows[0].id — could be a number, a string, or undefined
// rows[0].created_at — a Date? A string? Depends on the driver config
```

Every consumer must manually assert types (`rows[0] as User`), and those assertions are silent lies that only fail at runtime. There is no validation that the shape you expect matches the shape the database returns.

**No N+1 mitigation.** When each row in a result set requires a follow-up lookup, the naive code issues one query per row:

```ts
const posts = await getPosts()
// One SELECT per post — 100 posts = 101 queries
const enriched = await Promise.all(
  posts.map(async (p) => ({
    ...p,
    author: await getUserById(p.authorId)
  }))
)
```

GraphQL popularized the DataLoader pattern to collapse these N+1 fans into single batched queries, but wiring DataLoader manually for every relation in a plain TypeScript codebase is boilerplate-heavy and easy to forget.

**Manual transaction management.** Wrapping multiple statements in a transaction requires acquiring a connection, issuing `BEGIN`, wiring the same connection through every helper, committing or rolling back, and releasing. Any async helper that opens a second connection destroys atomicity silently. There is no structural enforcement that a "run this in a transaction" boundary covers all the right calls.

`@effect/sql` attacks all four problems at once. It provides a driver-agnostic `SqlClient` service — the same pattern as `@effect/platform`'s `FileSystem` tag (Chapter 22) — so application code is written once and backed by any driver (covered in Chapter 26). The tagged-template `sql\`...\`` DSL makes parameterization the default and injection structurally impossible. `SqlSchema` wraps every query result in Schema decode/encode from core `effect` (Chapters 14–15). `SqlResolver` wires Effect's `Request`/`RequestResolver` machinery to eliminate N+1 without manual DataLoader setup. And `client.withTransaction` closes the connection-reuse gap via Scope.

---

## The minimal example

The driver (`PgClient.layer` from `@effect/sql-pg`, covered in Chapter 26) provides the concrete `SqlClient`. Everything else here is pure `@effect/sql` abstraction:

```ts
import { SqlClient, SqlSchema } from "@effect/sql"
import { Effect, Schema } from "effect"

// Domain model — Schema from Chapter 14
class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  email: Schema.String,
  name: Schema.String
}) {}

// Schema-validated query: returns Option<User>
const findUserByEmail = SqlSchema.findOne({
  Request: Schema.String,          // input type (email: string)
  Result: User,                     // decoded output type
  execute: (email) =>
    Effect.flatMap(
      SqlClient.SqlClient,
      (sql) => sql`SELECT id, email, name FROM users WHERE email = ${email}`
    )
})

// Usage — sql`` interpolations are always bound parameters, never raw SQL
const program = Effect.gen(function* () {
  const user = yield* findUserByEmail("alice@example.com")
  // user: Option<User>
})

// Provide PgClient.layer (Chapter 26) at the program boundary:
// Effect.runPromise(program.pipe(Effect.provide(PgClient.layer(config))))
```

The template literal ``sql`...${email}...` `` produces a `Statement<User>` where every interpolated value is a `Parameter` segment — never raw text. Parameterization is the only path; injection requires the deliberate `sql.unsafe` escape hatch.

---

## Tour

### The `SqlClient` Tag

`SqlClient` is the central service abstraction (`repos/effect/packages/sql/src/SqlClient.ts:30-72`). The interface extends `Constructor` — the template-literal DSL type — so calling `sql` as a tagged template is the same as using the client directly:

```ts
// repos/effect/packages/sql/src/SqlClient.ts:34
export interface SqlClient extends Constructor { ... }
```

`SqlClient.SqlClient` is a `Tag<SqlClient, SqlClient>` created via `Context.GenericTag` (`internal/client.ts:23`); drivers publish their implementations as `Layer.scoped(SqlClient.SqlClient, ...)`, so application code never imports a driver directly. This is the same Tag-and-Layer discipline from Chapter 08 and 09 applied to databases — swap the Layer at the entry point, the query code is unchanged.

The interface carries four operations beyond the template DSL:

- `withTransaction` — wraps any `Effect<A, E, R>` so all SQL inside runs in a single atomic transaction, automatically rolling back on any failure
- `reserve` — acquires a raw `Connection` from the pool (needed for driver-level operations)
- `reactive` / `reactiveMailbox` — live-query helpers backed by `@effect/experimental`'s `Reactivity` service

`SqlClient.make` (`repos/effect/packages/sql/src/SqlClient.ts:107-111`) is what driver authors call to construct the concrete service. It takes a `MakeOptions` record with an `acquirer`, a `Compiler`, transaction SQL strings, `spanAttributes: ReadonlyArray<readonly [string, unknown]>` for tracing, and an optional `transformRows` callback. Application code never calls `make` directly.

### The `sql\`...\`` template-literal DSL

The `Constructor` interface (`repos/effect/packages/sql/src/Statement.ts:264-356`) defines the tagged-template `sql` function and a set of composable helpers. Every value interpolated into the template literal becomes a `Parameter` segment — a typed placeholder that the dialect-specific `Compiler` translates to `$1`, `?`, or `@p1`. Identifiers (table names, column names) require `sql("tableName")` which produces an `Identifier` segment, making the distinction between data and structure explicit at the type level.

The `Segment` union (`repos/effect/packages/sql/src/Statement.ts:127-136`) captures the full grammar: `Literal`, `Identifier`, `Parameter`, `ArrayHelper`, `RecordInsertHelper`, `RecordUpdateHelper`, `RecordUpdateHelperSingle`, and `Custom`. No string concatenation anywhere in the path from template literal to wire bytes.

The result is a `Statement<A>` (`repos/effect/packages/sql/src/Statement.ts:43-57`). Crucially, `Statement<A>` extends both `Fragment` and `Effect<ReadonlyArray<A>, SqlError>`, making it dual-purpose: it can be awaited directly to execute the query, or composed as a fragment inside a larger template:

```ts
const baseQuery = sql`SELECT * FROM users`
const filtered  = sql`${baseQuery} WHERE active = ${true} LIMIT ${10}`
// filtered is still a Statement<Row>, composes without string stitching
```

The `Constructor` interface also exposes structural helpers that prevent common patterns from devolving into string building:

- `sql.insert(record)` — produces a `RecordInsertHelper` that the compiler translates to `(col1, col2) VALUES ($1, $2)`
- `sql.update(record, omit?)` — `RecordUpdateHelperSingle` for single-row `SET` clauses
- `sql.in("column", values)` — type-safe `IN (...)` expansion
- `sql.and([...fragments])` / `sql.or([...fragments])` — `AND`/`OR` chains for `WHERE` clauses
- `sql.csv(values)` — comma-separated fragments for `ORDER BY`, `GROUP BY`
- `sql.onDialect({ sqlite, pg, mysql, mssql, clickhouse })` — emit dialect-specific SQL without leaving the typed DSL
- `sql.unsafe(rawSql, params?)` — the deliberate escape hatch for SQL that cannot be expressed structurally

The `statement.compile()` method (`repos/effect/packages/sql/src/Statement.ts:53-56`) returns `readonly [sql: string, params: ReadonlyArray<unknown>]` — the fully-compiled SQL string and bound parameters, useful for logging and testing.

### Schema integration: `SqlSchema`

`SqlSchema` (`repos/effect/packages/sql/src/SqlSchema.ts`) wraps every query in a Schema encode/decode pair from core `effect`. The Schema integration (introduced in Chapters 14–15 and part of core `effect` since v3.10.0) means results are validated at runtime, not merely asserted.

Four helpers cover the common return shapes:

**`SqlSchema.findAll`** (`repos/effect/packages/sql/src/SqlSchema.ts:10-30`) — returns `Effect<ReadonlyArray<A>, E | ParseError, R>`. Takes a `Request` schema (encodes the input to its wire form), a `Result` schema (decodes each row), and an `execute` function. It encodes the request, runs the query, then runs `Schema.decodeUnknown(Schema.Array(Result))` over the raw rows.

**`SqlSchema.findOne`** (`repos/effect/packages/sql/src/SqlSchema.ts:54-74`) — returns `Effect<Option<A>, E | ParseError, R>`. If the result array is non-empty, decodes the first row and wraps it in `Option.some`; otherwise returns `Option.none`. The `Option` return makes the "not found" case explicit in the type.

**`SqlSchema.single`** (`repos/effect/packages/sql/src/SqlSchema.ts:76-97`) — returns `Effect<A, E | ParseError | Cause.NoSuchElementException, R>`. Like `findOne` but fails with `NoSuchElementException` when no row is returned, for cases where absence is an error.

**`SqlSchema.void`** (`repos/effect/packages/sql/src/SqlSchema.ts:44-52`) — for mutations that return no useful data. Encodes the request, runs the query, discards the result.

### Transactions

`client.withTransaction` wraps any `Effect` in a database transaction (`repos/effect/packages/sql/src/SqlClient.ts:49-54`):

```ts
const transfer = (fromId: number, toId: number, amount: number) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.gen(function* () {
        yield* sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromId}`
        yield* sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toId}`
      })
    )
  )
```

Any failure inside the `Effect` argument triggers automatic `ROLLBACK`. Nested `withTransaction` calls produce savepoints, not nested `BEGIN` statements, so the outermost transaction owns the commit/rollback decision. All queries inside the boundary share the same connection without any manual thread-local or context-passing.

### Streaming queries

`Statement<A>` has a `.stream` property that returns `Stream<A, SqlError>`. For large result sets where loading all rows into memory is not practical:

```ts
const streamUsers = Effect.flatMap(SqlClient.SqlClient, (sql) =>
  // .stream is a Stream<Row, SqlError> — pull-based, back-pressure aware
  sql`SELECT id, email FROM users`.stream
)
```

The stream is backed by `SqlStream.asyncPauseResume` (`repos/effect/packages/sql/src/SqlStream.ts:12-78`), which bridges the driver's push-based cursor into a pull-based `Stream` with proper back-pressure signals.

### Errors

`SqlError` (`repos/effect/packages/sql/src/SqlError.ts:16-22`) extends `TypeIdError` from `@effect/platform` — it is a tagged error with optional `cause` and `message` fields. All SQL operations fail with `SqlError` in their error channel, making it catchable via `Effect.catchTag("SqlError", ...)`. A second error type, `ResultLengthMismatch` (`repos/effect/packages/sql/src/SqlError.ts:24-34`), is thrown by the ordered `SqlResolver` when the database returns a different number of rows than the batch of requests — a contract violation that should be treated as a bug.

### Migrations

`Migrator` (`repos/effect/packages/sql/src/Migrator.ts:69-89`) is a driver-independent migration runner. It takes a `Loader<R>` — an `Effect<ReadonlyArray<ResolvedMigration>, MigrationError, R>` — creates a migrations table if needed, and runs unapplied migrations in order inside a transaction. `MigrationError` (`repos/effect/packages/sql/src/Migrator.ts:53-67`) carries a `reason` discriminant (`"bad-state" | "import-error" | "failed" | "duplicates" | "locked"`) for fine-grained recovery via `Effect.catchTag`.

### Request batching with `SqlResolver`

This is the chapter's introduced pattern: [`Request.of` / `RequestResolver.make` / `Effect.request`](../../research/02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching).

The N+1 problem in a concurrent program looks like this: many fibers each issue `findById(someId)` concurrently, and without coordination each one fires its own `SELECT`. Effect's `Request`/`RequestResolver` machinery was designed precisely for this case — it accumulates all requests issued in the same execution window and dispatches them together.

The core types live in the `effect` package:

- **`Request.of`** (`repos/effect/packages/effect/src/Request.ts:106-112`) — creates a tagged request constructor type. A `Request<A, E>` is a pure description of a lookup with success type `A` and error type `E`.
- **`RequestResolver.make`** (`repos/effect/packages/effect/src/RequestResolver.ts:111-120`) — constructs a resolver from a `runAll` callback that receives an `Array<Array<A>>` — the batched requests grouped by call site.
- **`Effect.request`** (`repos/effect/packages/effect/src/Effect.ts:12824-12849`) — issues a single `Request` through a resolver. The Effect runtime batches all `Effect.request` calls that are outstanding in the same fiber batch into a single `runAll` invocation.
- **`Effect.withRequestBatching`** (`repos/effect/packages/effect/src/Effect.ts:12864-12867`) — enables or disables batching for a sub-tree. Pass `true` to ensure batching is on.

`@effect/sql` wraps this machinery in `SqlResolver` (`repos/effect/packages/sql/src/SqlResolver.ts:94-111`), a higher-level abstraction with four combinators:

**`SqlResolver.ordered`** (`repos/effect/packages/sql/src/SqlResolver.ts:185-256`) — the results must be returned in the same order as the requests. The number of results must equal the number of requests (enforced by `ResultLengthMismatch`). Use this for bulk inserts that return generated IDs.

**`SqlResolver.grouped`** (`repos/effect/packages/sql/src/SqlResolver.ts:258-337`) — groups results by a key extracted from each result row. Use this for one-to-many relationships (posts by author ID).

**`SqlResolver.findById`** (`repos/effect/packages/sql/src/SqlResolver.ts:339-416`) — the most common pattern. Each request is an ID; each result is `Option<A>`. Uses a `MutableHashMap` to route results back to the correct fiber regardless of database return order; absent IDs get `Option.none()` without `ResultLengthMismatch`.

**`SqlResolver.void`** (`repos/effect/packages/sql/src/SqlResolver.ts:465-473`) — batches side-effecting mutations (bulk deletes, bulk status updates) that return no result.

Each resolver exposes a `.execute(input)` method that returns `Effect<A, E | ParseError, R>`. Calling `.execute` on many fibers concurrently automatically batches the underlying SQL when `Effect.withRequestBatching(true)` is in scope.

---

## A production example

A `UserRepository` service with three operations: `findById` (batched), `findByEmail` (simple), and `insert`. The repository is a `Layer` that depends on `SqlClient.SqlClient`.

```ts
import { SqlClient, SqlResolver, SqlSchema, SqlError } from "@effect/sql"
import { Context, Effect, Layer, Option, ParseResult, Schema } from "effect"

type ParseError = ParseResult.ParseError

// ── Domain model (Schema from Chapter 14) ──────────────────────────────────

class User extends Schema.Class<User>("User")({
  id: Schema.Number,
  email: Schema.String,
  name: Schema.String,
  createdAt: Schema.DateFromString
}) {}

class NewUser extends Schema.Class<NewUser>("NewUser")({
  email: Schema.String,
  name: Schema.String
}) {}

// ── Service interface ───────────────────────────────────────────────────────

interface UserRepository {
  readonly findById: (id: number) => Effect.Effect<Option.Option<User>, ParseError | SqlError, never>
  readonly findByEmail: (email: string) => Effect.Effect<Option.Option<User>, ParseError | SqlError, never>
  readonly insert: (user: NewUser) => Effect.Effect<User, ParseError | SqlError, never>
}

class UserRepo extends Context.Tag("UserRepository")<UserRepo, UserRepository>() {}

// ── Layer implementation ────────────────────────────────────────────────────

const UserRepoLive = Layer.effect(
  UserRepo,
  Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient

    // SqlResolver.findById batches concurrent findById calls into a single
    // SELECT ... WHERE id = ANY($1) query via RequestResolver.makeBatched
    const byIdResolver = yield* SqlResolver.findById("FindUserById", {
      Id: Schema.Number,
      Result: User,
      ResultId: (user) => user.id,
      execute: (ids) => sql`SELECT id, email, name, created_at FROM users WHERE id = ANY(${sql.in(ids)})`
    })

    // SqlSchema.findOne wraps the query in Schema encode/decode
    const findByEmail = SqlSchema.findOne({
      Request: Schema.String,
      Result: User,
      execute: (email) => sql`SELECT id, email, name, created_at FROM users WHERE email = ${email}`
    })

    // SqlSchema.single fails with NoSuchElementException if no row returned
    const insertUser = SqlSchema.single({
      Request: NewUser,
      Result: User,
      execute: (newUser) =>
        sql`INSERT INTO users ${sql.insert(newUser)} RETURNING id, email, name, created_at`
    })

    return {
      findById: byIdResolver.execute,
      findByEmail,
      insert: insertUser
    }
  })
)

// ── Usage ───────────────────────────────────────────────────────────────────

const program = Effect.gen(function* () {
  const repo = yield* UserRepo

  // These three findById calls run concurrently — SqlResolver batches them
  // into a single SELECT ... WHERE id = ANY($1) call
  const [alice, bob, carol] = yield* Effect.all(
    [repo.findById(1), repo.findById(2), repo.findById(3)],
    { concurrency: "unbounded" }
  )

  return { alice, bob, carol }
}).pipe(
  Effect.withRequestBatching(true),
  Effect.provide(UserRepoLive)
  // Provide PgClient.layer (Chapter 26) to complete the dependency graph
)
```

`Effect.withRequestBatching(true)` signals the runtime to collect all outstanding `Effect.request` calls before dispatching — so the three concurrent `findById` calls collapse into one `SELECT ... WHERE id = ANY($1)` query. Callers see `Option<User>` and are unaware a batch happened.

---

## Variations

**Stream a large result set without loading it into memory:**

```ts
import { SqlClient } from "@effect/sql"
import { Effect, Stream } from "effect"

const streamAllUsers = Effect.flatMap(
  SqlClient.SqlClient,
  (sql) => sql`SELECT id, email FROM users ORDER BY id`.stream
)
// Stream<Row, SqlError> — pull-based, back-pressure from SqlStream.asyncPauseResume
```

**Compose fragments with `sql.in` and `sql.and`:**

```ts
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

const findActiveByIds = (ids: number[]) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql`SELECT * FROM users WHERE ${sql.and([
      sql`id = ANY(${sql.in(ids)})`,
      sql`active = ${true}`
    ])}`
  )
// Produces: SELECT * FROM users WHERE (id = ANY($1) AND active = $2)
```

**Run multiple statements atomically with `withTransaction`:**

```ts
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

const transferCredits = (fromId: number, toId: number, amount: number) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql.withTransaction(
      Effect.all([
        sql`UPDATE accounts SET balance = balance - ${amount} WHERE id = ${fromId}`,
        sql`UPDATE accounts SET balance = balance + ${amount} WHERE id = ${toId}`
      ])
    )
  )
// Any failure rolls back both statements; the connection is shared automatically
```

**Batch a grouped one-to-many resolver (posts per author):**

```ts
import { SqlClient, SqlResolver } from "@effect/sql"
import { Effect, Schema } from "effect"

class Post extends Schema.Class<Post>("Post")({
  id: Schema.Number,
  authorId: Schema.Number,
  title: Schema.String
}) {}

const postsByAuthorResolver = SqlResolver.grouped("PostsByAuthor", {
  Request: Schema.Number,           // authorId
  RequestGroupKey: (authorId) => authorId,
  Result: Post,
  ResultGroupKey: (post) => post.authorId,
  execute: (authorIds) =>
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`SELECT id, author_id, title FROM posts WHERE author_id = ANY(${sql.in(authorIds)})`
    ),
  withContext: true
})
```

**Run a migration on startup using `Migrator`:**

```ts
import { Migrator, SqlClient } from "@effect/sql"
import { Effect, Layer } from "effect"

// Driver packages export file-system loaders; here we show the inline form
const migrationLoader = Effect.succeed([
  [1, "create-users", Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql`CREATE TABLE IF NOT EXISTS users (
      id SERIAL PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`
  )] as const
])

const MigratorLive = Layer.effectDiscard(
  Migrator.make({})({ loader: migrationLoader })
)
```

---

## Anti-patterns

**String-concatenated SQL — injection risk and no parameterization.**

```ts
// WRONG: user input becomes part of the SQL string
const findUser = async (email: string) => {
  const { rows } = await pool.query(
    `SELECT * FROM users WHERE email = '${email}'`
  )
  return rows
}
```

```ts
// CORRECT: interpolation inside sql`` is always a bound parameter
import { SqlClient } from "@effect/sql"
import { Effect } from "effect"

const findUser = (email: string) =>
  Effect.flatMap(SqlClient.SqlClient, (sql) =>
    sql`SELECT * FROM users WHERE email = ${email}`
  )
```

**Raw `pg.query` that returns `any[]` — no schema validation, errors swallowed.**

```ts
// WRONG: no validation, shape mismatch only fails at runtime deep in the call stack
const { rows } = await pgPool.query("SELECT * FROM users WHERE id = $1", [id])
const user = rows[0] as User // silent lie
```

```ts
// CORRECT: SqlSchema.findOne validates the row through the User schema at the boundary
import { SqlClient, SqlSchema } from "@effect/sql"
import { Schema } from "effect"

const findUserById = SqlSchema.findOne({
  Request: Schema.Number,
  Result: User,
  execute: (id) =>
    Effect.flatMap(SqlClient.SqlClient, (sql) =>
      sql`SELECT id, email, name, created_at FROM users WHERE id = ${id}`
    )
})
// Returns Effect<Option<User>, ParseError | SqlError, SqlClient>
```

**N+1 queries without batching — ignores SqlResolver.**

```ts
// WRONG: one query per post, no coordination
const enrichPosts = (posts: Post[]) =>
  Effect.all(
    posts.map((post) =>
      findUserById(post.authorId).pipe(Effect.map((author) => ({ ...post, author })))
    ),
    { concurrency: "unbounded" }
  )
```

```ts
// CORRECT: wire SqlResolver.findById once; all concurrent findById calls batch
// See the production example above — byIdResolver.execute collapses N calls into 1
```

**Calling `SqlSchema` helpers without `Effect.withRequestBatching(true)` when using a resolver.**

```ts
// WRONG: batching is off by default; concurrent Effect.request calls may not batch
const result = await Effect.runPromise(
  Effect.all([repo.findById(1), repo.findById(2)])
)

// CORRECT: enable batching at the outermost scope
const result = await Effect.runPromise(
  Effect.all([repo.findById(1), repo.findById(2)]).pipe(
    Effect.withRequestBatching(true)
  )
)
```

---

## See also

- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md) — `Schema.Class`, `Schema.Struct`, and `Schema.decode` entry points used in `SqlSchema` and `SqlResolver`
- [Chapter 15 — Schema part 2](../part-1-foundations/15-schema-part-2.md) — `Schema.transform` / `transformOrFail` for bridging DB column types; `Schema.brand` for typed IDs in resolver keys
- [Chapter 22 — Platform services](22-platform.md) — the Tag-and-Layer architecture that `@effect/sql` follows; `SqlClient.SqlClient` is the same pattern as `HttpClient.HttpClient`
- [Chapter 26 — SQL part 2 — drivers](26-sql-drivers.md) — concrete `Layer` implementations for PostgreSQL, MySQL, SQLite, MSSQL, ClickHouse, LibSQL, D1, and React Native; how `SqlClient.make` is called inside a driver
- [Chapter 27 — SQL part 3 — query builders](27-sql-query-builders.md) — Drizzle and Kysely integration layers that replace the `sql\`...\`` DSL with type-safe query builder APIs while still injecting the same `SqlClient` service
- [Chapter 28 — Type-safe RPC with @effect/rpc](28-rpc.md) — RPC transport layers that use `SqlClient` for durable message persistence
- [Patterns catalog — `Request.of` / `RequestResolver.make` / `Effect.request` — request batching](../../research/02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching) — the full pattern entry with signatures, when-to-use guidance, and anti-patterns
- [Per-package note — @effect/sql](../../research/packages/sql.md) — `Model.Class`, `SqlEventJournal`, `SqlPersistedQueue`, and the "if you were authoring something similar, copy this" guidance

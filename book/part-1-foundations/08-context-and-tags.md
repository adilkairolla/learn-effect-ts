# Chapter 08 — Context, Tags, and the R type parameter

> **Patterns introduced:** [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants), [`Effect.Service` class](../../research/02-patterns-catalog.md#effectservice-class)
> **Reads from:** [Chapter 02 — Effect as a value](02-effect-as-a-value.md), [Chapter 05 — Effect.gen](05-effect-gen.md)
> **Reads into:** Chapter 09 (Layer), every Part II tour, Part III (worked example)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Dependency injection in TypeScript without Effect falls into three camps, and none of them are satisfying.

**Pass arguments through the call stack.** The simplest approach: every function that needs a `Database` receives it as a parameter. This works until the call stack gets deep. A helper three levels down that fetches a user needs the database. You add a `db` argument to the helper, then to the function that calls the helper, then to the function above that. Every function in the chain must be updated to forward something it does not actually use — the dreaded "prop drilling" of backend code.

**Use a runtime DI container.** Frameworks like InversifyJS bolt a container onto TypeScript's class system. You decorate classes, register implementations at startup, and inject via constructor parameters. This works at runtime, but the type system cannot see any of it. A function that needs a `DatabaseService` from the container has the same signature as a function that has no dependencies at all: `(id: string) => Promise<User>`. The container is invisible to the type checker, and tests that want to swap the real database for a stub must reach for global mutation or container reconfiguration.

**Module-level singletons.** The simplest approach of all: export a `const db = createDatabase()` from a module and import it wherever it is needed. No argument passing, no container. But the import is invisible to callers, the module executes side effects on load, and there is no way to swap implementations without monkey-patching at test time.

In all three cases, the same question has no type-level answer: *what does this function depend on?* You have to read the implementation. And the related question — *how do I swap a dependency for a mock in tests?* — has no structural answer; you must reach past the type system.

Effect's approach is different. Recall from Chapter 02 that `Effect<A, E, R>` has three type parameters: the success type `A`, the error type `E`, and the *requirements* type `R`. The `R` parameter is a union of service identifiers — the things the effect needs before it can be run. An effect that needs a `Database` has `R = Database`. Compose it with an effect that also needs a `Logger`, and the result has `R = Database | Logger`. Provide both, and `R` collapses to `never`, meaning the effect is fully self-contained and can be run.

The type checker enforces this. You cannot call `Effect.runPromise` on an effect whose `R` is not `never` — the compiler will refuse. Requirements are visible in signatures, propagate through composition, and disappear when satisfied. This chapter shows the machinery that makes it work: Tags.

---

## The minimal example

```ts
import { Context, Effect } from "effect"

// 1. Declare a service interface and bind it to a Tag.
class Database extends Context.Tag("Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// 2. Write business logic that depends on the service.
const getUsers = Effect.gen(function* () {
  const db = yield* Database       // R grows: Database is now required
  return yield* db.query("SELECT * FROM users")
})
// getUsers : Effect<ReadonlyArray<unknown>, never, Database>

// 3. Provide the service (Layer-based provision shown in Chapter 09).
const main = getUsers.pipe(
  Effect.provideService(Database, {
    query: (sql) => Effect.succeed([{ id: 1, name: "Alice" }])
  })
)
// main : Effect<ReadonlyArray<unknown>, never, never>
```

Three steps: declare a Tag, yield it inside `Effect.gen`, provide an implementation. The `R` parameter tracks the requirement and drops to `never` once the service is provided.

---

## How it works

### Part A — `Context.Tag` class form (recommended)

The most common pattern in Effect codebases is the class form:

```ts
import { Context } from "effect"

class Database extends Context.Tag("Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}
```

This is exported from `repos/effect/packages/effect/src/Context.ts:524`:

```
export const Tag: <const Id extends string>(id: Id) => <Self, Shape>() => TagClass<Self, Id, Shape>
```

The double type-parameter list `<Database, ServiceShape>` serves two distinct roles. The first argument — `Database` — is the *identifier*. At the type level, it is the class itself, used as a unique token in the `R` union. At runtime, the string `"Database"` uniquely identifies the slot in the context map. The second argument — `{ readonly query: ... }` — is the *service shape*: the interface that any implementation must satisfy.

When you write `yield* Database` inside `Effect.gen`, two things happen. At the type level, `Database` is added to the `R` union of the enclosing effect. At runtime, the Effect machinery looks up the `"Database"` key in the current context map and returns the value stored there. If no value is stored, the fiber dies with a `FiberFailure` containing a missing context error.

The string identifier `"Database"` is the runtime key. This has one important consequence: two different Tag classes with the same string key are treated as *the same tag* by the runtime. If you define `class Database extends Context.Tag("Database")...` in two separate modules and provide both, the second provision overwrites the first. The convention (visible throughout the Effect packages) is to use fully-qualified, namespaced strings: `"@effect/experimental/RateLimiter/RateLimiterStore"` rather than just `"RateLimiterStore"`. See the real usage at `repos/effect/packages/experimental/src/RateLimiter.ts:391`.

Service tags follow PascalCase class names, matching the naming convention documented in `research/03-conventions.md` and visible throughout the Effect source at `repos/effect/packages/effect/src/Context.ts:513-524`.

### Part B — `Context.GenericTag`

Before the class form stabilised, the function form was the primary API:

```ts
import { Context } from "effect"

interface DatabaseService {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
}

// The generic type parameter is the identifier; the second is the service shape.
const Database = Context.GenericTag<DatabaseService>("Database")
```

This is exported from `repos/effect/packages/effect/src/Context.ts:181`:

```
export const GenericTag: <Identifier, Service = Identifier>(key: string) => Tag<Identifier, Service>
```

`GenericTag` produces the same `Tag<Identifier, Service>` interface as the class form; it just skips the class wrapper. Use it when you are writing module-level constants rather than class declarations, or when you are interoperating with code that does not use classes. In new application code the class form is the team standard because the class itself serves as the TypeScript type, making imports and type annotations less verbose.

### Part C — `Context.Reference`

`Context.Reference` is a tag variant for services that carry a *default value*. It is exported from `repos/effect/packages/effect/src/Context.ts:582-585`:

```
export const Reference: <Self>() => <const Id extends string, Service>(
  id: Id,
  options: { readonly defaultValue: () => Service }
) => ReferenceClass<Self, Id, Service>
```

The usage pattern mirrors the Tag class form, but adds a `defaultValue` factory:

```ts
import { Context, Effect } from "effect"

class LogLevel extends Context.Reference<LogLevel>()(
  "LogLevel",
  { defaultValue: () => "info" as const }
) {}

// R is never — the default satisfies the requirement automatically.
const program = Effect.gen(function* () {
  const level = yield* LogLevel
  return level  // "info" unless overridden
})
// program : Effect<"info", never, never>
```

Because `Reference` always has a default, an effect that yields it *does not add the tag to its `R` union*. The requirement is pre-satisfied. Callers can still override the default via `Effect.provideService(LogLevel, "debug")`. The built-in `Clock`, `Random`, and `Logger` services in Effect use this pattern: they ship with usable defaults but can be replaced in tests or production.

Note: `Context.Reference` is itself marked `@experimental` at `repos/effect/packages/effect/src/Context.ts:580`. The API may change in minor releases.

### Part D — `Effect.Service` (experimental)

`Effect.Service` combines Tag definition and service implementation in a single class declaration. It is exported from `repos/effect/packages/effect/src/Effect.ts:13585` and carries the annotation:

```
@experimental might be up for breaking changes
```

> **Hedge:** `Effect.Service` is `@experimental` as of `effect@3.21.2` (`repos/effect/packages/effect/src/Effect.ts:13583`). The API shape could change in a minor release. Prefer `Context.Tag` + `Layer` (Chapter 09) for production code where stability matters.

The pattern looks like this:

```ts
import { Effect } from "effect"

class Prefix extends Effect.Service<Prefix>()("Prefix", {
  sync: () => ({ prefix: "PRE" })
}) {}

class Logger extends Effect.Service<Logger>()("Logger", {
  effect: Effect.gen(function* () {
    const { prefix } = yield* Prefix
    return {
      info: (message: string) =>
        Effect.sync(() => console.log(`[${prefix}] ${message}`))
    }
  }),
  dependencies: [Prefix.Default]
}) {}
```

Each `Effect.Service` class automatically exposes a `.Default` Layer that wires up the implementation and its declared `dependencies`. When `dependencies` are present the class exposes `DefaultWithoutDependencies` as well, for cases where you want to provide the dependency layer separately.

The `make` option accepts `effect` (async, effectful construction), `scoped` (with resource lifecycle — Chapter 10), `sync` (synchronous, no effects), or `succeed` (plain value).

Real-world usage is visible at `repos/effect/packages/cluster/src/internal/entityReaper.ts:9` and `repos/effect/packages/cluster/src/MessageStorage.ts:686`.

### Part E — `Context` operations

The `Context` module exposes a small set of operations for building context maps manually. Most application code never calls these directly — Layers (Chapter 09) handle context construction. But they are worth knowing:

```ts
import { Context } from "effect"

class Port extends Context.Tag("Port")<Port, { readonly port: number }>() {}
class Host extends Context.Tag("Host")<Host, { readonly host: string }>() {}

// Build a context from scratch.
const portCtx = Context.make(Port, { port: 8080 })           // Context<Port>
const withHost = Context.add(portCtx, Host, { host: "localhost" })  // Context<Port | Host>

// Retrieve a value.
const portValue = Context.get(withHost, Port)  // { port: 8080 }

// Merge two contexts.
const merged = Context.merge(portCtx, Context.make(Host, { host: "0.0.0.0" }))
```

The relevant exports are at `repos/effect/packages/effect/src/Context.ts:290` (`make`), `316` (`add`), `343` (`get`), and `438` (`merge`). `Context.pick` at line 496 returns a narrowed context containing only the listed tags.

---

## A production example

The following program models three services used together. `LogLevel` uses `Reference` (a sensible default, overridable). `Database` uses the class Tag form. `UserRepository` uses `Database` and depends on it. The inferred `R` union accumulates across all three.

```ts
import { Context, Effect } from "effect"

// ---- service declarations ----

class LogLevel extends Context.Reference<LogLevel>()(
  "app/LogLevel",
  { defaultValue: () => "info" as const }
) {}

class Database extends Context.Tag("app/Database")<
  Database,
  {
    readonly query: <T>(sql: string) => Effect.Effect<ReadonlyArray<T>>
  }
>() {}

class UserRepository extends Context.Tag("app/UserRepository")<
  UserRepository,
  {
    readonly findById: (id: number) => Effect.Effect<{ id: number; name: string }>
    readonly findAll: () => Effect.Effect<ReadonlyArray<{ id: number; name: string }>>
  }
>() {}

// ---- business logic ----

const listUsersProgram = Effect.gen(function* () {
  const level = yield* LogLevel       // R: (no addition — Reference has default)
  const users = yield* UserRepository // R: UserRepository
  yield* Effect.log(`[${level}] listing all users`)
  return yield* users.findAll()
})
// listUsersProgram : Effect<ReadonlyArray<...>, never, UserRepository>

// ---- provide services at the entry point ----

const dbImpl: Database["Service"] = {
  query: <T>(sql: string) =>
    Effect.sync(() => {
      console.log(`SQL: ${sql}`)
      return [] as ReadonlyArray<T>
    })
}

const userRepoImpl: UserRepository["Service"] = {
  findById: (id) =>
    Effect.provideService(
      Effect.gen(function* () {
        const db = yield* Database
        const rows = yield* db.query<{ id: number; name: string }>(
          `SELECT * FROM users WHERE id = ${id}`
        )
        return rows[0] ?? { id, name: "unknown" }
      }),
      Database,
      dbImpl
    ),
  findAll: () =>
    Effect.provideService(
      Effect.gen(function* () {
        const db = yield* Database
        return yield* db.query<{ id: number; name: string }>("SELECT * FROM users")
      }),
      Database,
      dbImpl
    )
}

const main = listUsersProgram.pipe(
  Effect.provideService(UserRepository, userRepoImpl)
  // LogLevel has a default — no provision needed.
  // main : Effect<ReadonlyArray<...>, never, never>
)

Effect.runPromise(main).then(console.log)
```

The Tag class form shown here mirrors the pattern used across the Effect ecosystem, for example in `repos/effect/packages/experimental/src/EventLog.ts:408-472` where `Identity` and `EventLog` are both defined as `Context.Tag` classes with fully-namespaced string keys.

---

## Variations

```ts
import { Context, Effect } from "effect"

// 1. Class form (recommended) — PascalCase class, namespaced key.
class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

// 2. GenericTag function form — module-level constant, no class.
interface DatabaseService {
  readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>>
}
const DatabaseTag = Context.GenericTag<DatabaseService>("app/Database")

// 3. Reference — tag with a built-in default value.
class LogLevel extends Context.Reference<LogLevel>()(
  "app/LogLevel",
  { defaultValue: () => "info" as const }
) {}

// 4. Effect.Service (experimental) — tag + implementation in one class.
class Greeter extends Effect.Service<Greeter>()("app/Greeter", {
  sync: () => ({ greet: (name: string) => `Hello, ${name}!` })
}) {}

// 5. Yield a tag to extract the service inside Effect.gen.
const program = Effect.gen(function* () {
  const db = yield* Database  // adds Database to R; returns the service value
  return yield* db.query("SELECT 1")
})

// 6. Provide a single service value directly.
const withDb = program.pipe(
  Effect.provideService(Database, { query: () => Effect.succeed([]) })
)

// 7. Provide a service via an Effect (e.g., async initialisation).
const withDbEffect = program.pipe(
  Effect.provideServiceEffect(
    Database,
    Effect.sync(() => ({ query: () => Effect.succeed([]) }))
  )
)
```

---

## Anti-patterns

**Anti-pattern 1 — Two Tag classes sharing the same string key.**

```ts
import { Context, Effect } from "effect"

// module-a.ts
class Config extends Context.Tag("Config")<Config, { readonly timeout: number }>() {}

// module-b.ts — different file, same string
class Config extends Context.Tag("Config")<Config, { readonly retries: number }>() {}

// At runtime the context map has one "Config" slot. Whichever is provided last wins.
// The other service receives the wrong shape — a runtime error, invisible to the type checker.
```

The fix is to use unique, fully-qualified keys. Follow the Effect package convention: `"@mypackage/ServiceName"` or `"myapp/domain/ServiceName"`. Every tag in the Effect packages uses this pattern — see `repos/effect/packages/experimental/src/RateLimiter.ts:391` (`"@effect/experimental/RateLimiter/RateLimiterStore"`) for a canonical example.

**Anti-pattern 2 — Module-level singletons inside business logic.**

```ts
// database.ts — BAD
import pg from "pg"
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL })

// user-service.ts — BAD
import { pool } from "./database"

export const getUser = (id: number) =>
  pool.query("SELECT * FROM users WHERE id = $1", [id])
  // No way to inject a test double. process.env is read at import time.
```

The fix: lift the database into a Tag-keyed service. The connection string itself can also be a service (see Chapter 38 on Config). Any effect that needs the database declares it in `R`; tests provide a stub without touching module state.

```ts
import { Context, Effect } from "effect"

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string, params?: ReadonlyArray<unknown>) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

const getUser = (id: number) =>
  Effect.gen(function* () {
    const db = yield* Database
    return yield* db.query("SELECT * FROM users WHERE id = $1", [id])
  })
// getUser : (id: number) => Effect<ReadonlyArray<unknown>, never, Database>
// Tests can provideService(Database, { query: () => Effect.succeed([mockUser]) })
```

**Anti-pattern 3 — Providing services deep in the call stack.**

```ts
import { Context, Effect } from "effect"

class Database extends Context.Tag("app/Database")<
  Database,
  { readonly query: (sql: string) => Effect.Effect<ReadonlyArray<unknown>> }
>() {}

const getUser = (id: number) =>
  Effect.gen(function* () {
    // BAD: providing a service inside business logic, not at the entry point.
    const db = yield* Database
    return yield* db.query(`SELECT * FROM users WHERE id = ${id}`)
  }).pipe(
    Effect.provideService(Database, { query: () => Effect.succeed([]) }) // buried here
  )
```

Providing a service deep in a sub-effect creates a local scope for that provision. Effects called above this point still require `Database`; they do not inherit the buried stub. In tests you may provide one stub while the production entry point provides another, leading to confusing interactions. The right move: provide services at the application entry point — the `main` function or the server startup — so all sub-effects inherit from the same context.

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — introduces `R`, the requirements parameter
- [Chapter 05 — Effect.gen](05-effect-gen.md) — the generator syntax used to `yield*` Tags
- [Chapter 09 — Layer](09-layer.md) — the Layer system that constructs and wires Tag-keyed services at scale
- [Chapter 10 — Layer.scoped and Scope](10-layer-scoped-and-scope.md) — scoped service lifecycles (resource acquisition and release)
- [Chapter 11 — Constructors](11-constructors.md) — the `.make` convention for service constructors
- [Chapter 38 — Config and secrets](38-config-and-secrets.md) — typed environment loading, a natural complement to Tags
- [Patterns Catalog: Tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants)
- [Patterns Catalog: Effect.Service](../../research/02-patterns-catalog.md#effectservice-class)
- [House conventions](../../research/03-conventions.md) — naming conventions for Tag classes
- [Per-package note: effect](../../research/packages/effect.md)

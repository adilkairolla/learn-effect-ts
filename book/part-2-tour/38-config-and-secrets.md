# Chapter 38 — Config and secrets — typed environment loading

> **Package(s):** `effect`
> **Patterns introduced:** [Secret — memory-safe secret string](../../research/02-patterns-catalog.md#secret--memory-safe-secret-string), [Encoding — Base64 / hex / UTF-8 codecs](../../research/02-patterns-catalog.md#encoding--base64--hex--utf-8-codecs), [Random — testable seed-based RNG service](../../research/02-patterns-catalog.md#random--testable-seed-based-rng-service)
> **Reads from:** [Chapter 09 — Layer](../part-1-foundations/09-layer.md), [Chapter 19 — Building a CLI with @effect/cli](./19-cli.md), [Chapter 27 — SQL query builders: Drizzle and Kysely integrations](./27-sql-query-builders.md)
> **Reads into:** Part III (the worked example uses `Config.all` for cache TTL/size and `Random` for jittered eviction)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Environment loading is one of those tasks that looks simple until it breaks in production. Here is how most TypeScript services start:

```ts
// Plain TypeScript — the typical env-loading pattern
const port = parseInt(process.env.PORT ?? "3000", 10)
const dbUrl = process.env.DATABASE_URL
const debug = process.env.DEBUG === "true"

if (!dbUrl) {
  throw new Error("DATABASE_URL is required")
}

// Somewhere later, this gets logged:
console.log(`Connecting to database: ${dbUrl}`)
// → "Connecting to database: postgres://admin:s3cr3t@prod-db:5432/myapp"
```

Four problems are packed into ten lines. First, `process.env.PORT` is `string | undefined` — `parseInt` silently returns `NaN` if the variable contains something non-numeric like `"three-thousand"`, and `NaN` as a port does not cause an error until the server tries to listen. Second, the guard `if (!dbUrl)` throws a plain `Error` with a runtime stack trace rather than a structured startup failure that names every missing variable at once. Third, the database URL is now in the log stream — credentials and all. Fourth, `Math.random()` sprinkled throughout the codebase for jitter or sampling cannot be controlled in tests; every test run produces a different sequence.

The scattered nature of the problem makes it worse. `process.env.X` access is distributed across dozens of files. There is no single place to look at the full configuration schema. Missing variables surface as crashes deep in the call stack, not at startup.

Effect's `Config` system, paired with `Redacted` for credential protection and `Random` for testable randomness, replaces all four problems with a declarative, typed, testable alternative.

---

## The minimal example

```ts
import { Config, Effect } from "effect"

// Declare the shape of your config — purely declarative, no IO yet
const ServerConfig = Config.all({
  port: Config.integer("PORT"),
  host: Config.string("HOST").pipe(Config.withDefault("0.0.0.0")),
  debug: Config.boolean("DEBUG").pipe(Config.withDefault(false))
})

// Read it inside an Effect — missing/invalid variables become typed errors
const program = Effect.gen(function* () {
  const config = yield* ServerConfig
  console.log(`Listening on ${config.host}:${config.port}`)
})

// Effect.runPromise reads from process.env by default
Effect.runPromise(program)
```

`Config.all` turns a record of `Config` values into a single `Config` that reads all of them at once and reports every missing or malformed variable in one error, not just the first.

---

## Tour

### Config primitives

The `Config` type is a purely declarative description of what you need from the environment. Nothing is read until the `Config` is yielded inside an Effect. The primitives are straightforward:

- `Config.string(name?)` — reads a string value (`repos/effect/packages/effect/src/Config.ts:406`)
- `Config.integer(name?)` — reads a string and parses it as an integer, failing with a typed `ConfigError` if parsing fails (`repos/effect/packages/effect/src/Config.ts:186`)
- `Config.boolean(name?)` — reads a string and interprets `"true"` / `"1"` / `"yes"` as `true` (`repos/effect/packages/effect/src/Config.ts:130`)
- `Config.array(config, name?)` — reads a comma-separated list and maps each element through `config` (`repos/effect/packages/effect/src/Config.ts:122`)

The `name` parameter is optional. When you omit it, the config expects to be given a name by the caller — for example, via `Config.nested` or as a field in `Config.all`.

### Combinators

Several combinators transform existing `Config` values:

- `Config.withDefault(value)` — provides a fallback if the variable is missing (`repos/effect/packages/effect/src/Config.ts:504-507`)
- `Config.option` — wraps the result in `Option`, yielding `None` when the variable is absent instead of failing (`repos/effect/packages/effect/src/Config.ts:330`)
- `Config.nested(name)` — scopes a config under a prefix, so `Config.nested("DB")(Config.string("HOST"))` reads `DB_HOST` from the environment (`repos/effect/packages/effect/src/Config.ts:281-284`)
- `Config.all(record)` — combines a record of configs into one, reporting all failures together (`repos/effect/packages/effect/src/Config.ts:103-114`)

```ts
import { Config } from "effect"

// Scoped under "DATABASE_" prefix
const DbConfig = Config.all({
  host: Config.string("HOST"),
  port: Config.integer("PORT").pipe(Config.withDefault(5432)),
  name: Config.string("NAME")
}).pipe(Config.nested("DATABASE"))

// Reads DATABASE_HOST, DATABASE_PORT, DATABASE_NAME
```

### Pattern 1 — Secret and Redacted

**`Secret` is deprecated in favor of `Redacted`.** Both exist in the codebase, but `Secret` (`repos/effect/packages/effect/src/Secret.ts:1-3`) carries a `@deprecated` annotation on every export. The entire module is marked deprecated as of its introduction; `Redacted` was added in `3.3.0` as the preferred replacement. Existing code using `Config.secret` (`repos/effect/packages/effect/src/Config.ts:357-359`) will continue to work, but new code should use `Config.redacted` (`repos/effect/packages/effect/src/Config.ts:362-370`) instead.

`Redacted<A>` is a wrapper that overrides `toString`, `toJSON`, and Node.js `util.inspect` to return `"<redacted>"`. The underlying value can only be retrieved with `Redacted.value(r)`, which is an explicit opt-in. This makes accidental credential logging structurally impossible — you would have to call `Redacted.value` and then pass the result to the logger.

```ts
import { Config, Effect, Redacted } from "effect"

// Config.redacted wraps the string value in Redacted<string>
const apiKeyConfig = Config.redacted("API_KEY")

const program = Effect.gen(function* () {
  const apiKey = yield* apiKeyConfig

  // Safe: logs "<redacted>"
  console.log(`API key: ${apiKey}`)

  // Explicit opt-in to retrieve the raw string
  const rawKey = Redacted.value(apiKey)
  // rawKey: string — use it to make the HTTP request, not before

  // Wipe from memory when done (returns boolean indicating success)
  Redacted.unsafeWipe(apiKey)
})
```

Citations: `Redacted.make` at `repos/effect/packages/effect/src/Redacted.ts:75`, `Redacted.value` at `repos/effect/packages/effect/src/Redacted.ts:94`, `Redacted.unsafeWipe` at `repos/effect/packages/effect/src/Redacted.ts:118`.

### Pattern 2 — Encoding

The `Encoding` module provides pure, cross-platform codecs for Base64, hex, and URI components. These are functions — not Effects — and the decode variants return `Either<Uint8Array, DecodeException>` so parse failures are typed rather than thrown.

```ts
import { Either, Encoding } from "effect"

// Encoding — pure functions, no Effect needed
const encoded = Encoding.encodeBase64("hello world")
// → "aGVsbG8gd29ybGQ="

const decoded = Encoding.decodeBase64(encoded)
// → Either.right(Uint8Array)

// Decode failures are typed
const bad = Encoding.decodeBase64("not!!valid!!base64")
Either.match(bad, {
  onLeft: (err) => console.error(`Decode failed: ${err.message}`),
  onRight: (bytes) => console.log(`Got ${bytes.length} bytes`)
})

// Hex encoding — useful for cryptographic hashes
const hexStr = Encoding.encodeHex(new Uint8Array([0xde, 0xad, 0xbe, 0xef]))
// → "deadbeef"

const hexDecoded = Encoding.decodeHex(hexStr)
```

Citations: `encodeBase64` at `repos/effect/packages/effect/src/Encoding.ts:22-23`, `decodeBase64` at `repos/effect/packages/effect/src/Encoding.ts:31`, `encodeHex` at `repos/effect/packages/effect/src/Encoding.ts:72-73`, `decodeHex` at `repos/effect/packages/effect/src/Encoding.ts:81`.

`Encoding` is particularly useful when a `Redacted` token needs to be serialized for transport (for example, an Authorization header) without leaking the raw bytes elsewhere. You call `Redacted.value(token)` exactly once, encode, transmit, and then wipe.

### Pattern 3 — Random

The `Random` module is a service rather than a set of free functions. The module exports a `Context.Tag` named `Random` (`repos/effect/packages/effect/src/Random.ts:146`) alongside convenience Effects — `Random.next`, `Random.nextInt`, `Random.nextBoolean`, `Random.choice`, `Random.shuffle` — that read from whichever `Random` service is in scope.

```ts
import { Effect, Random } from "effect"

const program = Effect.gen(function* () {
  // yield* draws from the service — the type is Effect<number>
  const roll = yield* Random.next           // [0, 1)
  const die = yield* Random.nextIntBetween(1, 7)   // [1, 6]

  const items = ["alpha", "beta", "gamma"] as const
  const picked = yield* Random.choice(items) // Effect<string>

  const shuffled = yield* Random.shuffle([1, 2, 3, 4, 5])
  // → Chunk.Chunk<number>
})
```

Citations: `next` at `repos/effect/packages/effect/src/Random.ts:65`, `nextInt` at `repos/effect/packages/effect/src/Random.ts:73`, `choice` at `repos/effect/packages/effect/src/Random.ts:125-130`, `shuffle` at `repos/effect/packages/effect/src/Random.ts:107`.

In production, `Random.next` reads from the default `Random` service (a PCG-based generator seeded from system entropy). In tests, you inject a deterministic alternative with `Effect.withRandom(effect, Random.make(seed))` or by providing a layer via `Layer.setConfigProvider`. `Random.make(seed)` (`repos/effect/packages/effect/src/Random.ts:171`) creates a seeded RNG that produces the same sequence for the same seed, making random-dependent code fully reproducible.

---

## A production example

This example assembles a complete application config — typed, credentials redacted, and Random-driven jitter for cache TTL — in a single module.

```ts
import { Config, ConfigProvider, Effect, Layer, Random, Redacted } from "effect"

// ── 1. Declare the config schema ────────────────────────────────────────────

const CacheConfig = Config.all({
  maxSize: Config.integer("MAX_SIZE").pipe(Config.withDefault(1000)),
  baseTtlMs: Config.integer("BASE_TTL_MS").pipe(Config.withDefault(60_000))
}).pipe(Config.nested("CACHE"))

const DatabaseConfig = Config.all({
  host: Config.string("HOST"),
  port: Config.integer("PORT").pipe(Config.withDefault(5432)),
  name: Config.string("NAME"),
  password: Config.redacted("PASSWORD")   // Redacted<string> — never logs
}).pipe(Config.nested("DATABASE"))

const AppConfig = Config.all({
  port: Config.integer("PORT").pipe(Config.withDefault(3000)),
  apiKey: Config.redacted("API_KEY"),
  cache: CacheConfig,
  database: DatabaseConfig
})

// ── 2. Derive types from the config ─────────────────────────────────────────

type AppConfigShape = Config.Config.Success<typeof AppConfig>

// ── 3. Build the application layer ──────────────────────────────────────────

const appLayer = Layer.effectDiscard(
  Effect.gen(function* () {
    const cfg = yield* AppConfig

    // Random jitter: extend each TTL by 0-20% to spread cache expiries
    const jitter = yield* Random.nextRange(0, cfg.cache.baseTtlMs * 0.2)
    const effectiveTtlMs = Math.floor(cfg.cache.baseTtlMs + jitter)

    console.log(`Cache: capacity=${cfg.cache.maxSize}, ttl=${effectiveTtlMs}ms`)
    console.log(`Database host: ${cfg.database.host}:${cfg.database.port}`)
    console.log(`DB password: ${cfg.database.password}`)  // prints "<redacted>"

    // Use raw credentials only at the boundary — retrieve, connect, then wipe
    const rawPassword = Redacted.value(cfg.database.password)
    const rawApiKey = Redacted.value(cfg.apiKey)

    // ... pass rawPassword to the actual DB driver here ...
    // ... pass rawApiKey to the HTTP client here ...

    // Wipe after use so the strings don't linger in the closure
    Redacted.unsafeWipe(cfg.database.password)
    Redacted.unsafeWipe(cfg.apiKey)

    console.log(`Server ready on port ${cfg.port}`)
  })
)

// ── 4. Wire it all together ──────────────────────────────────────────────────

// Reads from process.env by default; Layer.launch keeps the layer alive until completion
Effect.runPromise(Effect.scoped(Layer.launch(appLayer)))
```

The key properties of this example: every primitive is typed (`integer`, `boolean`, `string`); all credentials are `Redacted` from the moment they leave the config layer; `Random.nextRange` provides jitter without touching `Math.random()`; and the entire schema is visible in one place.

---

## Variations

**1. Test config with `ConfigProvider.fromMap` and `Layer.setConfigProvider`**

```ts
import { ConfigProvider, Effect, Layer } from "effect"

const testEnv = new Map([
  ["PORT", "4000"],
  ["DATABASE_HOST", "localhost"],
  ["DATABASE_PORT", "5432"],
  ["DATABASE_NAME", "test_db"],
  ["DATABASE_PASSWORD", "test-pass"],
  ["API_KEY", "test-key"],
  ["CACHE_MAX_SIZE", "50"],
  ["CACHE_BASE_TTL_MS", "5000"]
])

const testConfigLayer = Layer.setConfigProvider(
  ConfigProvider.fromMap(testEnv)
)

// Provide this layer in tests — no process.env mutation, no global state
const testProgram = program.pipe(Effect.provide(testConfigLayer))
```

`Layer.setConfigProvider` is at `repos/effect/packages/effect/src/Layer.ts:997`. `ConfigProvider.fromMap` is at `repos/effect/packages/effect/src/ConfigProvider.ts:210`.

**2. Deterministic Random in tests**

```ts
import { Effect, Random } from "effect"

// Fixed seed — identical sequence every run
const deterministicProgram = program.pipe(
  Effect.withRandom(Random.make("test-seed-2024"))
)

// Or cycle through explicit values
const fixedProgram = program.pipe(
  Effect.withRandom(Random.fixed([0.1, 0.5, 0.9]))
)
```

`Random.make` is at `repos/effect/packages/effect/src/Random.ts:171`. `Random.fixed` is at `repos/effect/packages/effect/src/Random.ts:204`.

**3. Encoding a Redacted token for transport**

```ts
import { Encoding, Redacted } from "effect"

const bearerToken = Redacted.make("supersecret-token")

// Retrieve and encode — explicit, auditable opt-in
const authHeader = `Bearer ${Encoding.encodeBase64(Redacted.value(bearerToken))}`

// Wipe immediately
Redacted.unsafeWipe(bearerToken)
```

**4. Nested config with a prefix**

```ts
import { Config } from "effect"

const RedisConfig = Config.all({
  host: Config.string("HOST").pipe(Config.withDefault("127.0.0.1")),
  port: Config.integer("PORT").pipe(Config.withDefault(6379)),
  db: Config.integer("DB").pipe(Config.withDefault(0))
}).pipe(Config.nested("REDIS"))

// Reads REDIS_HOST, REDIS_PORT, REDIS_DB
```

**5. Optional config with `Config.option`**

```ts
import { Config, Effect, Option } from "effect"

const MaybeSlackWebhook = Config.option(Config.string("SLACK_WEBHOOK_URL"))

const program = Effect.gen(function* () {
  const webhook = yield* MaybeSlackWebhook
  if (Option.isSome(webhook)) {
    // send alert
  }
  // if absent: None — no error thrown
})
```

**6. `Config.array` for multi-value environment variables**

```ts
import { Config, Effect } from "effect"

const AllowedOrigins = Config.array(Config.string(), "ALLOWED_ORIGINS")

// ALLOWED_ORIGINS=https://app.example.com,https://admin.example.com
// → ["https://app.example.com", "https://admin.example.com"]
```

---

## Anti-patterns

**Anti-pattern 1: Scattering `process.env` reads across the codebase**

```ts
// Wrong — scattered, untyped, no validation
import { createPool } from "pg"

const pool = createPool({
  host: process.env.DB_HOST,          // possibly undefined
  port: Number(process.env.DB_PORT),  // NaN if unset
  password: process.env.DB_PASSWORD   // possibly logged accidentally
})
```

```ts
// Correct — centralized, typed, credentials redacted
import { Config, Effect, Redacted } from "effect"

const DbConfig = Config.all({
  host: Config.string("DB_HOST"),
  port: Config.integer("DB_PORT").pipe(Config.withDefault(5432)),
  password: Config.redacted("DB_PASSWORD")
})
```

**Anti-pattern 2: Using a plain string for credentials**

```ts
// Wrong — apiKey: string appears in logs, error messages, and heap dumps
const apiKey: string = process.env.OPENAI_API_KEY ?? ""
console.log(`Using API key: ${apiKey}`)  // full key in stdout
```

```ts
// Correct — Redacted<string> prints as "<redacted>" everywhere
import { Config, Redacted } from "effect"

const ApiKeyConfig = Config.redacted("OPENAI_API_KEY")
// Use Redacted.value(apiKey) only at the HTTP call boundary
```

**Anti-pattern 3: Calling `Math.random()` inside an Effect**

```ts
// Wrong — not injectable, not reproducible in tests
const jitter = Math.random() * 500
await new Promise((res) => setTimeout(res, baseDelay + jitter))
```

```ts
// Correct — Random service is injectable and deterministic under test
import { Effect, Random } from "effect"

const jitter = yield* Random.nextRange(0, 500)
yield* Effect.sleep(baseDelay + jitter)
```

**Anti-pattern 4: Eagerly throwing on missing config at module load time**

```ts
// Wrong — throws during module evaluation, test isolation is impossible
const DB_URL = process.env.DATABASE_URL!
if (!DB_URL) throw new Error("DATABASE_URL required")
```

```ts
// Correct — failure deferred to Effect startup; testable with ConfigProvider.fromMap
import { Config, Effect } from "effect"

const DbUrl = Config.string("DATABASE_URL")
const program = Effect.gen(function* () {
  const url = yield* DbUrl
  // ...
})
```

---

## See also

- [Chapter 09 — Layer](../part-1-foundations/09-layer.md) — the Layer model that `Layer.setConfigProvider` extends; Config is provided as a Layer, not a global
- [Chapter 19 — Building a CLI with @effect/cli](./19-cli.md) — `@effect/cli` builds on `Config.string` / `integer` / `boolean` for typed CLI flags; the same `Config` primitives appear there for option parsing
- [Chapter 27 — SQL query builders: Drizzle and Kysely integrations](./27-sql-query-builders.md) — introduces `Redacted` in the context of database connection strings; Chapter 38 expands on `Config.redacted` and `Redacted.unsafeWipe`
- Part III worked example — uses `Config.all` to declare cache TTL/size at startup and `Random.nextRange` for jittered eviction intervals
- [Pattern: `Config.string` / `integer` / `boolean` / `nested` / `all`](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all) — catalog entry covering the Config primitives
- [Pattern: Secret — memory-safe secret string](../../research/02-patterns-catalog.md#secret--memory-safe-secret-string) — catalog entry for the deprecated `Secret` type and its relationship to `Redacted`
- [Pattern: Encoding — Base64 / hex / UTF-8 codecs](../../research/02-patterns-catalog.md#encoding--base64--hex--utf-8-codecs) — catalog entry for pure codec functions
- [Pattern: Random — testable seed-based RNG service](../../research/02-patterns-catalog.md#random--testable-seed-based-rng-service) — catalog entry covering `Random.make`, `next`, `nextInt`, `choice`, `shuffle`
- [Pattern: Redacted — prevent secret values from leaking to logs/spans](../../research/02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans) — catalog entry for `Redacted.make` / `value` / `unsafeWipe`
- [Pattern: `ConfigProvider.fromEnv` / `fromMap` / `fromJson`](../../research/02-patterns-catalog.md#configproviderfromenv--frommap--fromjson) — catalog entry for injecting config providers in tests

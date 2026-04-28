# Chapter 12 — Option and Either: null-safety and result types without exceptions

> **Patterns introduced:** [Option — Some / None and combinators](../../research/02-patterns-catalog.md#option--some--none-and-combinators), [Either — Left / Right and combinators](../../research/02-patterns-catalog.md#either--left--right-and-combinators), [Bridging Option/Either ↔ Effect (yield*, option, either)](../../research/02-patterns-catalog.md#bridging-optioneither--effect-yield-option-either)
> **Reads from:** [Chapter 05 — Effect.gen](05-effect-gen.md), [Chapter 06 — Typed errors](06-typed-errors.md)
> **Reads into:** [Chapter 13 — Branded types](13-branded-types.md), [Chapter 14 — Schema part 1](14-schema-part-1.md)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

TypeScript has `null`, `undefined`, and the union type `T | undefined`. They give the compiler just enough to detect missing null checks — but they do not give you *value semantics*. A function that returns `User | undefined` forces every caller to write an `if`-guard before using the result. Chains of optional accesses (`user?.profile?.avatar`) work, but chaining a sequence of *operations* that each might produce nothing — parsing a query parameter, looking it up in a map, transforming the result — turns into a ladder of null checks that the compiler cannot help you compose.

```ts
// Plain TypeScript
function getDisplayName(params: URLSearchParams): string {
  const raw = params.get("userId") // string | null
  if (raw === null) return "guest"
  const user = userMap[raw]        // User | undefined
  if (user === undefined) return "guest"
  const name = user.displayName    // string | undefined
  if (name === undefined) return "guest"
  return name
}
```

Each step is independent. There is no way to say "run all three, short-circuit on the first absence, yield a fallback at the end" without writing that imperative ladder. Null-returning APIs interoperate poorly because you cannot tell whether `null` means "not found," "not initialized," or "explicitly set to nothing."

`Either` does not exist at all in standard TypeScript. Result types — computations that either succeed with a value or fail with a reason — are modeled as thrown exceptions or as ad-hoc union types like `{ ok: true; value: T } | { ok: false; error: E }`. Thrown exceptions are invisible in the type system. Ad-hoc unions work but every team invents its own shape, `map` and `flatMap` combinators must be written from scratch, and interoperating with other libraries that use a different union shape is friction.

Effect provides two algebraic data types that solve both problems:

- **`Option<A>`** — a discriminated union of `Some(value)` or `None`. It represents the presence or absence of a value. Absence has no reason attached; it simply is not there. It ships with combinators (`map`, `flatMap`, `match`, `getOrElse`) that let you chain optional operations without nested null checks.

- **`Either<A, E>`** — a discriminated union of `Right(value)` or `Left(error)`. It represents a computation that can succeed with an `A` or fail with an `E`. It ships with the same combinator API, making it the right tool for pure, synchronous fallible computations — parsing, validation, transformations — that don't need the full Effect machinery.

Both types integrate with `Effect.gen` directly. You can `yield*` an `Option` or `Either` inside a generator and the runtime handles the short-circuit for you. This chapter covers that bridge in full.

---

## The minimal example

```ts
import { Effect, Either, Option } from "effect"

// --- Option ---
const present: Option.Option<number> = Option.some(42)
const absent: Option.Option<number> = Option.none()

// Convert a nullable API boundary into a typed Option
const maybeKey: Option.Option<string> = Option.fromNullable(
  process.env["APP_KEY"] ?? null
)

// --- Either ---
const success: Either.Either<number, string> = Either.right(42)
const failure: Either.Either<number, string> = Either.left("BAD_INPUT")

// --- Both are directly yieldable in Effect.gen ---
const program = Effect.gen(function* () {
  const x = yield* present        // 42 — Some unwraps to its value
  // const y = yield* absent      // would short-circuit with NoSuchElementException
  const z = yield* success        // 42 — Right unwraps to its value
  return x + z                    // 84
})
```

Nothing is executed until you run `program` with `Effect.runPromise` or similar. The types flow through automatically: `program` has type `Effect.Effect<number, never, never>` because both `present` and `success` can never fail once constructed as `Some` / `Right`.

---

## How it works

### Part A — Option

`Option<A>` is a discriminated union defined at `repos/effect/packages/effect/src/Option.ts:40`:

```ts
export type Option<A> = None<A> | Some<A>
```

`None` has `_tag: "None"` and carries no value. `Some` has `_tag: "Some"` and carries `readonly value: A`. TypeScript's exhaustive narrowing works across both variants.

**Constructors** — four are worth knowing:

- `Option.some(value)` — wraps a value. `repos/effect/packages/effect/src/Option.ts:187`.
- `Option.none()` — the absent case. Returns `Option<never>` which widens naturally to `Option<A>` at any assignment site. `repos/effect/packages/effect/src/Option.ts:162`.
- `Option.fromNullable(x)` — the primary interop boundary. If `x` is `null` or `undefined`, returns `None`; otherwise `Some(x)`. `repos/effect/packages/effect/src/Option.ts:684-686`. Use this whenever you receive data from a nullable API (DOM, `Map.get`, legacy code).
- `Option.fromIterable(collection)` — returns `Some` of the first element or `None` for an empty iterable. `repos/effect/packages/effect/src/Option.ts:390-395`. Useful when you have an array and want at most one result.

**Combinators** — these let you chain Option-returning logic without leaving the Option world:

- `Option.map(opt, f)` — apply `f` to the value inside `Some`, leave `None` unchanged. `repos/effect/packages/effect/src/Option.ts:923-929`.
- `Option.flatMap(opt, f)` — like `map`, but `f` itself returns an `Option`. If either step is `None`, the whole result is `None`. `repos/effect/packages/effect/src/Option.ts:1047-1053`.
- `Option.match(opt, { onNone, onSome })` — pattern-match: call `onNone()` for absence, `onSome(value)` for presence. Only the object form `{ onNone, onSome }` is supported. `repos/effect/packages/effect/src/Option.ts:299-314`.
- `Option.getOrElse(opt, onNone)` — extract the value or compute a fallback. `repos/effect/packages/effect/src/Option.ts:500-506`.
- `Option.getOrNull(opt)` — extract the value or return `null`. Useful at an interop boundary leaving the Option world. `repos/effect/packages/effect/src/Option.ts:753`.
- `Option.getOrThrow(opt)` — extract or throw an `Error`. Use only in test code or initialization paths where absence is truly a programmer error. `repos/effect/packages/effect/src/Option.ts:887`.

**Typical use cases:** optional config values, dictionary lookups (`HashMap.get` returns `Option<V>`), fields that may be absent in a parsed JSON object, and any "might be missing" return type where the absence carries no additional information.

### Part B — Either

`Either<A, E>` is a discriminated union defined at `repos/effect/packages/effect/src/Either.ts:25`:

```ts
export type Either<A, E = never> = Left<E, A> | Right<E, A>
```

**Important gotcha — parameter order is right-first.** In Effect, `Either<A, E>` puts the *success type `A` first* and the *failure type `E` second*. This is the reverse of most other Either libraries (`fp-ts`, Haskell's `Data.Either`, Scala's `Either`) which put the failure on the left and write `Either<L, R>` or `Either<E, A>` with the error first. The source comment at line 39 of `repos/effect/packages/effect/src/Either.ts` reads:

```ts
// TODO(4.0): flip the order of the type parameters
```

This means the current order `Either<A, E>` is acknowledged as non-standard even within the Effect codebase. When you read `Either<number, string>` in Effect code, it means "succeeds with `number`, fails with `string`." Write it once somewhere prominent in your team's style guide.

**Constructors:**

- `Either.right(value)` — success. `repos/effect/packages/effect/src/Either.ts:120`.
- `Either.left(error)` — failure. `repos/effect/packages/effect/src/Either.ts:138`.
- `Either.fromNullable(value, onNullable)` — dual function: if `value` is non-null, wraps in `Right`; otherwise calls `onNullable(value)` (where `value` is the input, possibly null/undefined) to produce the Left value when the input is nullable. `repos/effect/packages/effect/src/Either.ts:156-163`.

**Combinators:**

- `Either.map(either, f)` — apply `f` to the `Right` value, pass `Left` through. `repos/effect/packages/effect/src/Either.ts:365-372`.
- `Either.mapLeft(either, f)` — apply `f` to the `Left` value, pass `Right` through. Useful for transforming error types at module boundaries. `repos/effect/packages/effect/src/Either.ts:350-357`.
- `Either.flatMap(either, f)` — chain another `Either`-returning function on success. Short-circuits on `Left`. `repos/effect/packages/effect/src/Either.ts:647-654`.
- `Either.match(either, { onLeft, onRight })` — pattern-match both variants. `repos/effect/packages/effect/src/Either.ts:397-412`.
- `Either.getOrElse(either, onLeft)` — extract the `Right` value or compute a fallback from the `Left`. `repos/effect/packages/effect/src/Either.ts:536-542`.
- `Either.getOrThrow(either)` — extract the `Right` or throw. Like `Option.getOrThrow`, use only at trust boundaries. `repos/effect/packages/effect/src/Either.ts:624`.

**Typical use cases:** parsing raw strings into typed values, field-level validation where the error carries the reason, pure transformation pipelines where you want a typed failure without spinning up an `Effect`.

### Part C — Bridging Option/Either into Effect

Both `Option<A>` and `Either<A, E>` are bridged to the Effect runtime through two coordinated mechanisms. **At runtime:** `EffectPrototype` is spread into `Option`'s `CommonProto` (`repos/effect/packages/effect/src/internal/option.ts:15`) and `Either`'s `CommonProto` (`repos/effect/packages/effect/src/internal/either.ts:21`), so instances actually behave like Effects when the runtime walks them. **At compile time:** `Effect.ts:186-218` uses TypeScript's `declare module` augmentation to extend `Some`/`None`/`Right`/`Left` interfaces with `extends Effect<A, E>`, which is what makes `yield*` type-check. That makes them directly yieldable inside `Effect.gen` — no adapter function needed. This is **the** idiom; there is no `Effect.fromOption` or `Effect.fromEither` named export. Searching for those names will return nothing.

**`yield* someOption` — lift an Option into Effect:**

When you write `const x = yield* someOption` inside `Effect.gen`, the runtime checks the `_tag`. If it is `"Some"`, `x` is bound to the inner value and execution continues. If it is `"None"`, the generator is short-circuited with a `Cause.NoSuchElementException` failure. Importantly, `Some<A>` is typed as `extends Effect<A, Cause.NoSuchElementException>`, so the type of the overall `Effect.gen` block will include `NoSuchElementException` in its `E` channel whenever you `yield*` an `Option` — even if the `Option` is always `Some` at runtime. Chapter 05 notes this typing artifact explicitly.

**`yield* eitherValue` — lift an Either into Effect:**

`const x = yield* eitherValue` binds the `Right` value on success. On `Left`, the generator short-circuits and the `Left` value becomes the typed failure in the `E` channel. If `eitherValue: Either<number, ParseError>`, a `Left` will fail the generator with a `ParseError`.

**`Effect.option(effect)` — wrap Effect into Option:**

This is the inverse direction: it runs an effect and wraps the outcome. If the effect succeeds with `A`, the result is `Some(A)`. If the effect fails for any typed reason, the result is `None`. The returned effect has type `Effect<Option<A>, never, R>` — the `E` channel becomes `never`. Cite: `repos/effect/packages/effect/src/Effect.ts:8109`.

```ts
import { Effect, Option } from "effect"

declare const lookupUser: (id: string) => Effect.Effect<{ name: string }, Error>

const safeUser = Effect.option(lookupUser("u-1"))
// safeUser: Effect.Effect<Option.Option<{ name: string }>, never, never>
```

Use `Effect.option` when you want to treat a failing Effect as "absent" without caring about the reason.

**`Effect.either(effect)` — wrap Effect into Either:**

Captures both outcomes. Success becomes `Right(A)`, typed failure becomes `Left(E)`. The returned effect has type `Effect<Either<A, E>, never, R>`. Cite: `repos/effect/packages/effect/src/Effect.ts:8180`.

```ts
import { Effect, Either } from "effect"

declare const parse: (s: string) => Effect.Effect<number, Error>

const result = Effect.either(parse("not-a-number"))
// result: Effect.Effect<Either.Either<number, Error>, never, never>
```

Use `Effect.either` when you need to pass the outcome of an effect to a function that expects an `Either` — for example, a request resolver that must fill both resolved and rejected slots.

**`Exit.fromOption` / `Exit.fromEither` — convert to Exit:**

These produce an `Exit` value (the outcome type of a fiber) from an `Option` or `Either`. `Exit.fromOption` is `repos/effect/packages/effect/src/Exit.ts:242`; `Exit.fromEither` is `repos/effect/packages/effect/src/Exit.ts:234`. These are mainly useful in test code when you want to assert the exit of a computation without actually running an Effect runtime.

**Important — these functions do NOT exist:**

- `Effect.fromOption` — no such export.
- `Effect.fromEither` — no such export.
- `Effect.getOrFail` — no such export.

The right idiom for lifting an `Option` or `Either` into an `Effect` is to `yield*` it directly inside `Effect.gen`. If you are outside a generator and need to convert a `Left` into a typed failure, pattern-match explicitly with `Either.match` and produce an `Effect.fail` or `Effect.succeed`.

---

## A production example

Here is a small configuration-loading pipeline that uses both `Either` and `Option`, composes them with their combinators, and then bridges into `Effect` for the final program.

```ts
import { Effect, Either, Option } from "effect"

// ---- Domain types ----

interface AppConfig {
  port: number
  host: string
  debug: boolean
}

// ---- Pure validation with Either — no Effect machinery needed ----

const parsePort = (raw: string): Either.Either<number, string> => {
  const n = parseInt(raw, 10)
  return isNaN(n) || n < 1 || n > 65535
    ? Either.left(`invalid port: ${raw}`)
    : Either.right(n)
}

const parseHost = (raw: string): Either.Either<string, string> =>
  raw.trim().length === 0
    ? Either.left("host must not be empty")
    : Either.right(raw.trim())

// ---- Optional field with Option ----

const parseDebugFlag = (raw: string | undefined): Option.Option<boolean> =>
  Option.fromNullable(raw).pipe(
    Option.map((s) => s === "true" || s === "1")
  )

// ---- Read from env — nullable boundaries become Option ----

const readEnv = (key: string): Option.Option<string> =>
  Option.fromNullable(process.env[key])

// ---- Compose: build config inside Effect.gen ----

const loadConfig: Effect.Effect<AppConfig, string> = Effect.gen(function* () {
  // yield* Option: None → NoSuchElementException.
  // We convert before yielding so the error is typed, not NoSuchElementException.
  const rawPort = Option.getOrElse(readEnv("PORT"), () => "3000")
  const rawHost = Option.getOrElse(readEnv("HOST"), () => "localhost")

  // yield* Either: Left value becomes the typed error in E.
  const port = yield* parsePort(rawPort)
  const host = yield* parseHost(rawHost)

  // Option with a sensible default — no yield* needed.
  const debug = Option.getOrElse(parseDebugFlag(process.env["DEBUG"]), () => false)

  return { port, host, debug } satisfies AppConfig
})

// ---- Run and recover ----

const main = loadConfig.pipe(
  Effect.catchAll((configError) =>
    Effect.gen(function* () {
      yield* Effect.logError(`Config error: ${configError}`)
      return { port: 3000, host: "localhost", debug: false } satisfies AppConfig
    })
  )
)

Effect.runPromise(main).then((cfg) =>
  console.log(`Starting on ${cfg.host}:${cfg.port}`)
)
```

In this example, `parsePort` and `parseHost` are pure functions that return `Either` — no async, no services, no Effect overhead. The validation logic is testable with plain calls. The `yield*` inside `Effect.gen` threads failures from those pure functions directly into the Effect's error channel. `Option.getOrElse` handles optional fields before entering the generator, keeping the `E` channel clean (no `NoSuchElementException`).

This pattern appears in the Effect codebase itself: `repos/effect/packages/effect/src/PartitionedSemaphore.ts:102-109` uses `Option.getOrElse` to look up a mutable hash-map entry, falling back to creating a new set if the entry is absent — pure, composable, and readable.

---

## Variations

**`Option.some(x)` / `Option.none()` — leaf constructors:**

```ts
import { Option } from "effect"
const found: Option.Option<number> = Option.some(42)
const missing: Option.Option<number> = Option.none()
```

**`Option.fromNullable(x)` — adapt a nullable API boundary:**

```ts
import { Option } from "effect"
const key: Option.Option<string> = Option.fromNullable(process.env["API_KEY"])
```

**`Option.match(opt, { onNone, onSome })` — exhaustive pattern match:**

```ts
import { Option } from "effect"
const label = (opt: Option.Option<number>) =>
  Option.match(opt, { onNone: () => "empty", onSome: (n) => `has ${n}` })
```

**`Option.liftPredicate` / `Either.liftPredicate` — lift a value when a predicate holds:**

If you are migrating from fp-ts and reaching for `fromPredicate`, the equivalent in Effect is `Option.liftPredicate(predicate)` (`repos/effect/packages/effect/src/Option.ts:1805`) and `Either.liftPredicate(predicate, onFalse)` (`repos/effect/packages/effect/src/Either.ts:439`). Both lift a value into `Some`/`Right` when the predicate holds, otherwise into `None` / `Left(onFalse(value))`.

```ts
import { Either, Option } from "effect"
const positiveOpt = Option.liftPredicate((n: number) => n > 0)
positiveOpt(5)   // Some(5)
positiveOpt(-1)  // None

const positiveEither = Either.liftPredicate(
  (n: number) => n > 0,
  (n) => `${n} is not positive`
)
positiveEither(5)   // Right(5)
positiveEither(-1)  // Left("-1 is not positive")
```

**`Either.right(x)` / `Either.left(e)` — leaf constructors:**

```ts
import { Either } from "effect"
const ok: Either.Either<number, string> = Either.right(42)
const err: Either.Either<number, string> = Either.left("oops")
```

**`yield* someOption` / `yield* eitherValue` — direct lift in `Effect.gen`:**

```ts
import { Effect, Either, Option } from "effect"
const program = Effect.gen(function* () {
  const n = yield* Option.some(10)             // binds 10
  const eitherValue: Either.Either<number, string> = Either.right(5)
  const m = yield* eitherValue                 // binds 5
  return n + m
})
```

**`Effect.option(eff)` / `Effect.either(eff)` — wrap an Effect's outcome:**

```ts
import { Effect } from "effect"
declare const fetchUser: (id: string) => Effect.Effect<{ name: string }, Error>

const asOption = Effect.option(fetchUser("u-1"))
// Effect<Option<{ name: string }>, never, never>

const asEither = Effect.either(fetchUser("u-1"))
// Effect<Either<{ name: string }, Error>, never, never>
```

**`Exit.fromOption(opt)` / `Exit.fromEither(either)` — convert to Exit:**

```ts
import { Either, Exit, Option } from "effect"
const exitA = Exit.fromOption(Option.some(42))      // Exit<number, void>
const exitB = Exit.fromEither(Either.right(99))      // Exit<number, never>
```

---

## Anti-patterns

### Reaching for `Effect.fromOption` or `Effect.fromEither`

```ts
import { Effect, Option } from "effect"

// Wrong: these exports do not exist. The compiler will tell you immediately,
// but the error message is cryptic ("Property 'fromOption' does not exist").
const bad = Effect.fromOption(Option.some(42), () => "no value") // does not compile
```

`Effect.fromOption`, `Effect.fromEither`, and `Effect.getOrFail` are not named exports in the `effect` package. The right idiom depends on where you are:

- Inside `Effect.gen`: `yield* someOption` / `yield* someEither`.
- Outside a generator, when you want a typed error: use `Option.match` or `Either.match` to produce `Effect.succeed` / `Effect.fail` explicitly.

```ts
import { Data, Effect, Option } from "effect"
class MissingValue extends Data.TaggedError("MissingValue")<{}> {}

// Right: explicit match → typed error, not NoSuchElementException.
const lift = (opt: Option.Option<number>): Effect.Effect<number, MissingValue> =>
  Option.match(opt, {
    onNone: () => Effect.fail(new MissingValue({})),
    onSome: (n) => Effect.succeed(n),
  })
```

### Mixing `null`/`undefined` with `Option` in the same data flow

```ts
import { Option } from "effect"

// Wrong: returning null from a function that claims to use Option causes
// callers to have to guard for both Option.None AND null.
function findUser(id: string): Option.Option<string> | null {
  if (!id) return null    // mixes idioms — pick one
  return id === "x" ? Option.none() : Option.some(id)
}
```

Pick one convention per codebase. For new code, use `Option`. Convert at the boundaries of external APIs with `Option.fromNullable`. Never let `null` / `undefined` leak past a layer that has already committed to `Option`.

### Using `Either` as the universal failure mechanism when `Effect` would be more idiomatic

```ts
import { Either } from "effect"

// Wrong: when you actually need DI, async, retries, or tracing,
// wrapping everything in Either layers adds ceremony with no benefit.
type ServiceResult<A> = Either.Either<A, string>

async function callService(url: string): Promise<ServiceResult<string>> {
  try {
    const res = await fetch(url)
    return Either.right(await res.text())
  } catch (e) {
    return Either.left(String(e))
  }
}
```

`Either` is the right tool for *pure, synchronous* operations. Once you have async calls, you need the full `Effect` error channel — typed errors, fibers, services, retries, and tracing all compose cleanly only inside `Effect`. The right move is to use `Effect.tryPromise` and let the typed error channel carry the failure:

```ts
import { Data, Effect } from "effect"
class FetchError extends Data.TaggedError("FetchError")<{ cause: unknown }> {}

const callService = (url: string): Effect.Effect<string, FetchError> =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.text()),
    catch: (cause) => new FetchError({ cause }),
  })
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — the `Effect<A, E, R>` type; the `E` channel that `yield* someEither` feeds into
- [Chapter 05 — Effect.gen](05-effect-gen.md) — how `yield*` works for Effects, Options, and Eithers; the `NoSuchElementException` typing artifact noted there
- [Chapter 06 — Typed errors](06-typed-errors.md) — `Data.TaggedError` for domain errors; `catchTag` for recovery from typed failures including those surfaced by `yield* someEither`
- [Chapter 13 — Branded types](13-branded-types.md) — `Brand.nominal` / `refined`; frequently paired with `Either`-returning parse functions that produce branded success values
- [Chapter 14 — Schema part 1](14-schema-part-1.md) — `Schema.decode` returns an `Effect` and `Schema.decodeOption` / `Schema.decodeEither` return `Option` / `Either`; all three bridging patterns appear there
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — structural equality on `Option` and `Either` values; `Data.TaggedEnum` for closed multi-variant unions
- [Patterns Catalog: Option — Some / None and combinators](../../research/02-patterns-catalog.md#option--some--none-and-combinators)
- [Patterns Catalog: Either — Left / Right and combinators](../../research/02-patterns-catalog.md#either--left--right-and-combinators)
- [Patterns Catalog: Bridging Option/Either ↔ Effect](../../research/02-patterns-catalog.md#bridging-optioneither--effect-yield-option-either)
- [Per-package note: effect](../../research/packages/effect.md)

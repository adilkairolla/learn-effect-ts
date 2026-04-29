# Chapter 39 — Match — exhaustive pattern matching

> **Package(s):** `effect`
> **Patterns introduced:** [`Match.value` / `Match.type` — starting a match](../../research/02-patterns-catalog.md#matchvalue--matchtype--starting-a-match)
> **Reads from:** [Chapter 06 — Typed errors: `Data.TaggedError` and the error channel](../part-1-foundations/06-typed-errors.md), [Chapter 18 — Data, Equal, Hash](../part-1-foundations/18-data-equal-hash.md)
> **Reads into:** Chapter 44 (Experimental patterns — Machine uses Match internally for state transitions)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Discriminated unions are one of TypeScript's best features. You define:

```ts
// Plain TypeScript — manual discriminated union
type ApiError =
  | { readonly _tag: "NetworkError";  readonly message: string; readonly status: number }
  | { readonly _tag: "ParseError";    readonly raw: string }
  | { readonly _tag: "RateLimitError"; readonly retryAfter: number }
```

Then you dispatch on them somewhere. The idiomatic tool is `switch`:

```ts
// Plain TypeScript — switch with no exhaustiveness guarantee
function describe(e: ApiError): string {
  switch (e._tag) {
    case "NetworkError":  return `HTTP ${e.status}: ${e.message}`
    case "ParseError":    return `Bad response body: ${e.raw}`
    // Forgot RateLimitError — TypeScript is silent
    default:              throw new Error(`Unhandled tag: ${(e as any)._tag}`)
  }
}
```

Three problems appear immediately. First, the `default: throw` is runtime-only protection. If you add a fourth variant to the union, TypeScript does not warn you that `describe` is now incomplete. You only find out when the throw fires in production. Second, the only way to get compile-time exhaustiveness in plain TypeScript is to call a helper like `assertNever` in the `default` branch — that pattern works, but it requires discipline and every call site must remember to add it. Third, when you want to group variants — "handle `NetworkError` and `RateLimitError` the same way" — `switch` has no clean syntax for sharing a branch without fall-through comments or duplicated `case` labels.

Nested ternaries are worse:

```ts
// Plain TypeScript — ternary nesting becomes unreadable quickly
const msg = e._tag === "NetworkError"
  ? `HTTP ${e.status}: ${e.message}`
  : e._tag === "ParseError"
  ? `Bad body: ${e.raw}`
  : (() => { throw new Error("unreachable") })()
```

And `instanceof` chains add a fourth problem: they only work with `class` hierarchies, not plain object unions. When you're using Effect's `Data.TaggedError` (as Chapter 06 introduces) or `Data.TaggedEnum` (as Chapter 18 introduces), the values are plain objects with a `_tag` discriminant — not class instances that `instanceof` can distinguish.

`Match` replaces all of this. It is a pipeable builder that accumulates clauses, narrows the remaining union at the type level after each clause, and enforces total coverage at compile time through `Match.exhaustive`. No runtime safety net, no `assertNever` ceremony — the type system stops the program from compiling if a case is missing.

---

## The minimal example

```ts
import { Match } from "effect"

type Shape =
  | { readonly _tag: "Circle";    readonly radius: number }
  | { readonly _tag: "Rectangle"; readonly width: number; readonly height: number }
  | { readonly _tag: "Triangle";  readonly base: number;  readonly height: number }

// Match.type<T>() creates a reusable function (no value in hand yet)
const area = Match.type<Shape>().pipe(
  Match.tag("Circle",    (s) => Math.PI * s.radius ** 2),
  Match.tag("Rectangle", (s) => s.width * s.height),
  Match.tag("Triangle",  (s) => 0.5 * s.base * s.height),
  Match.exhaustive    // compile error if any tag is missing
)

// area is now a plain function: (shape: Shape) => number
console.log(area({ _tag: "Circle", radius: 5 }))        // 78.53...
console.log(area({ _tag: "Rectangle", width: 4, height: 6 })) // 24
```

`Match.exhaustive` on line 12 narrows the remaining union to `never`. If you comment out the `"Triangle"` branch TypeScript reports: `Type 'Triangle' is not assignable to type 'never'` — the error appears at the `Match.exhaustive` call, not at runtime.

---

## Tour

### Two starting modes: `Match.value` vs `Match.type`

Every match expression begins with one of two constructors.

`Match.value(x)` starts a match on a specific runtime value you already hold. It is the eager form — the value is embedded in the matcher and the whole expression evaluates immediately when you call the finalizer.

```ts
import { Match } from "effect"

const input: string | number = 42

// Match.value — value already in hand, evaluates inline
// repos/effect/packages/effect/src/Match.ts:237-239
const result = Match.value(input).pipe(
  Match.when(Match.number, (n) => `number: ${n}`),
  Match.when(Match.string, (s) => `string: ${s}`),
  Match.exhaustive
)
// result: "number: 42"
```

`Match.type<T>()` starts a match on a type only, with no runtime value yet. The finalizer returns a function `(input: T) => R` that you can store, pass around, or use as an argument to `Array.map`. This is the deferred form.

```ts
import { Match } from "effect"

// Match.type — creates a reusable matcher function
// repos/effect/packages/effect/src/Match.ts:195-195
const classify = Match.type<string | number>().pipe(
  Match.when(Match.number, (n) => `number: ${n}`),
  Match.when(Match.string, (s) => `string: ${s}`),
  Match.exhaustive
)

// classify is (u: string | number) => string
const results = [1, "hello", 2, "world"].map(classify)
// ["number: 1", "string: hello", "number: 2", "string: world"]
```

The practical rule: reach for `Match.value` for a one-off inline dispatch; reach for `Match.type` when you want a named, reusable function.

### Tag-based matching: `Match.tag` and `Match.tags`

Effect's convention is to put the discriminant in a field called `_tag` (established in Chapter 06 with `Data.TaggedError` and Chapter 18 with `Data.TaggedEnum`). `Match.tag` is optimised for exactly this convention.

`Match.tag` accepts one or more tag strings followed by a handler. Passing multiple tags groups them into a single branch:

```ts
import { Match } from "effect"

type Event =
  | { readonly _tag: "Click";     readonly x: number; readonly y: number }
  | { readonly _tag: "KeyPress";  readonly key: string }
  | { readonly _tag: "Scroll";    readonly delta: number }
  | { readonly _tag: "Resize";    readonly width: number; readonly height: number }

// repos/effect/packages/effect/src/Match.ts:736-752
const handleEvent = Match.type<Event>().pipe(
  Match.tag("Click", "Scroll", (e) => `pointer: ${e._tag}`),   // groups two tags
  Match.tag("KeyPress", (e) => `key: ${e.key}`),
  Match.tag("Resize",   (e) => `resize: ${e.width}x${e.height}`),
  Match.exhaustive
)
```

When you have many tags and want to express all handlers at once as a dictionary, `Match.tags` takes an object literal where each key is a tag name:

```ts
import { Match } from "effect"

// repos/effect/packages/effect/src/Match.ts:831-848
const describeEvent = Match.type<Event>().pipe(
  Match.tags({
    Click:    (e) => `clicked at (${e.x}, ${e.y})`,
    KeyPress: (e) => `pressed ${e.key}`,
    Scroll:   (e) => `scrolled ${e.delta}px`,
    Resize:   (e) => `resized to ${e.width}x${e.height}`
  }),
  Match.exhaustive
)
```

TypeScript will flag any key in the object that is not a valid `_tag` value, so typos are caught at compile time.

### Predicate matching: `Match.when` and `Match.not`

`Match.when` is the most general clause builder. Its first argument is a pattern — it can be a plain value, a predicate function, or a partial object shape. The handler receives the narrowed type:

```ts
import { Match } from "effect"

type Measurement = { readonly value: number; readonly unit: "m" | "km" | "cm" }

// repos/effect/packages/effect/src/Match.ts:368-385
const normalise = Match.type<Measurement>().pipe(
  Match.when({ unit: "km" }, (m) => m.value * 1000),
  Match.when({ unit: "cm" }, (m) => m.value / 100),
  Match.when({ unit: "m"  }, (m) => m.value),
  Match.exhaustive
)
```

Object patterns match structurally — only the listed fields need to match. You can nest predicates inside object patterns:

```ts
import { Match } from "effect"

// Predicate inside a structural pattern
const classify = Match.type<{ score: number }>().pipe(
  Match.when({ score: (n) => n >= 90 }, () => "A"),
  Match.when({ score: (n) => n >= 80 }, () => "B"),
  Match.when({ score: (n) => n >= 70 }, () => "C"),
  Match.orElse(() => "F")
)
```

`Match.not` is the negation form. It matches anything that does _not_ match the given pattern, and the handler receives the non-matching type:

```ts
import { Match } from "effect"

// repos/effect/packages/effect/src/Match.ts:926-943
const ensureString = Match.type<string | number>().pipe(
  Match.not(Match.number, (s) => s),  // everything except number
  Match.orElse((n) => String(n))
)
```

### Type guard predicates: `Match.string`, `Match.number`, `Match.is`, and friends

`Match` ships a family of built-in refinement predicates for primitive types. These are usable as patterns anywhere a predicate is accepted:

- `Match.string` — narrows to `string` (`repos/effect/packages/effect/src/Match.ts:969-969`)
- `Match.number` — narrows to `number` (`repos/effect/packages/effect/src/Match.ts:977-977`)
- `Match.boolean` — narrows to `boolean` (`repos/effect/packages/effect/src/Match.ts:1001-1001`)
- `Match.bigint`, `Match.symbol`, `Match.date`, `Match.record`, `Match.undefined`, `Match.null`
- `Match.is(...literals)` — narrows to a specific set of literal values (`repos/effect/packages/effect/src/Match.ts:959-961`)
- `Match.instanceOf(SomeClass)` — narrows to an instance of a class (`repos/effect/packages/effect/src/Match.ts:1063-1065`)
- `Match.any` — matches any value without restriction
- `Match.defined` — matches any non-null, non-undefined value

```ts
import { Match } from "effect"

const format = Match.type<string | number | boolean | null>().pipe(
  Match.when(Match.string,  (s) => `"${s}"`),
  Match.when(Match.number,  (n) => n.toFixed(2)),
  Match.when(Match.boolean, (b) => b ? "yes" : "no"),
  Match.when(Match.null,    () => "(empty)"),
  Match.exhaustive
)
```

### Discriminated branches: `Match.discriminator` and `Match.discriminators`

When your discriminant field is not `_tag` — perhaps it's `type`, `kind`, or `action` — use `Match.discriminator(field)`:

```ts
import { Match } from "effect"

type Action =
  | { readonly type: "increment"; readonly amount: number }
  | { readonly type: "decrement"; readonly amount: number }
  | { readonly type: "reset" }

// repos/effect/packages/effect/src/Match.ts:529-542
const reduce = (state: number) =>
  Match.type<Action>().pipe(
    Match.discriminator("type")("increment", (a) => state + a.amount),
    Match.discriminator("type")("decrement", (a) => state - a.amount),
    Match.discriminator("type")("reset",     ()  => 0),
    Match.exhaustive
  )
```

`Match.discriminators(field)` collapses all branches into a single dictionary call, mirroring `Match.tags` for non-`_tag` fields:

```ts
import { Match } from "effect"

// repos/effect/packages/effect/src/Match.ts:625-644
const applyAction = (state: number) =>
  Match.type<Action>().pipe(
    Match.discriminators("type")({
      increment: (a) => state + a.amount,
      decrement: (a) => state - a.amount,
      reset:     ()  => 0
    }),
    Match.exhaustive
  )
```

### Closing a match: `Match.exhaustive`, `Match.orElse`, `Match.either`, `Match.option`

Every match expression must be closed with a finalizer that decides what to do with unmatched cases.

**`Match.exhaustive`** requires that all cases have been handled. If the remaining union is not `never` at the type level, TypeScript emits a compile error. This is the preferred finalizer whenever you can enumerate all variants. Source: `repos/effect/packages/effect/src/Match.ts:1244-1246`.

**`Match.orElse(f)`** accepts a runtime fallback for any remaining cases. It is appropriate when you intentionally handle only a subset, or when the input type is open-ended. Source: `repos/effect/packages/effect/src/Match.ts:1108-1112`.

```ts
import { Match } from "effect"

// Partial match with a fallback
const handleKnown = Match.type<string>().pipe(
  Match.when("ok",    () => "success"),
  Match.when("error", () => "failure"),
  Match.orElse((s) => `unknown status: ${s}`)
)
```

**`Match.either`** wraps the result in an `Either`. A successful match returns `Right(value)`; an unmatched case returns `Left(unmatchedValue)`. This is useful when you want to process partial matches in a pipeline without throwing:

```ts
import { Match, Either } from "effect"

// repos/effect/packages/effect/src/Match.ts:1174-1176
const getAdminRole = Match.type<{ role: "admin" | "editor" | "viewer" }>().pipe(
  Match.when({ role: "admin" },  () => "full access"),
  Match.when({ role: "editor" }, () => "edit access"),
  Match.either
  // (input) => Either<string, { role: "viewer" }>
)

const result = getAdminRole({ role: "viewer" })
// Either.isLeft(result) === true
```

**`Match.option`** wraps the result in an `Option`. A match returns `Some(value)`; no match returns `None`. Use it when absence of a match is a meaningful, expected outcome:

```ts
import { Match, Option } from "effect"

// repos/effect/packages/effect/src/Match.ts:1215-1217
const findWarning = Match.type<{ level: string; message: string }>().pipe(
  Match.when({ level: "warn" },  (log) => log.message),
  Match.when({ level: "error" }, (log) => log.message),
  Match.option
  // (input) => Option<string>
)

const opt = findWarning({ level: "info", message: "all good" })
// Option.isNone(opt) === true
```

---

## A production example

A realistic use case is routing errors from a `Data.TaggedError` union (Chapter 06) to the correct retry strategy. Here the three error types and a complete error-handling dispatcher illustrate `Match.tags`, structured grouping with `Match.tag`, and predicate matching via `Match.when`:

```ts
import { Data, Effect, Match, Schedule } from "effect"

// --- Domain errors (Data.TaggedError from Chapter 06) ---

class NetworkError extends Data.TaggedError("NetworkError")<{
  readonly status: number
  readonly message: string
}> {}

class ParseError extends Data.TaggedError("ParseError")<{
  readonly raw: string
  readonly hint: string
}> {}

class RateLimitError extends Data.TaggedError("RateLimitError")<{
  readonly retryAfter: number   // seconds
  readonly endpoint: string
}> {}

class AuthError extends Data.TaggedError("AuthError")<{
  readonly reason: "expired" | "invalid"
}> {}

type ApiError = NetworkError | ParseError | RateLimitError | AuthError

// --- Retry-strategy type ---

type RetryStrategy =
  | { readonly kind: "exponential"; readonly maxAttempts: number }
  | { readonly kind: "fixed";       readonly intervalMs: number; readonly maxAttempts: number }
  | { readonly kind: "none" }

// --- Match.tags dispatches the full union in one expression ---

// repos/effect/packages/effect/src/Match.ts:831-848
const toRetryStrategy = Match.type<ApiError>().pipe(
  Match.tags({
    // Transient network failures: exponential back-off, up to 5 attempts
    NetworkError: (e) =>
      e.status >= 500
        ? ({ kind: "exponential", maxAttempts: 5 } as RetryStrategy)
        : ({ kind: "none" } as RetryStrategy),

    // Parse errors are deterministic — retrying won't help
    ParseError: () => ({ kind: "none" } as RetryStrategy),

    // Rate-limit: fixed interval dictated by the server header
    RateLimitError: (e) => ({
      kind: "fixed",
      intervalMs: e.retryAfter * 1000,
      maxAttempts: 3
    } as RetryStrategy),

    // Expired token can be recovered by a refresh, invalid cannot
    AuthError: (e) =>
      e.reason === "expired"
        ? ({ kind: "fixed", intervalMs: 200, maxAttempts: 1 } as RetryStrategy)
        : ({ kind: "none" } as RetryStrategy)
  }),
  Match.exhaustive
)

// --- Build an Effect Schedule from the strategy ---

function scheduleFromStrategy(s: RetryStrategy): Schedule.Schedule<unknown> {
  return Match.value(s).pipe(
    Match.tag("exponential", (r) =>
      Schedule.exponential("100 millis").pipe(
        Schedule.intersect(Schedule.recurs(r.maxAttempts - 1))
      )
    ),
    Match.tag("fixed", (r) =>
      Schedule.fixed(r.intervalMs).pipe(
        Schedule.intersect(Schedule.recurs(r.maxAttempts - 1))
      )
    ),
    Match.tag("none", () => Schedule.stop),
    Match.exhaustive
  )
}

// --- Wire up in an Effect program ---

const fetchWithRetry = (url: string): Effect.Effect<string, ApiError> =>
  Effect.tryPromise({
    try: () => fetch(url).then((r) => r.text()),
    catch: (e) => new NetworkError({ status: 503, message: String(e) })
  }).pipe(
    Effect.retry(
      Schedule.identity<ApiError>().pipe(
        Schedule.mapEffect((e) =>
          Effect.sync(() => scheduleFromStrategy(toRetryStrategy(e)))
        )
      )
    )
  )
```

Key observations:

- `toRetryStrategy` is built once with `Match.type<ApiError>()` and stored as a plain function `(e: ApiError) => RetryStrategy`. It is used directly in `scheduleFromStrategy`'s caller without wrapping in an Effect.
- `scheduleFromStrategy` uses `Match.value(s)` because it already holds the strategy. It uses `Match.tag` with the `kind` discriminant via the `RetryStrategy` union shape.
- Both match expressions end with `Match.exhaustive`, so adding a fifth error type to `ApiError` or a fourth `kind` to `RetryStrategy` immediately causes a compile error at the `Match.exhaustive` call.

---

## Variations

**Match.value with primitives — inline dispatch without a helper function:**

```ts
import { Match } from "effect"

const grade = (score: number) =>
  Match.value(score).pipe(
    Match.when((n) => n >= 90, () => "A"),
    Match.when((n) => n >= 80, () => "B"),
    Match.when((n) => n >= 70, () => "C"),
    Match.orElse(() => "F")
  )
```

**Exhaustive matching of a `Data.TaggedEnum` (Chapter 18):**

```ts
import { Data, Match } from "effect"

const OrderStatus = Data.taggedEnum<{
  Pending:   {}
  Confirmed: { readonly orderId: string }
  Shipped:   { readonly trackingId: string }
  Cancelled: { readonly reason: string }
}>()

type OrderStatus = Data.TaggedEnum.Value<typeof OrderStatus>

const toLabel = Match.type<OrderStatus>().pipe(
  Match.tag("Pending",   () => "Awaiting confirmation"),
  Match.tag("Confirmed", (s) => `Order ${s.orderId} confirmed`),
  Match.tag("Shipped",   (s) => `Tracking: ${s.trackingId}`),
  Match.tag("Cancelled", (s) => `Cancelled: ${s.reason}`),
  Match.exhaustive
)
```

**Partial matcher returning `Option` — extract only the cases you care about:**

```ts
import { Match, Option } from "effect"

type LogEntry = { level: "info" | "warn" | "error"; message: string }

const extractWarning = Match.type<LogEntry>().pipe(
  Match.when({ level: "warn" },  (l) => l.message),
  Match.when({ level: "error" }, (l) => `ERROR: ${l.message}`),
  Match.option
)
// (l: LogEntry) => Option<string>  — None for "info" entries
```

**Grouped tags with shared handler via `Match.tag` variadic form:**

```ts
import { Match } from "effect"

type HttpMethod = "GET" | "HEAD" | "POST" | "PUT" | "PATCH" | "DELETE"
type MethodTag  = { readonly _tag: HttpMethod }

const isSafe = Match.type<MethodTag>().pipe(
  Match.tag("GET", "HEAD", () => true),
  Match.tag("POST", "PUT", "PATCH", "DELETE", () => false),
  Match.exhaustive
)
```

**`Match.not` for negation — handle everything except one case:**

```ts
import { Match } from "effect"

const isActive = Match.type<{ status: "active" | "inactive" | "banned" }>().pipe(
  Match.not({ status: "active" }, () => false),
  Match.orElse(() => true)
)
```

**`Match.either` for bifurcated pipeline — route matched vs unmatched differently:**

```ts
import { Effect, Match, Either } from "effect"

type Response = { readonly _tag: "Success"; readonly body: string }
              | { readonly _tag: "Failure"; readonly code: number }

const tryExtract = Match.type<Response>().pipe(
  Match.tag("Success", (r) => r.body),
  Match.either
)

const program = Effect.gen(function* () {
  const res: Response = yield* fetchResponse()
  const outcome = tryExtract(res)
  if (Either.isRight(outcome)) {
    yield* Effect.log(`Got: ${outcome.right}`)
  } else {
    yield* Effect.logError(`Failed with code: ${outcome.left.code}`)
  }
})
```

---

## Anti-patterns

**`switch` without `assertNever` in the default branch — silent missing cases:**

```ts
// WRONG — TypeScript will not warn when a new variant is added
function handle(e: ApiError): string {
  switch (e._tag) {
    case "NetworkError":  return "retry"
    case "ParseError":    return "skip"
    // RateLimitError and AuthError are silently unhandled
    default:              return "unknown"  // swallows new variants at runtime
  }
}

// CORRECT — exhaustive match fails to compile when variants are added
import { Match } from "effect"

const handle = Match.type<ApiError>().pipe(
  Match.tag("NetworkError",  () => "retry"),
  Match.tag("ParseError",    () => "skip"),
  Match.tag("RateLimitError", () => "wait"),
  Match.tag("AuthError",     () => "refresh"),
  Match.exhaustive
)
```

**`instanceof` chains on `Data.TaggedError` values — wrong tool for the job:**

```ts
// WRONG — TaggedError values are plain objects, instanceof checks do not compose
function route(e: ApiError): string {
  if (e instanceof NetworkError) return "retry"
  if (e instanceof ParseError)   return "skip"
  // instanceof works here only by coincidence of the class hierarchy
  // Adding a fifth error that is NOT a class instance breaks the chain
  throw new Error("unhandled")
}

// CORRECT — use Match.tag which works with any _tag-discriminated union
import { Match } from "effect"

const route = Match.type<ApiError>().pipe(
  Match.tag("NetworkError",  () => "retry"),
  Match.tag("ParseError",    () => "skip"),
  Match.tag("RateLimitError", () => "wait"),
  Match.tag("AuthError",     () => "refresh"),
  Match.exhaustive
)
```

**Forgetting `Match.exhaustive` and using `Match.orElse(() => undefined)` as a silent catch-all:**

```ts
// WRONG — silently swallows new cases added to the union
const toLabel = Match.type<OrderStatus>().pipe(
  Match.tag("Pending", () => "pending"),
  Match.orElse(() => undefined)  // new variants vanish without warning
)

// CORRECT — be explicit: if a fallback is genuinely needed, give it a meaningful body
//           or use Match.exhaustive so the compiler flags the gap
const toLabel = Match.type<OrderStatus>().pipe(
  Match.tag("Pending",   () => "pending"),
  Match.tag("Confirmed", () => "confirmed"),
  Match.tag("Shipped",   () => "shipped"),
  Match.tag("Cancelled", () => "cancelled"),
  Match.exhaustive
)
```

**Building the matcher inside a hot loop — use `Match.type` to hoist it:**

```ts
// WRONG — rebuilds the matcher object on every call
function processEvent(e: Event): string {
  return Match.value(e).pipe(  // new Matcher allocated every call
    Match.tag("Click",    () => "click"),
    Match.tag("KeyPress", () => "key"),
    Match.exhaustive
  )
}

// CORRECT — build once with Match.type, reuse as a function
import { Match } from "effect"

const processEvent = Match.type<Event>().pipe(
  Match.tag("Click",    () => "click"),
  Match.tag("KeyPress", () => "key"),
  Match.exhaustive
)
```

---

## See also

- [Chapter 06 — Typed errors: `Data.TaggedError` and the error channel](../part-1-foundations/06-typed-errors.md) — `Data.TaggedError` creates the `_tag`-discriminated unions that `Match.tag` is optimised for; exhaustive matching of error unions is the primary use case shown in this chapter.
- [Chapter 18 — Data, Equal, Hash: structural equality, case classes, and collections](../part-1-foundations/18-data-equal-hash.md) — `Data.TaggedEnum` produces discriminated union types and constructors; combine with `Match.type<TaggedEnum>()` and `Match.tag` for exhaustive dispatch over every variant.
- [Chapter 12 — Option and Either: null-safety and result types without exceptions](../part-1-foundations/12-option-and-either.md) — `Match.option` and `Match.either` return `Option<A>` and `Either<A, R>` respectively; familiarity with those types (introduced in Chapter 12) is assumed when choosing the right finalizer.
- Chapter 44 — Experimental patterns — Machine, PersistedCache, EventLog: `@effect/experimental`'s `Machine` type uses `Match.type` internally to dispatch incoming messages onto state-specific handlers; the match-based state machine pattern is a natural extension of what this chapter introduces.
- [Patterns catalog — `Match.value` / `Match.type` — starting a match](../../research/02-patterns-catalog.md#matchvalue--matchtype--starting-a-match) — the full pattern entry with signature, where-it-appears citations, and the anti-pattern it replaces.
- [Patterns catalog — `Match.when` / `not` / `exhaustive` — clauses and finalizers](../../research/02-patterns-catalog.md#matchwhen--not--exhaustive--clauses-and-finalizers) — the companion entry covering the clause combinators and finalizers in depth.
- [Per-package note: `research/packages/effect.md`](../../research/packages/effect.md) — the `Match` module is listed under "Other utilities" in the `effect` package overview; the source file is `repos/effect/packages/effect/src/Match.ts`.

# Chapter 15 — Schema part 2: transforms, refinements, and brand integration

> **Patterns introduced:** [`Schema.transform` / `transformOrFail`](../../research/02-patterns-catalog.md#schematransform--transformorfail), [`Schema.brand` / `filter` — constraints](../../research/02-patterns-catalog.md#schemabrand--filter--constraints)
> **Reads from:** [Chapter 13 — Branded types](13-branded-types.md), [Chapter 14 — Schema part 1](14-schema-part-1.md)
> **Reads into:** Part II tours — every package uses these
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 14 established that `Schema` is the answer to TypeScript's runtime type gap — a single declaration that produces both a compile-time type and a runtime validator. But that chapter only covered _validation_: confirming that a value matches a declared shape.

Real applications need more. Data at runtime is messy in ways that pure shape-checking cannot address:

- Dates arrive as ISO strings from JSON APIs, but the domain code needs `Date` objects.
- Port numbers arrive as strings in environment variables, but the service needs integers bounded between 1 and 65535.
- User IDs arrive as plain strings from the database, but the type system should prevent them from being passed where an `OrderId` is required.
- A boolean field in a legacy API is encoded as `"true"` or `"false"`, not an actual JSON boolean.

Plain TypeScript addresses this with a patchwork of conversions that are scattered across the codebase:

```ts
// Manual parse-and-validate — repeated at every boundary
const portStr = process.env.PORT ?? "3000"
const port = parseInt(portStr, 10)
if (isNaN(port) || port < 1 || port > 65535) {
  throw new Error(`Invalid port: ${portStr}`)
}

// Manual conversion — disconnected from type declarations
const user = await fetchUser()
const createdAt = new Date(user.createdAt) // string from JSON → Date
const userId = user.id as UserId           // unsafe cast for nominal safety
```

Three layers of pain:
1. **Parse and convert are separate steps.** Validation libraries like Zod or ajv tell you whether a value matches a schema, but they do not convert between forms. You do the conversion separately, which means the schema and the conversion can drift.
2. **Encoded and decoded forms share no type-level contract.** Nothing enforces that the function converting `string → Date` is the inverse of the function converting `Date → string`. A schema that decodes incoming data and encodes outgoing data should guarantee this symmetry.
3. **Nominal safety at parse boundaries requires unsafe casts.** The only way to get a branded `UserId` from a raw string in plain TypeScript is an `as` cast — exactly what Chapter 14 identified as a runtime bomb.

Effect's `Schema` answers all three problems in one design: a `Schema<A, I, R>` is inherently _bidirectional_. `A` is the decoded (domain) type; `I` is the encoded (wire) type. When `A ≠ I`, there is a transformation registered on the schema — and `Schema.transform` / `Schema.transformOrFail` are how you author those transformations. `Schema.brand` and `Schema.filter` add constraints on top.

---

## The minimal example

```ts
import { ParseResult, Schema } from "effect"

// Pure transform: strip a prefix before parsing to number
const PrefixedNumber = Schema.transform(
  Schema.String,   // From (encoded / wire form)
  Schema.Number,   // To   (decoded / domain form)
  {
    decode: (s, _i) => Number(s.replace("PRE-", "")),
    encode: (n, _a) => `PRE-${n}`,
    strict: true,
  }
)

// Fallible transform: parse a number string, fail with a typed issue on NaN
const NumberFromStringFallible = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _options, ast) => {
      const n = Number(s)
      return Number.isNaN(n)
        ? ParseResult.fail(new ParseResult.Type(ast, s, "not a valid number"))
        : ParseResult.succeed(n)
    },
    encode: (_n, _options, _ast, _toA) => ParseResult.succeed(String(_n)),
    strict: true,
  }
)
```

---

## How it works

### Part A — `Schema.transform`

`Schema.transform` creates a new schema by attaching pure (non-throwing, non-async) mapping functions to an existing pair of schemas. The declaration is at `repos/effect/packages/effect/src/Schema.ts:3940-3965`:

```ts
/**
 * Create a new `Schema` by transforming the input and output of an existing `Schema`
 * using the provided mapping functions.
 *
 * @category transformations
 * @since 3.10.0
 */
export const transform: {
  <To extends Schema.Any, From extends Schema.Any>(
    from: From,
    to: To,
    options: {
      readonly decode: (fromA: Schema.Type<From>, fromI: Schema.Encoded<From>) => Schema.Encoded<To>
      readonly encode: (toI: Schema.Encoded<To>, toA: Schema.Type<To>) => Schema.Type<From>
      readonly strict?: true
    }
  ): transform<From, To>
  // ... strict: false overload omitted for brevity
}
```

The callback signatures for `transform` are:
- `decode: (fromA, fromI) => toI` — runs when going from encoded form to decoded form. `fromA` is the already-decoded value from the _from_ schema; `fromI` is the original encoded input.
- `encode: (toI, toA) => fromA` — runs when going from decoded form back to encoded form. `toI` is the encoded value of the _to_ schema; `toA` is the typed (decoded) value.

The `strict: true` option (the default) enforces that the decode return type must match `Schema.Encoded<To>` exactly. Setting `strict: false` loosens this to `unknown` — useful when authoring reusable combinators whose type parameters are not fully constrained at definition time.

Internally, `transform` is implemented in terms of `transformOrFail` — it wraps the pure functions in `ParseResult.succeed` calls (`repos/effect/packages/effect/src/Schema.ts:3976-3984`). This means `transform` is syntactic sugar for the fallible version.

Common uses: ISO date strings to `Date` objects, snake_case API fields to camelCase domain fields, unit conversions, string trimming and normalization.

### Part B — `Schema.transformOrFail`

`Schema.transformOrFail` is the general case. The decode and encode callbacks return `Effect<A, ParseResult.ParseIssue, R>` instead of plain values. This allows failures to be reported as typed issues and, when needed, allows the transformation to require services.

The declaration at `repos/effect/packages/effect/src/Schema.ts:3831-3896` shows four positional parameters in each callback:

```ts
/**
 * Create a new `Schema` by transforming the input and output of an existing `Schema`
 * using the provided decoding functions.
 *
 * @category transformations
 * @since 3.10.0
 */
export const transformOrFail: {
  <To extends Schema.Any, From extends Schema.Any, RD, RE>(
    from: From,
    to: To,
    options: {
      readonly decode: (
        fromA: Schema.Type<From>,
        options: ParseOptions,
        ast: AST.Transformation,
        fromI: Schema.Encoded<From>
      ) => Effect.Effect<Schema.Encoded<To>, ParseResult.ParseIssue, RD>
      readonly encode: (
        toI: Schema.Encoded<To>,
        options: ParseOptions,
        ast: AST.Transformation,
        toA: Schema.Type<To>
      ) => Effect.Effect<Schema.Type<From>, ParseResult.ParseIssue, RE>
      readonly strict?: true
    }
  ): transformOrFail<From, To, RD | RE>
}
```

The four parameters to each callback:
1. **`fromA` / `toI`** — the primary input value coming from the upstream schema.
2. **`options: ParseOptions`** — parser options propagated from the top-level decode call (e.g., `onExcessProperty`, `errors`).
3. **`ast: AST.Transformation`** — the AST node for this transformation, used to construct `ParseIssue` values with accurate location information.
4. **`fromI` / `toA`** — the _original_ encoded/decoded value, before the upstream schema processed it. Rarely needed, but available when the raw form must be included in an error message.

**The error type is `ParseResult.ParseIssue`, not `ParseResult.ParseError`.** This is the same distinction Chapter 14 introduced: `ParseError` is the outer wrapper that rides in the `E` channel of a decoded `Effect`; `ParseIssue` is the inner tree that describes what went wrong. Inside a `transformOrFail` callback, you produce raw issues. The outer boundary wraps them.

The constructors for `ParseIssue` sub-types (`repos/effect/packages/effect/src/ParseResult.ts:29-39`):
- `new ParseResult.Type(ast, actual, message?)` — the value was the wrong type.
- `new ParseResult.Refinement(ast, actual, kind, issue?)` — a filter or brand check failed.
- `new ParseResult.Missing(ast)` — a required field was absent.

The `RD` and `RE` type parameters represent requirements that the decode and encode callbacks bring in. When non-`never`, the resulting schema's `R` parameter is also non-`never`, meaning every consumer of the schema must provide those services. Keep schemas pure wherever possible: if you need a database lookup to validate an ID, do that in the Effect that consumes the schema, not inside the schema itself.

### Part C — `Schema.brand`

`Schema.brand` attaches a nominal brand to the output type of any existing schema. The declaration is at `repos/effect/packages/effect/src/Schema.ts:3179-3214`:

```ts
/**
 * Returns a nominal branded schema by applying a brand to a given schema.
 *
 * ```
 * Schema<A> + B -> Schema<A & Brand<B>>
 * ```
 *
 * @category branding
 * @since 3.10.0
 */
export const brand = <S extends Schema.Any, B extends string | symbol>(
  brand: B,
  annotations?: Annotations.Schema<Schema.Type<S> & Brand<B>>
) =>
(self: S): brand<S, B>
```

The canonical pattern is to pipe an existing schema into `Schema.brand`:

```ts
import { Schema } from "effect"

const EntityId = Schema.NonEmptyTrimmedString.pipe(Schema.brand("EntityId"))
type EntityId = typeof EntityId.Type
// string & Brand<"EntityId">
```

This is exactly what the cluster package does at `repos/effect/packages/cluster/src/EntityId.ts:10`. Decoding a raw string through `EntityId` validates that the string is non-empty and trimmed, and the resulting value carries the `Brand<"EntityId">` phantom marker. A plain `string` cannot be accidentally passed where an `EntityId` is required.

`Schema.brand` is the schema-layer counterpart to `Brand.nominal` and `Brand.refined` from Chapter 13. The key difference: `Schema.brand` works at parse boundaries (validates and brands on decode), while `Brand.nominal` / `Brand.refined` work on already-known values inside the domain. For values that enter the system through schema-validated boundaries, `Schema.brand` is the right tool.

### Part D — `Schema.filter`

`Schema.filter` adds a runtime predicate to an existing schema without changing the decoded type. It is the right tool for constraints that cannot be expressed as structural types — non-empty strings, integers in a range, strings matching a pattern.

The primary overload at `repos/effect/packages/effect/src/Schema.ts:3703-3730`:

```ts
/**
 * @category filtering
 * @since 3.10.0
 */
export function filter<S extends Schema.Any>(
  predicate: (
    a: Schema.Type<S>,
    options: ParseOptions,
    self: AST.Refinement
  ) => FilterReturnType,
  annotations?: Annotations.Filter<Schema.Type<S>>
): (self: S) => filter<S>
```

The predicate runs after the upstream schema has decoded the value. The `FilterReturnType` (`repos/effect/packages/effect/src/Schema.ts:3687`) is `undefined | boolean | string | ParseResult.ParseIssue | FilterIssue` — returning `true` or `undefined` passes the value through; returning `false`, a string (used as an error message), or a `ParseIssue` fails it.

Built-in schemas that use `filter` internally:
- `Schema.NonEmptyString` — `String$.pipe(nonEmptyString(...))` (`repos/effect/packages/effect/src/Schema.ts:4857-4859`)
- `Schema.UUID` — `String$.pipe(pattern(uuidRegexp, ...))` (`repos/effect/packages/effect/src/Schema.ts:4877`)
- `Schema.Positive` — `Number$.pipe(positive(...))` (`repos/effect/packages/effect/src/Schema.ts:5368`)

The pattern `filter → brand → transform` is composable in any order via `.pipe()`. A refined, branded, transformed schema is just a schema — it composes with `Schema.Struct`, `Schema.Class`, and every decode entry point from Chapter 14.

---

## A production example

The following shows a config validator that combines `transformOrFail`, `filter`, and `brand` to parse a raw environment-like object into strongly typed domain values. The `transformOrFail` pattern for date strings mirrors what `@effect/sql` uses in `repos/effect/packages/sql/src/Model.ts:346-360` for its own `Date` schema.

```ts
import { Effect, ParseResult, Schema } from "effect"

// ----- DateFromString: string → Date via transformOrFail -----
// Mirrors the pattern at repos/effect/packages/sql/src/Model.ts:346-360

const DateFromString = Schema.transformOrFail(
  Schema.String,
  Schema.instanceOf(Date),
  {
    decode: (s, _options, ast) => {
      const d = new Date(s)
      return isNaN(d.getTime())
        ? ParseResult.fail(new ParseResult.Type(ast, s, `"${s}" is not a valid date string`))
        : ParseResult.succeed(d)
    },
    encode: (d, _options, _ast, _toA) =>
      ParseResult.succeed(d.toISOString()),
    strict: true,
  }
)

// ----- Port: number with filter (1–65535) + brand -----

const Port = Schema.Number.pipe(
  Schema.filter(
    (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
    { message: () => "Expected an integer between 1 and 65535" }
  ),
  Schema.brand("Port")
)
type Port = typeof Port.Type
// number & Brand<"Port">

// ----- AppConfig: struct that uses both transforms -----

const AppConfigSchema = Schema.Struct({
  host:      Schema.NonEmptyString,
  port:      Port,
  startedAt: DateFromString,
  apiKey:    Schema.String.pipe(Schema.brand("ApiKey")),
})
type AppConfig = typeof AppConfigSchema.Type

// ----- Decode an unknown config object -----

const rawConfig: unknown = {
  host: "localhost",
  port: 8080,
  startedAt: "2025-01-15T09:00:00.000Z",
  apiKey: "sk-secret-abc",
}

const program = Effect.gen(function* () {
  const config: AppConfig = yield* Schema.decodeUnknown(AppConfigSchema)(rawConfig)
  return config
})

// ----- Run and render errors if decode fails -----

const result = Schema.decodeUnknownSync(AppConfigSchema)({
  host: "localhost",
  port: 99999,          // out of range — will fail the filter
  startedAt: "not-a-date",
  apiKey: "sk-secret",
})
```

Running the sync version against the bad input above throws a `ParseError`. Rendering it:

```ts
import { ParseResult } from "effect"

try {
  Schema.decodeUnknownSync(AppConfigSchema)({
    host: "localhost",
    port: 99999,
    startedAt: "not-a-date",
    apiKey: "sk-secret",
  })
} catch (e) {
  if (e instanceof Error) {
    console.error(ParseResult.TreeFormatter.formatErrorSync(e as ParseResult.ParseError))
  }
}
```

The `sql` package uses this idiom for date-only fields (`repos/effect/packages/sql/src/Model.ts:346-360`): a `transformOrFail` from `Schema.String` (the encoded ISO date) to `Schema.DateTimeUtcFromSelf`, decoding via `DateTime.fromString` and stripping the time component with `DateTime.removeTime`. The encode side uses `DateTime.formatIsoDate` to produce the date-only string. The pattern is the same as our `DateFromString` above; the differences are which library type you target and which formatter you use on the encode side.

The `sql` package illustrates the `Schema.brand` pattern in a JSDoc example at `repos/effect/packages/sql/src/Model.ts:85` — `Schema.Number.pipe(Schema.brand("GroupId"))` — and uses live brand definitions throughout the package (e.g., the `EntityId` brand at `repos/effect/packages/cluster/src/EntityId.ts:10`).

---

## Variations

**`Schema.transform(from, to, { decode, encode, strict })` — pure bidirectional mapping:**

```ts
import { Schema } from "effect"
const TrimmedString = Schema.transform(
  Schema.String,
  Schema.String,
  { decode: (s) => s.trim(), encode: (s) => s, strict: true }
)
```

**`Schema.transformOrFail(from, to, { decode, encode, strict })` — fallible mapping with `ParseResult`:**

```ts
import { ParseResult, Schema } from "effect"
const IntFromString = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _opts, ast) => {
      const n = parseInt(s, 10)
      return isNaN(n)
        ? ParseResult.fail(new ParseResult.Type(ast, s, "not an integer"))
        : ParseResult.succeed(n)
    },
    encode: (n, _opts, _ast, _a) => ParseResult.succeed(String(n)),
    strict: true,
  }
)
```

**`Schema.brand("Name")` — schema-level nominal brand, applied via `.pipe()`:**

```ts
import { Schema } from "effect"
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = typeof UserId.Type // string & Brand<"UserId">
```

**`Schema.filter(predicate, annotations?)` — boolean runtime constraint:**

```ts
import { Schema } from "effect"
const EvenNumber = Schema.Number.pipe(
  Schema.filter((n) => n % 2 === 0, { message: () => "Expected an even number" })
)
```

**Built-in filter schemas — `NonEmptyString`, `Positive`, `UUID`:**

```ts
import { Schema } from "effect"
// Schema.NonEmptyString — string that is not ""
// Schema.Positive       — number > 0
// Schema.UUID           — string matching RFC 4122 UUID format
const tag: typeof Schema.UUID.Type = "550e8400-e29b-41d4-a716-446655440000" as any
```

**`Schema.NumberFromString`, `Schema.DateFromString` — built-in transforms:**

```ts
import { Schema } from "effect"
// Schema.NumberFromString: string → number (fails on NaN unless "NaN")
// Schema.DateFromString:   string → Date   (uses new Date(s), lenient)
const n = Schema.decodeUnknownSync(Schema.NumberFromString)("42") // 42
```

**`Schema.compose(s1, s2)` — chain two schemas when `s1.Type` matches `s2.Encoded`:**

```ts
import { Schema } from "effect"
// Decode a JSON string, then validate its contents as a Struct
const JsonUser = Schema.compose(
  Schema.parseJson(),
  Schema.Struct({ id: Schema.String, name: Schema.String })
)
```

---

## Anti-patterns

### Using `transformOrFail` for pure predicates

```ts
// Wrong: using transformOrFail where filter is sufficient
import { ParseResult, Schema } from "effect"

const NonEmptyStr = Schema.transformOrFail(
  Schema.String,
  Schema.String,
  {
    decode: (s, _opts, ast) =>
      s.length === 0
        ? ParseResult.fail(new ParseResult.Type(ast, s, "string is empty"))
        : ParseResult.succeed(s),
    encode: (s) => ParseResult.succeed(s),
    strict: true,
  }
)
```

`transformOrFail` here does the same work as `Schema.filter` with a fraction of the syntax. The decoded type is the same (`string`), no conversion happens, and failure is expressed as a boolean predicate. Use `Schema.filter` for yes/no constraints on the same type, `Schema.transform` for pure conversions, and `Schema.transformOrFail` only when the transformation itself can fail.

```ts
// Right: Schema.filter for a predicate that stays within the same type
import { Schema } from "effect"
const NonEmptyStr = Schema.String.pipe(
  Schema.filter((s) => s.length > 0, { message: () => "string must not be empty" })
)
```

### Using `ParseError` (the wrapper) inside a `transformOrFail` callback

```ts
// Wrong: ParseError is the outer boundary wrapper, not a ParseIssue
import { ParseResult, Schema } from "effect"

const BadSchema = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _opts, ast) => {
      const n = Number(s)
      // TypeScript error: ParseError is not assignable to ParseIssue
      return Number.isNaN(n)
        ? ParseResult.fail(new ParseResult.ParseError({ issue: new ParseResult.Type(ast, s) }))
        : ParseResult.succeed(n)
    },
    encode: (n) => ParseResult.succeed(String(n)),
    strict: true,
  }
)
```

Inside a `transformOrFail` callback the error channel expects `ParseResult.ParseIssue` — the inner tree type. `ParseError` is the wrapper applied by `Schema.decodeUnknown` and friends at the outer decode boundary. Construct issues directly:

```ts
// Right: use ParseIssue constructors inside the callback
import { ParseResult, Schema } from "effect"

const GoodSchema = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _opts, ast) => {
      const n = Number(s)
      return Number.isNaN(n)
        ? ParseResult.fail(new ParseResult.Type(ast, s, "not a valid number"))
        : ParseResult.succeed(n)
    },
    encode: (n, _opts, _ast, _a) => ParseResult.succeed(String(n)),
    strict: true,
  }
)
```

### Adding service requirements to a schema for trivial work

```ts
// Wrong: injecting a Logger service into a transform just to log a parse step
import { Effect, Schema } from "effect"
import type { Logger } from "effect"

declare const LoggerService: Logger.Logger<unknown, void>

const LoggedNumber = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _opts, ast) =>
      // R is now Logger — every consumer must provide it
      Effect.flatMap(
        Effect.log(`Parsing: ${s}`),
        () => {
          const n = Number(s)
          return Number.isNaN(n)
            ? Effect.fail(new (Schema as any).ParseResult.Type(ast, s))
            : Effect.succeed(n)
        }
      ),
    encode: (n) => Effect.succeed(String(n)),
    strict: true,
  }
)
```

When a schema's `R` is non-`never`, every decode and encode call must be run inside a runtime that provides those services. A schema is a data description that should be portable and composable. Move service work into the Effect that _consumes_ the schema, not into the schema itself:

```ts
// Right: keep the schema pure; log in the consuming Effect
import { Effect, ParseResult, Schema } from "effect"

const NumberFromStr = Schema.transformOrFail(
  Schema.String,
  Schema.Number,
  {
    decode: (s, _opts, ast) => {
      const n = Number(s)
      return Number.isNaN(n)
        ? ParseResult.fail(new ParseResult.Type(ast, s))
        : ParseResult.succeed(n)
    },
    encode: (n, _opts, _ast, _a) => ParseResult.succeed(String(n)),
    strict: true,
  }
)

const parseAndLog = (raw: unknown) =>
  Effect.gen(function* () {
    const n = yield* Schema.decodeUnknown(NumberFromStr)(raw)
    yield* Effect.log(`Parsed number: ${n}`)
    return n
  })
```

---

## See also

- [Chapter 06 — Typed errors](06-typed-errors.md) — `ParseError` is a `TaggedError` that rides in the `E` channel; `ParseIssue` is the inner tree produced by transform callbacks
- [Chapter 12 — Option and Either](12-option-and-either.md) — `Schema.decodeUnknownEither` returns `Either<A, ParseIssue>` for synchronous contexts where Effect overhead is unwanted
- [Chapter 13 — Branded types](13-branded-types.md) — `Brand.nominal` and `Brand.refined` for in-domain brands; `Schema.brand` for brands at parse boundaries
- [Chapter 14 — Schema part 1](14-schema-part-1.md) — `Schema.Struct`, `Schema.Class`, and the decode entry points that wrap transform results in `ParseError`
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — structural equality for decoded domain objects; often paired with branded schema-decoded values
- [Patterns Catalog: Schema.transform / transformOrFail](../../research/02-patterns-catalog.md#schematransform--transformorfail)
- [Patterns Catalog: Schema.brand / filter — constraints](../../research/02-patterns-catalog.md#schemabrand--filter--constraints)
- [Per-package note: effect](../../research/packages/effect.md)
- [Per-package note: cli](../../research/packages/cli.md) — `@effect/cli` uses Schema-driven argument and option parsing throughout its `Args` and `Options` modules

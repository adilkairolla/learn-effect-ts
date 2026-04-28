# Chapter 14 — Schema part 1: declaring shapes with `Struct`, `Class`, and `TaggedClass`

> **Patterns introduced:** [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct), [`Schema.Class` and `Schema.TaggedClass`](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass), [`Schema.decode` / `encode` / `is` entry points](../../research/02-patterns-catalog.md#schemadecode--encode--is-entry-points)
> **Reads from:** [Chapter 06 — Typed errors](06-typed-errors.md), [Chapter 13 — Branded types](13-branded-types.md)
> **Reads into:** [Chapter 15 — Schema part 2](15-schema-part-2.md), Part II (every package uses Schema)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

TypeScript's type system is compile-time only. It has nothing to say about values that arrive at runtime. `JSON.parse` returns `any`. `fetch` responses are `unknown` shaped blobs. Configuration files might have missing keys or wrong value types. Environment variables are always strings. The database driver returns `unknown[]`.

The gap between what TypeScript promises and what arrives at runtime is a consistent source of bugs. In plain TypeScript, the three common answers to this problem are all unsatisfying:

**Hand-rolled type guards.** You write a function like:

```ts
function isUser(x: unknown): x is User {
  return (
    typeof x === "object" && x !== null &&
    typeof (x as any).id === "string" &&
    typeof (x as any).name === "string" &&
    typeof (x as any).age === "number"
  )
}
```

This works, but it is verbose, error-prone, and completely disconnected from the `User` type definition. The two can silently diverge — add a required field to `User`, forget to update the guard, and the guard keeps returning `true` for objects that are missing the new field.

**Third-party validation libraries.** Zod, io-ts, ajv, and friends solve the redundancy problem by making the schema the source of truth for the type. But they each live in their own ecosystem. Their error types are unrelated to Effect's error channel. Mixing Zod into an Effect codebase means bridging two worlds wherever validation touches business logic.

**Unsafe casts.** The fastest path: `const user = data as User`. This leaves no trace of where the boundary was crossed and no chance of catching the error before it surfaces as a `Cannot read properties of undefined` five frames deep in a call stack.

Effect's `Schema` module is a unified answer to all three problems. You define a data shape once and get:

- the TypeScript type for compile-time safety,
- a runtime decoder that validates and transforms input,
- a runtime encoder that serializes back to wire format,
- typed errors in the `E` channel of every decode `Effect` (the same `ParseError` covered in Chapter 06),
- deep integration with `Brand` for nominal typing (Chapter 13),
- and interoperability with the entire Effect ecosystem — `@effect/cli`, `@effect/sql`, `@effect/rpc`, `@effect/ai` all accept schemas directly.

**Historical note:** Schema used to live in a separate package called `@effect/schema`. As of `effect@3.10.0`, it was merged into the core `effect` package. If you encounter code that imports from `@effect/schema`, that is pre-3.10 code. The current import is `import { Schema } from "effect"`.

---

## The minimal example

```ts
import { Effect, Schema } from "effect"

// 1. Declare a shape once
const UserSchema = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
})

// 2. Derive the TypeScript types — no separate interface needed
type UserType = Schema.Schema.Type<typeof UserSchema>
// { readonly id: string; readonly name: string; readonly age: number }

type UserEncoded = Schema.Schema.Encoded<typeof UserSchema>
// { readonly id: string; readonly name: string; readonly age: number }
// (same here — no transforms yet; Chapter 15 covers when these diverge)

// 3a. Decode synchronously — throws ParseError on failure
const alice = Schema.decodeUnknownSync(UserSchema)({
  id: "u1",
  name: "Alice",
  age: 30,
})

// 3b. Or get a typed Effect — ParseError in the E channel
const decodeUser: (input: unknown) => Effect.Effect<UserType, import("effect").ParseResult.ParseError> =
  Schema.decodeUnknown(UserSchema)

// 4. Type guard — no error, just a boolean
const guard: (u: unknown) => u is UserType = Schema.is(UserSchema)
```

---

## How it works

### Part A — `Schema.Struct`

`Schema.Struct` is the primary constructor for object schemas. It accepts a fields object whose values are themselves schemas and returns a `Struct<Fields>` — a schema that decodes objects matching those field types. The implementation lives at `repos/effect/packages/effect/src/Schema.ts:2932-2946`:

```ts
/**
 * @category constructors
 * @since 3.10.0
 */
// More-specific overload first (matches source order):
export function Struct<Fields extends Struct.Fields, const Records extends IndexSignature.NonEmptyRecords>(
  fields: Fields,
  ...records: Records
): TypeLiteral<Fields, Records>
// Plain struct overload second:
export function Struct<Fields extends Struct.Fields>(fields: Fields): Struct<Fields>
```

TypeScript resolves overloads top-to-bottom, so the more-specific NonEmptyRecords overload is listed first.

The fields object maps property names to schemas. Every schema is itself typed as `Schema<A, I, R>` where `A` is the decoded type, `I` is the encoded (input) type, and `R` is the requirements context. For primitive schemas like `Schema.String` (defined at `repos/effect/packages/effect/src/Schema.ts:1219-1250` as `class String$ extends make<string>(AST.stringKeyword) {}`), `A`, `I`, and `R` are `string`, `string`, and `never` respectively. The `R` channel matters when a schema uses services — Chapter 15 covers that case.

Optional fields use `Schema.optional`. The implementation at `repos/effect/packages/effect/src/Schema.ts:2538-2547` produces a `PropertySignature` that marks the field as not required during both decoding and encoding:

```ts
import { Schema } from "effect"

const ProfileSchema = Schema.Struct({
  username: Schema.String,
  bio: Schema.optional(Schema.String),        // string | undefined in Type
  website: Schema.optionalWith(Schema.String, { nullable: true }), // string | null | undefined
})
```

The `Struct` result also exposes `.pick(...)` and `.omit(...)` methods, which return new narrower `Struct` schemas — useful for defining insert vs. select variants of a database row type without duplicating the field definitions.

### Part B — `Schema.Class`

`Schema.Class` generates a TypeScript class that carries its schema as a static property. The implementation begins at `repos/effect/packages/effect/src/Schema.ts:8696-8734`:

```ts
/**
 * @example
 * ```ts
 * import { Schema } from "effect"
 *
 * class MyClass extends Schema.Class<MyClass>("MyClass")({
 *  someField: Schema.String
 * }) {
 *  someMethod() {
 *    return this.someField + "bar"
 *  }
 * }
 * ```
 *
 * @category classes
 * @since 3.10.0
 */
export const Class = <Self = never>(identifier: string) =>
<Fields extends Struct.Fields>(
  fieldsOr: Fields | HasFields<Fields>,
  annotations?: ClassAnnotations<Self, Simplify<Struct.Type<Fields>>>
): [Self] extends [never] ? MissingSelfGeneric<"Class">
  : Class<Self, Fields, Struct.Encoded<Fields>, Struct.Context<Fields>, Struct.Constructor<Fields>, {}, {}> =>
  makeClass({ kind: "Class", identifier, ... })
```

The curried call site is `Schema.Class<AppUser>("AppUser")({...fields})` because `Class` returns a function after the identifier argument. The calling pattern is intentionally curried in two steps:

```ts
import { Schema } from "effect"

class AppUser extends Schema.Class<AppUser>("AppUser")({
  id: Schema.String,
  name: Schema.String,
  age: Schema.Number,
}) {
  // Add methods on instances
  displayName(): string {
    return `${this.name} (${this.age})`
  }
}
```

The first call `Schema.Class<AppUser>("AppUser")` takes the self-referential type parameter and a string identifier used in error messages and serialization. The second call receives the fields. The pattern `class AppUser extends Schema.Class<AppUser>("AppUser")({ ... }) {}` is idiomatic — the class name and the string identifier are kept in sync by convention.

Constructing an instance validates the input: `new AppUser({ id: "u1", name: "alice", age: -1 })` will throw a `ParseError` if any schema constraint is violated. This makes the constructor a parse boundary automatically.

The class also participates in the Schema ecosystem: `Schema.decodeUnknown(AppUser)` works, `Schema.encode(AppUser)` works, and so does `Schema.is(AppUser)` as a type guard.

### Part C — `Schema.TaggedClass`

`Schema.TaggedClass` is like `Schema.Class` but automatically adds a `_tag` literal field. The implementation is at `repos/effect/packages/effect/src/Schema.ts:8758-8793`:

```ts
/**
 * @example
 * ```ts
 * import { Schema } from "effect"
 *
 * class MyClass extends Schema.TaggedClass<MyClass>("MyClass")("MyClass", {
 *  a: Schema.String
 * }) {}
 * ```
 *
 * @category classes
 * @since 3.10.0
 */
export const TaggedClass = <Self = never>(identifier?: string) =>
  <Tag extends string, Fields extends Struct.Fields>(
    tag: Tag,
    fieldsOr: Fields | HasFields<Fields>,
    annotations?: ClassAnnotations<...>
  ): [Self] extends [never] ? MissingSelfGeneric<"TaggedClass", `"Tag", `> : TaggedClass<Self, Tag, { readonly _tag: tag<Tag> } & Fields> => { ... }
```

The pattern has three steps in the curried call:

```ts
import { Schema } from "effect"

class UserCreated extends Schema.TaggedClass<UserCreated>()("UserCreated", {
  userId: Schema.String,
  at: Schema.String,
}) {}

// Every instance has _tag === "UserCreated" — set automatically
const evt = new UserCreated({ userId: "u1", at: "2025-01-01" })
console.log(evt._tag) // "UserCreated"
```

The `_tag` field is injected by `makeClass` using `getClassTag` (at `repos/effect/packages/effect/src/Schema.ts:8737-8738`) and given a default value matching the tag string, so callers do not pass it explicitly. The static property `UserCreated._tag` also equals `"UserCreated"`, allowing discriminated union narrowing without an instance.

`TaggedClass` is the Schema equivalent of `Data.TaggedError` (Chapter 06) and `Data.TaggedClass` (Chapter 18) — discriminated union members that decode from and encode to JSON with a stable `_tag` field. The `@effect/rpc` package uses `Schema.Class` directly at `repos/effect/packages/rpc/src/Rpc.ts:670` to build RPC payload schemas dynamically with `.primaryKey` support.

### Part D — Decode, encode, and `is` entry points

All decode and encode functions in `Schema` are curried: the first argument is the schema, the second is the value. This makes them composable in pipelines.

The entry points re-exported from `ParseResult` and defined in `Schema` (`repos/effect/packages/effect/src/Schema.ts:492-690`):

**Decoding unknown input** (the most common case at API boundaries):

- `Schema.decodeUnknown(schema)(input)` — returns `Effect<A, ParseError, R>`. Safe, composable with `Effect.gen`. Defined at `repos/effect/packages/effect/src/Schema.ts:561-568`.
- `Schema.decodeUnknownSync(schema)(input)` — synchronous, throws `ParseError` on failure. Re-exported from `repos/effect/packages/effect/src/ParseResult.ts:464-467`. Use in scripts and tests.
- `Schema.decodeUnknownEither(schema)(input)` — returns `Either<A, ParseResult.ParseIssue>` synchronously. The Either variant returns the raw `ParseIssue` (not wrapped in `ParseError`) — see Part D for the distinction. Defined at `repos/effect/packages/effect/src/ParseResult.ts:482-486`.
- `Schema.decodeUnknownOption(schema)(input)` — returns `Option<A>`. Use when the error detail does not matter, only presence.

**Decoding already-typed input:**

- `Schema.decode(schema)(input)` — a statically-typed alias of `decodeUnknown`. The runtime behavior is identical; only the input type narrows from `unknown` to the encoded type `I`. Use `decode` when you already have a value typed as `I` and want compile-time enforcement; use `decodeUnknown` for raw inputs from JSON parses, fetch responses, etc. Defined at `repos/effect/packages/effect/src/Schema.ts:599-602`.

**Encoding:**

- `Schema.encode(schema)(typed)` — converts `A → I` as an `Effect`. Defined at `repos/effect/packages/effect/src/Schema.ts:534-537`. For a plain `Struct` with no transforms, this is a no-op in terms of structure, but it still validates the input.
- `Schema.encodeSync` / `encodeEither` — sync and Either variants.

**Type guards:**

- `Schema.is(schema)` — returns `(u: unknown) => u is A`. No error, just a boolean. Re-exported from `repos/effect/packages/effect/src/ParseResult.ts:664-668`. Runs against the "type AST" (skipping transforms), so it tests shape only.

**Validation:**

- `Schema.validate(schema)(input)` — like `decodeUnknown` but skips the encoded → decoded transformation step. Used when you already have a decoded value and want to check it satisfies the schema constraints. Defined at `repos/effect/packages/effect/src/Schema.ts:626-633`.

### The `ParseError` vs `ParseIssue` distinction

This distinction was introduced in Chapter 06 and becomes concrete here.

`ParseError` is the outer wrapper. It is a `TaggedError("ParseError")` at `repos/effect/packages/effect/src/ParseResult.ts:230-260`. It holds a single `issue: ParseIssue` field and renders itself through `TreeFormatter.formatIssueSync`. This is what appears in the `E` channel of a decode `Effect` and what is thrown by the sync variants.

`ParseIssue` is the inner tree. It is a union type defined at `repos/effect/packages/effect/src/ParseResult.ts:29-39`:

```ts
export type ParseIssue =
  | Type       // wrong type for a leaf value
  | Missing    // required field absent
  | Unexpected // extra field present (in exact mode)
  | Forbidden  // access to the value is not allowed
  | Pointer    // path to the failing field
  | Refinement // a filter/brand predicate failed
  | Transformation // a transform step failed
  | Composite  // multiple issues at once
```

When you are writing custom `Schema.transformOrFail` callbacks (Chapter 15), you return `ParseResult.ParseIssue`, not `ParseError`. The `ParseError` wrapper is only applied at the outer boundary by `Schema.decodeUnknown` and friends — it is the thing that propagates through Effect's error channel. Inside the schema machinery, everything is `ParseIssue`.

To render a `ParseError` for display:

```ts
import { ParseResult } from "effect"

const rendered: string = ParseResult.TreeFormatter.formatErrorSync(parseError)
// Produces a human-readable tree, e.g.:
// └─ ["age"]
//    └─ Expected a number, actual "thirty"
```

`TreeFormatter` is defined at `repos/effect/packages/effect/src/ParseResult.ts:1746-1754`.

The AST that both `Schema` and `ParseResult` operate on lives in a separate module, `SchemaAST`, at `repos/effect/packages/effect/src/SchemaAST.ts`. It defines the `AST` union type (lines 25-50) covering all schema node kinds: `Literal`, `StringKeyword`, `TupleType`, `TypeLiteral`, `Union`, `Transformation`, and so on. For most application code you never touch the AST directly — it is an implementation detail that matters when authoring custom schemas (Chapter 15).

---

## A production example

This example validates an unknown HTTP response body, uses a branded `UserId` (Chapter 13), and defines a `TaggedClass` for a domain event. It mirrors the patterns used in `@effect/sql`'s `Model.ts` and `@effect/rpc`'s `Rpc.ts`.

```ts
import { Brand, Effect, ParseResult, Schema } from "effect"

// ----- Branded primitive (Chapter 13 integration) -----

type UserId = string & Brand.Brand<"UserId">
const UserIdSchema = Schema.String.pipe(Schema.brand("UserId"))
type UserIdType = Schema.Schema.Type<typeof UserIdSchema>
// string & Brand<"UserId">

// ----- Domain struct -----

const ApiUserSchema = Schema.Struct({
  id: UserIdSchema,
  name: Schema.String,
  email: Schema.String,
  age: Schema.Number,
  bio: Schema.optional(Schema.String),
})
type ApiUser = Schema.Schema.Type<typeof ApiUserSchema>

// ----- TaggedClass for domain events -----

class UserRegistered extends Schema.TaggedClass<UserRegistered>()("UserRegistered", {
  userId: UserIdSchema,
  email: Schema.String,
  registeredAt: Schema.String,
}) {}

// ----- Decoding a fetch response -----

const decodeApiUser = Schema.decodeUnknown(ApiUserSchema)

const fetchUser = (rawId: string): Effect.Effect<ApiUser, string> =>
  Effect.gen(function* () {
    // Simulate a JSON response from a server
    const rawBody: unknown = yield* Effect.tryPromise({
      try: () =>
        Promise.resolve({
          id: rawId,
          name: "Alice",
          email: "alice@example.com",
          age: 30,
        }),
      catch: (e) => `fetch failed: ${e}`,
    })

    const user = yield* decodeApiUser(rawBody).pipe(
      Effect.mapError((parseErr) =>
        `Invalid user response:\n${ParseResult.TreeFormatter.formatErrorSync(parseErr)}`
      )
    )

    return user
  })

// ----- Constructing a tagged event -----

const buildEvent = (user: ApiUser): UserRegistered =>
  new UserRegistered({
    userId: user.id,
    email: user.email,
    registeredAt: new Date().toISOString(),
  })

// ----- Type guard usage -----

const isApiUser = Schema.is(ApiUserSchema)

const checkPayload = (payload: unknown): string => {
  if (isApiUser(payload)) {
    // payload is now narrowed to ApiUser
    return `Valid user: ${payload.name}`
  }
  return "Not a valid user"
}
```

The `@effect/sql` package uses `Schema.Class` through its `VariantSchema` abstraction (see `repos/effect/packages/sql/src/Model.ts:109`) to generate typed rows for different SQL operations. The `@effect/rpc` package constructs `Schema.Class` instances at `repos/effect/packages/rpc/src/Rpc.ts:670` to build payload validators for each RPC endpoint.

---

## Variations

**`Schema.Struct({...})` — plain object schema, lightest option:**

```ts
import { Schema } from "effect"
const PointSchema = Schema.Struct({ x: Schema.Number, y: Schema.Number })
type Point = Schema.Schema.Type<typeof PointSchema> // { readonly x: number; readonly y: number }
```

**`Schema.Class<Self>("Name")({...})` — class form with methods:**

```ts
import { Schema } from "effect"
class Rectangle extends Schema.Class<Rectangle>("Rectangle")({
  width: Schema.Number,
  height: Schema.Number,
}) {
  area(): number { return this.width * this.height }
}
const r = new Rectangle({ width: 4, height: 5 })
console.log(r.area()) // 20
```

**`Schema.TaggedClass<Self>()("Tag", {...})` — class with automatic `_tag` discriminator:**

```ts
import { Schema } from "effect"
class OrderPlaced extends Schema.TaggedClass<OrderPlaced>()("OrderPlaced", {
  orderId: Schema.String,
  total: Schema.Number,
}) {}
const ev = new OrderPlaced({ orderId: "ord-1", total: 99.99 })
console.log(ev._tag) // "OrderPlaced"
```

**`Schema.optional(s)` / `Schema.optionalWith(s, options)` — optional fields:**

```ts
import { Schema } from "effect"
const ContactSchema = Schema.Struct({
  email: Schema.String,
  phone: Schema.optional(Schema.String),                  // string | undefined
  fax: Schema.optionalWith(Schema.String, { nullable: true }), // string | null | undefined
})
```

**`Schema.Array(s)` / `Schema.NonEmptyArray(s)` — typed array schemas:**

```ts
import { Schema } from "effect"
const TagListSchema = Schema.Array(Schema.String)           // string[]
const AtLeastOneSchema = Schema.NonEmptyArray(Schema.Number) // [number, ...number[]]
```

**`Schema.Union(s1, s2)` — discriminated unions:**

```ts
import { Schema } from "effect"
const ShapeSchema = Schema.Union(
  Schema.Struct({ kind: Schema.Literal("circle"), radius: Schema.Number }),
  Schema.Struct({ kind: Schema.Literal("rect"), width: Schema.Number, height: Schema.Number })
)
```

**Primitive schemas — the building blocks:**

```ts
import { Schema } from "effect"
// Schema.String   → string
// Schema.Number   → number
// Schema.Boolean  → boolean
// Schema.BigIntFromSelf → bigint (raw bigint; Schema.BigInt transforms string → bigint)
// Schema.Unknown  → unknown (pass-through)
// Schema.DateFromSelf → Date object (raw; Schema.Date transforms string → Date)
```

---

## Anti-patterns

### Using `as` casts at API boundaries

```ts
// Wrong: bypass validation entirely with a cast
const body = await fetch("/api/user").then((r) => r.json()) as { id: string; name: string }
processUser(body) // runtime bomb if the server shape changes
```

Every `as` cast at a network or file boundary is a deferred runtime explosion. The right move is to validate at the boundary and let the internal code be statically safe:

```ts
import { Effect, Schema } from "effect"
const ApiUserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
const body: unknown = await fetch("/api/user").then((r) => r.json())
const user = Schema.decodeUnknownSync(ApiUserSchema)(body)
// throws ParseError with a clear message if the shape is wrong
// from this point on, user is typed as { readonly id: string; readonly name: string }
```

### Defining the same shape twice

```ts
// Wrong: a TypeScript interface AND a separate runtime validator
interface User {
  id: string
  name: string
}
function isUser(x: unknown): x is User {
  return typeof x === "object" && x !== null &&
    typeof (x as any).id === "string" &&
    typeof (x as any).name === "string"
}
```

The interface and the guard will diverge the moment you add a field and forget to update one of them. Define the schema once and derive the type:

```ts
import { Schema } from "effect"
const UserSchema = Schema.Struct({ id: Schema.String, name: Schema.String })
type User = Schema.Schema.Type<typeof UserSchema>
const isUser = Schema.is(UserSchema) // free type guard, always in sync
```

### Reaching for Zod in a new Effect project

```ts
// Wrong: mixing Zod into an Effect codebase
import { z } from "zod"
const UserZod = z.object({ id: z.string(), name: z.string() })
// Now you have two error hierarchies: ZodError and ParseError
// Effect.mapError, catchTag, and the typed error channel don't know about ZodError
```

Effect's `Schema` has the same expressive power as Zod and adds deep integration with Effect's error channel, brand system, and ecosystem packages. Use `Schema` for new code; migrate Zod schemas at the boundary where data enters the Effect pipeline.

---

## See also

- [Chapter 06 — Typed errors](06-typed-errors.md) — `ParseError` sits in the `E` channel of every decode `Effect`; `Schema.decodeUnknown` is how you produce it at real boundaries
- [Chapter 12 — Option and Either](12-option-and-either.md) — `Schema.decodeUnknownEither` and `Schema.decodeUnknownOption` return `Either` / `Option` instead of an `Effect`
- [Chapter 13 — Branded types](13-branded-types.md) — `Schema.brand("Name")` integrates branding into schema decode; covered fully in Chapter 15
- [Chapter 15 — Schema part 2](15-schema-part-2.md) — transforms (`Schema.transform`, `Schema.transformOrFail`), refinements (`Schema.filter`), and brand integration in depth; also covers when `A ≠ I` and the `R` channel is non-`never`
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — `Schema.Class` and `Schema.TaggedClass` instances use reference equality by default; Chapter 18 covers `Data.Class` and how to add structural equality
- [Patterns Catalog: Schema.Struct](../../research/02-patterns-catalog.md#schemastruct)
- [Patterns Catalog: Schema.Class and TaggedClass](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass)
- [Patterns Catalog: Schema.decode / encode / is entry points](../../research/02-patterns-catalog.md#schemadecode--encode--is-entry-points)
- [Per-package note: effect](../../research/packages/effect.md)

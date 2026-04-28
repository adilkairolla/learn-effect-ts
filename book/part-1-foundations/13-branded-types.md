# Chapter 13 — Branded types: nominal typing with `Brand`

> **Patterns introduced:** [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all)
> **Reads from:** [Chapter 12 — Option and Either](12-option-and-either.md)
> **Reads into:** [Chapter 14 — Schema part 1](14-schema-part-1.md), [Chapter 15 — Schema part 2](15-schema-part-2.md), Part III (`CacheKey` in the worked example)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

TypeScript is a structurally typed language. Two types are compatible if their shapes match — the compiler does not care what you named them. This works well for most object types, but it becomes a liability when you have multiple primitive values that carry distinct meanings.

Consider a backend service that manages both users and orders. Two IDs:

```ts
// Plain TypeScript
type UserId = string
type OrderId = string

function fetchUser(id: UserId): Promise<User> { /* ... */ }
function fetchOrder(id: OrderId): Promise<Order> { /* ... */ }

const userId: UserId = "user-abc"
const orderId: OrderId = "order-xyz"

// TypeScript is happy here — both are structurally `string`
fetchUser(orderId)   // No error. Wrong call. Silent data bug.
fetchOrder(userId)   // No error. Wrong call. Silent data bug.
```

The type aliases provide no protection at all. `UserId` and `OrderId` are both `string`, so they are interchangeable everywhere. The type checker cannot catch the transposition.

Three common workarounds exist in plain TypeScript, and all fall short:

**Discriminator field (`{ __brand: 'UserId' }` intersection).** You can hand-roll a nominal type by intersecting with an object carrying a literal string field:

```ts
type UserId = string & { readonly __brand: "UserId" }
type OrderId = string & { readonly __brand: "OrderId" }
```

This works, but it is verbose. Every construction site must cast: `const u = "user-abc" as UserId`. There is no constructor to call, no validation hook to attach, and no ecosystem tooling that understands the convention. When you forget the cast, or when a raw string slips through, TypeScript allows it silently.

**Class wrappers.** Wrapping a string in a class provides nominal typing because classes use nominal (name-based) compatibility by default. But class instances have runtime overhead, are lost across serialization boundaries (a `UserId` becomes a plain string in JSON), and the constructor-call ceremony is not idiomatic for primitive-like values.

**Comments and code review.** Fragile by definition. The compiler is not involved.

Effect's `Brand` module provides a better answer: typed nominal aliases that exist only at compile time, with zero runtime cost for the pure-nominal case, and an optional runtime validation hook when the brand encodes a constraint. The ecosystem — including `Schema` — is aware of branded types, so they compose with parsing, validation, and serialization in a principled way.

---

## The minimal example

```ts
import { Brand } from "effect"

// 1. Declare the branded types
type UserId = string & Brand.Brand<"UserId">
type OrderId = string & Brand.Brand<"OrderId">

// 2. Create the constructors
const UserId = Brand.nominal<UserId>()
const OrderId = Brand.nominal<OrderId>()

// 3. Construct values — explicit at the trust boundary
const u: UserId = UserId("user-123")
const o: OrderId = OrderId("order-456")

// 4. Type-safe usage
declare function lookup(id: UserId): void

lookup(u)         // OK
lookup(o)         // TypeScript error: OrderId is not assignable to UserId
lookup("plain")   // TypeScript error: string is not assignable to UserId
```

`UserId("user-123")` is an identity function at runtime — `u` is literally the string `"user-123"`. The brand lives only in the type system. There is no wrapping, no allocation, no runtime overhead.

---

## How it works

### Part A — `Brand.nominal`

`Brand.nominal<A>()` returns a `Brand.Constructor<A>` — an object that is callable as a function and also carries `.option`, `.either`, and `.is` methods on it.

The implementation is at `repos/effect/packages/effect/src/Brand.ts:246-279`:

```ts
/**
 * This function returns a `Brand.Constructor` that **does not apply any runtime checks**, it just returns the provided value.
 * It can be used to create nominal types that allow distinguishing between two values of the same type but with different meanings.
 *
 * If you also want to perform some validation, see {@link refined}.
 *
 * @since 2.0.0
 * @category constructors
 */
export const nominal = <A extends Brand<any>>(): Brand.Constructor<A> => {
  return Object.assign((args) => args, {
    [RefinedConstructorsTypeId]: RefinedConstructorsTypeId,
    option: (args: any) => Option.some(args),
    either: (args: any) => Either.right(args),
    is: (_args: any): _args is Brand.Unbranded<A> & A => true
  })
}
```

The actual source includes a `// @ts-expect-error` directive on the `Object.assign` line — TypeScript can't verify the callable-plus-methods shape statically, so the implementation suppresses the error there. Runtime behavior is sound.

The callable form simply returns its argument unchanged. For a nominal brand, `.option` always returns `Some`, `.either` always returns `Right`, and `.is` always returns `true` — because there is no runtime constraint to check.

The type `T & Brand.Brand<"Name">` works by adding a phantom symbol field to `T`. The `Brand<K>` interface at `repos/effect/packages/effect/src/Brand.ts:56-60` is:

```ts
export interface Brand<in out K extends string | symbol> {
  readonly [BrandTypeId]: {
    readonly [k in K]: K
  }
}
```

`BrandTypeId` is a `unique symbol` (`Symbol.for("effect/Brand")`). No value at runtime ever carries this field — it is purely a TypeScript type-level declaration. TypeScript uses it to distinguish `string & Brand<"UserId">` from `string & Brand<"OrderId">` because the mapped type inside `[BrandTypeId]` produces different shapes.

A real-world example of this pattern is `File.Descriptor` in the platform package. `repos/effect/packages/platform/src/FileSystem.ts:531` declares the type as `Brand.Branded<number, "FileDescriptor">` and line 573 creates the constructor:

```ts
export const FileDescriptor = Brand.nominal<File.Descriptor>()
```

A file descriptor is a number at runtime, but the platform API never allows you to accidentally pass a plain `number` where a `File.Descriptor` is required.

### Part B — `Brand.refined`

`Brand.refined` is like `nominal` but runs a validation predicate at construction time. The full implementation is at `repos/effect/packages/effect/src/Brand.ts:188-244`.

It has two overloads:

- **Overload 1 — single-arg form:** `Brand.refined<A>(f)` where `f(unbranded) => Option<BrandErrors>` returns `None` to accept the value or `Some(errors)` to reject it. The "Option" describes what `f` returns, not what `refined` returns.
- **Overload 2 — predicate + onFailure:** `Brand.refined<A>(predicate, onFailure)` where `predicate` is a boolean test and `onFailure(unbranded) => BrandErrors` produces the error when the predicate fails.

Either overload yields a `Brand.Constructor<A>` whose call sites support `.either(value)` (returns `Either<A, BrandErrors>`), `.option(value)` (returns `Option<A>`), and `.is(value)` (returns `boolean`).

The constructor object that `refined` returns is identical in shape to `nominal`, but:
- Calling it as a function throws if validation fails.
- `.option(value)` returns `Some(branded)` on success, `None` on failure.
- `.either(value)` returns `Right(branded)` on success, `Left(BrandErrors)` on failure.
- `.is(value)` returns a type predicate, `true` only when valid.

`Brand.error(message)` at `repos/effect/packages/effect/src/Brand.ts:173-176` is the helper that creates a single-element `BrandErrors` array — the standard way to produce the failure value inside the predicate.

### Part C — `Brand.all`

`Brand.all(...brands)` combines two or more brand constructors into a single constructor whose output type is the intersection of all brands. The implementation is at `repos/effect/packages/effect/src/Brand.ts:313-352`.

When the combined constructor validates a value, it runs every constituent brand's `.either` check. Crucially, it collects **all** failures — if the value fails two brands, you get both errors in the returned `BrandErrors` array, not just the first one. This makes `Brand.all` useful for writing informative validation feedback.

The type-level constraint `Brand.EnsureCommonBase` (`repos/effect/packages/effect/src/Brand.ts:149-158`) enforces that every brand in the combination shares the same underlying primitive type — you cannot accidentally combine a string-brand with a number-brand.

### Part D — Schema integration

`Schema.brand("Name")` is the Schema-level operator that creates a branded schema. It is defined at `repos/effect/packages/effect/src/Schema.ts:3197-3200`:

```ts
export const brand = <S extends Schema.Any, B extends string | symbol>(
  brand: B,
  annotations?: Annotations.Schema<Schema.Type<S> & Brand<B>>
) => (self: S): brand<S, B>
```

It attaches a brand annotation to an existing schema's AST and widens the output type by intersecting it with `Brand<B>`. This means decode/parse produces a branded type, and encoding strips back to the base type. The cluster package uses this directly: `repos/effect/packages/cluster/src/EntityId.ts:10` defines:

```ts
export const EntityId = Schema.NonEmptyTrimmedString.pipe(Schema.brand("EntityId"))
```

`EntityId` is then both a `Schema` and a branded type — decoding validates that the string is non-empty and trimmed, and the resulting value cannot be accidentally passed where a plain `string` is required. Full coverage of `Schema.brand` and how it composes with `Schema.filter` and `Schema.transform` is in [Chapter 15 — Schema part 2](15-schema-part-2.md).

---

## A production example

The following example shows the three Brand constructors working together and integrating with `Schema`. It mirrors the pattern used in the worked example (`CacheKey` is introduced in Part III, Chapter 50).

```ts
import { Brand, Effect, Either, Schema } from "effect"

// ----- Nominal brands — pure compile-time tags -----

type UserId = string & Brand.Brand<"UserId">
type OrderId = string & Brand.Brand<"OrderId">

const UserId = Brand.nominal<UserId>()
const OrderId = Brand.nominal<OrderId>()

// ----- Refined brand — runtime validation -----

type Email = string & Brand.Brand<"Email">

const Email = Brand.refined<Email>(
  (s) => s.includes("@") && s.length > 3,
  (s) => Brand.error(`"${s}" is not a valid email address`)
)

// ----- Combined brand — must be BOTH a PositiveInt AND small -----

type PositiveInt = number & Brand.Brand<"PositiveInt">
type SmallInt = number & Brand.Brand<"SmallInt">

const PositiveInt = Brand.refined<PositiveInt>(
  (n) => Number.isInteger(n) && n > 0,
  (n) => Brand.error(`Expected a positive integer, got ${n}`)
)
const SmallInt = Brand.refined<SmallInt>(
  (n) => n < 1000,
  (n) => Brand.error(`Expected n < 1000, got ${n}`)
)

const SmallPositiveInt = Brand.all(PositiveInt, SmallInt)
// type: Brand.Constructor<PositiveInt & SmallInt>

// ----- Schema integration — parse raw input into branded values -----

const UserIdSchema = Schema.String.pipe(Schema.brand("UserId"))

const parseUserId = (raw: unknown): Effect.Effect<Schema.Schema.Type<typeof UserIdSchema>, string> =>
  Effect.gen(function* () {
    const result = yield* Schema.decodeUnknown(UserIdSchema)(raw).pipe(
      Effect.mapError((e) => `Invalid UserId: ${e.message}`)
    )
    return result
  })

// ----- Type-safety demonstration -----

declare function processOrder(userId: UserId, orderId: OrderId): void

const uid = UserId("user-42")
const oid = OrderId("order-99")

processOrder(uid, oid)    // OK
// processOrder(oid, uid) // TypeScript error — arguments are transposed

// ----- Either-returning constructor for safe construction -----

const emailResult: Either.Either<Email, Brand.BrandErrors> = Email.either("alice@example.com")
const badResult: Either.Either<Email, Brand.BrandErrors> = Email.either("not-an-email")

// emailResult is Right<Email>, badResult is Left<BrandErrors>

// ----- All errors collected by Brand.all -----

const combined = SmallPositiveInt.either(-5000)
// Left([
//   { message: "Expected a positive integer, got -5000" },
//   { message: "Expected n < 1000, got -5000" }
// ])
```

This mirrors the `EntityId` pattern from `repos/effect/packages/cluster/src/EntityId.ts` and the `FileDescriptor` pattern from `repos/effect/packages/platform/src/FileSystem.ts:573`, where nominal branding is used to make primitive-typed values domain-specific without any runtime overhead.

---

## Variations

**`Brand.nominal<T>()` — pure compile-time tag:**

```ts
import { Brand } from "effect"
type SessionToken = string & Brand.Brand<"SessionToken">
const SessionToken = Brand.nominal<SessionToken>()
const t: SessionToken = SessionToken("tok-abc123")
```

**`Brand.refined<T>(predicate, onFailure)` — runtime validation on construction:**

```ts
import { Brand } from "effect"
type Port = number & Brand.Brand<"Port">
const Port = Brand.refined<Port>(
  (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
  (n) => Brand.error(`${n} is not a valid port number`)
)
const p = Port(8080)  // Port
// Port(99999) throws BrandErrors
```

**`.either(value)` on a constructor — returns `Either<Branded, BrandErrors>` instead of throwing:**

```ts
import { Brand, Either } from "effect"
type Port = number & Brand.Brand<"Port">
const Port = Brand.refined<Port>(
  (n) => Number.isInteger(n) && n >= 1 && n <= 65535,
  (n) => Brand.error(`${n} is not a valid port number`)
)
const result: Either.Either<Port, Brand.BrandErrors> = Port.either(99999)
// Left([{ message: "99999 is not a valid port number" }])
```

**`Brand.all(b1, b2, ...)` — combine multiple brands, collect all errors:**

```ts
import { Brand } from "effect"
type Int = number & Brand.Brand<"Int">
const Int = Brand.refined<Int>((n) => Number.isInteger(n), (n) => Brand.error(`${n} is not an integer`))
type Positive = number & Brand.Brand<"Positive">
const Positive = Brand.refined<Positive>((n) => n > 0, (n) => Brand.error(`${n} is not positive`))
const PositiveInt = Brand.all(Int, Positive)
```

**`Schema.brand("Name")` — Schema-driven branding (preview of Chapter 15):**

```ts
import { Schema } from "effect"
const UserId = Schema.String.pipe(Schema.brand("UserId"))
type UserId = Schema.Schema.Type<typeof UserId>
// Schema parses and brands in one step; branded type flows through encode/decode
```

---

## Anti-patterns

### Hand-rolling brand discriminators

```ts
// Wrong: manual cast-based nominal typing
type UserId = string & { readonly __brand: unique symbol }
type OrderId = string & { readonly __brand: unique symbol }

// Every construction site requires an unsafe cast
const uid = "user-1" as unknown as UserId
```

This achieves nominal typing at the cost of ceremony and fragility. The `as unknown as UserId` cast bypasses all type safety at the construction site, and nothing stops a `string` from being passed anywhere a `UserId` is accepted if someone forgets the cast. `Brand.nominal<UserId>()` provides an explicit constructor that the type system understands, is recognized by `Schema.brand`, and is consistent across the Effect ecosystem.

### Branding everything

```ts
// Wrong: brands on every primitive, including values used in one place
import { Brand } from "effect"
type LoopCounter = number & Brand.Brand<"LoopCounter">
const LoopCounter = Brand.nominal<LoopCounter>()

for (let i = LoopCounter(0); i < 10; i++) { /* ... */ }
```

Every construction site must call the brand constructor, and every function that accepts the branded type must be typed accordingly. The overhead — in code volume and cognitive friction — is only worthwhile when the brand prevents real bugs. Apply brands to values that are frequently mixed up in practice: domain identifiers (`UserId`, `OrderId`, `ProductId`), currency amounts (`Cents`, `Dollars`), file paths (`AbsolutePath`, `RelativePath`). Skip them for counters, loop indices, and values that never leave a function body.

### Using a class wrapper for nominal typing on a primitive

```ts
// Wrong: class wrapper for a string identity, purely for nominal typing
class UserId {
  constructor(readonly value: string) {}
}
class OrderId {
  constructor(readonly value: string) {}
}

// Now you must unwrap at every serialization boundary
JSON.stringify({ userId: userId.value }) // manual .value access
```

Class wrappers are the right choice when you need methods or state on a domain object. For purely nominal distinction on a primitive, they introduce unnecessary allocation, require manual unwrapping at every serialization boundary, and are not recognized by the Schema or Brand ecosystem. Use `Brand.nominal` for the primitive case; use a class (or `Schema.Class`) only when the object genuinely needs behavior.

---

## See also

- [Chapter 12 — Option and Either](12-option-and-either.md) — `Brand.refined` constructors return `Either<Branded, BrandErrors>` via `.either()`; pairs naturally with `Either`-based parse pipelines from Chapter 12
- [Chapter 14 — Schema part 1](14-schema-part-1.md) — `Schema.Struct` and `Schema.Class` for domain models that carry branded fields
- [Chapter 15 — Schema part 2](15-schema-part-2.md) — `Schema.brand` and `Schema.filter` for schema-driven branding with full encode/decode support
- [Chapter 18 — Data, Equal, Hash](18-data-equal-hash.md) — structural equality for domain objects; complements branded primitives when you need value semantics on composite types
- [Patterns Catalog: Brand.nominal/refined/all](../../research/02-patterns-catalog.md#brandnominal--refined--all)
- [Patterns Catalog: Schema.brand / filter — constraints](../../research/02-patterns-catalog.md#schemabrand--filter--constraints)
- [Per-package note: effect](../../research/packages/effect.md)
- [Per-package note: cluster](../../research/packages/cluster.md) — `EntityId` in `repos/effect/packages/cluster/src/EntityId.ts` is a canonical real-world example of `Schema.brand` on a primitive

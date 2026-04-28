# Chapter 18 — Data, Equal, Hash: structural equality, case classes, and collections

> **Patterns introduced:** [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](../../research/02-patterns-catalog.md#datastruct--tuple--array--class--taggedclass), [`Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors), [`Equal.equals` interface and `Hash` — structural equality](../../research/02-patterns-catalog.md#equalequals-interface-and-hash--structural-equality)
> **Reads from:** [Chapter 06 — Typed errors](06-typed-errors.md), [Chapter 14 — Schema part 1](14-schema-part-1.md)
> **Reads into:** Part II Chapter 40 (Immutable collections — `HashMap`, `HashSet`, `Chunk`, `List`)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

JavaScript uses reference equality for objects. Two objects with exactly the same fields are not equal:

```ts
// Plain TypeScript — no Effect
const a = { id: 1, name: "alice" }
const b = { id: 1, name: "alice" }

console.log(a === b)           // false — different references
console.log(a == b)            // false — same
console.log(JSON.stringify(a) === JSON.stringify(b))  // true, but brittle
```

This becomes a concrete bug as soon as you try to use objects as keys in `Map` or members in `Set`. Both `Map` and `Set` use reference equality, so two structurally identical objects are treated as different entries:

```ts
// Plain TypeScript — object keys in Map do not work
const map = new Map<{ id: number }, string>()
map.set({ id: 1 }, "alice")
console.log(map.get({ id: 1 }))  // undefined — new reference, no match
```

The workarounds are all unsatisfying. `JSON.stringify` for comparison is slow, breaks with key ordering differences, fails with circular references, and produces wrong results for types that have custom serialization. Recursive deep-equality functions are boilerplate that each team writes slightly differently. Neither approach composes.

Discriminated union types in TypeScript also require manual ceremony. You write:

```ts
// Plain TypeScript — manual discriminated unions
type OrderEvent =
  | { _tag: "OrderPlaced";    orderId: string; total: number }
  | { _tag: "OrderCancelled"; orderId: string; reason: string }
  | { _tag: "OrderFulfilled"; orderId: string }
```

Every constructor is written by hand — `{ _tag: "OrderPlaced", orderId: o, total: t }` — at every call site. A typo in the tag string is only caught if you happen to pattern-match on the variant in the same file. And none of these values support structural equality, so you cannot use them as `HashSet` members without additional plumbing.

Effect's solution is a coordinated trio of modules:

- **`Data`** — constructors that attach structural-equality behaviour to plain objects, tuples, arrays, classes, and discriminated unions.
- **`Equal`** — the interface that `HashMap`, `HashSet`, and `Equal.equals` use for key comparison.
- **`Hash`** — the companion interface for hash codes; hashing and equality always travel together in an efficient map or set.

---

## The minimal example

```ts
import { Data, Equal, HashSet } from "effect"

const a = Data.struct({ id: 1, name: "alice" })
const b = Data.struct({ id: 1, name: "alice" })

console.log(a === b)             // false — different references
console.log(Equal.equals(a, b))  // true  — structural

// Effect's HashSet uses Equal.equals for membership tests
const set = HashSet.empty<typeof a>().pipe(
  HashSet.add(a),
  HashSet.add(b)   // b is Equal.equals to a, so it is not added
)
console.log(HashSet.size(set))   // 1
```

---

## How it works

### Part A — `Data.struct`, `Data.tuple`, `Data.array`

These are factory functions that wrap plain values with structural-equality traits.

- `Data.struct` (`Data.ts:47`) delegates to the implementation in `repos/effect/packages/effect/src/internal/data.ts:36`, which is `Object.assign(Object.create(StructuralPrototype), as)` — a shallow copy of all own enumerable properties onto a new object whose prototype carries the `Equal`/`Hash` traits.
- `Data.tuple` calls `unsafeArray` directly on its spread arguments (`Data.ts:76`), bypassing the defensive `as.slice(0)` copy that `Data.array` performs (`Data.ts:69`). The result is functionally identical to `Data.array` but skips a clone — appropriate because the spread arguments form a fresh array that no caller can mutate.
- `Data.array` (line 69) shallow-copies the array with `as.slice(0)` and sets its prototype to `ArrayProto`.

`StructuralPrototype` lives in `repos/effect/packages/effect/src/internal/effectable.ts:88-101` and provides two symbol-keyed methods:

```ts
// repos/effect/packages/effect/src/internal/effectable.ts:88-101
export const StructuralPrototype: Equal.Equal = {
  [Hash.symbol]() {
    return Hash.cached(this, Hash.structure(this))
  },
  [Equal.symbol](this: Equal.Equal, that: Equal.Equal) {
    // walks own enumerable keys and compares each value recursively
    ...
  }
}
```

`Hash.structure` walks the enumerable keys of the object and combines their hash codes. `Equal.symbol` walks the same keys and calls `Equal.equals` on each value pair recursively. The result: two `Data.struct` values with the same field names and equal values will produce the same hash and compare as equal — regardless of which reference you hold.

Wrapped values behave like plain JS values for reads. You can access `a.id`, `a.name`, destructure them, spread them, and they serialise normally to JSON. The only change is that `Equal.equals(a, b)` returns `true` instead of `false`.

### Part B — `Data.Class` and `Data.TaggedClass`

When you want the constructor-call ergonomics of a class alongside structural equality, `Data.Class` is the right base.

```ts
// repos/effect/packages/effect/src/Data.ts:182-205
/**
 * Provides a constructor for a Case Class.
 * @example
 *   class Person extends Data.Class<{ readonly name: string }> {}
 *   const mike1 = new Person({ name: "Mike" })
 *   const mike2 = new Person({ name: "Mike" })
 *   Equal.equals(mike1, mike2) // true
 * @since 2.0.0
 * @category constructors
 */
export const Class: new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<{ readonly [P in keyof A]: A[P] }>
) => Readonly<A> = internal.Structural as any
```

`Data.TaggedClass` (lines 207-241) wraps `Data.Class` and injects a `_tag` discriminant into every instance:

```ts
// repos/effect/packages/effect/src/Data.ts:207-241
/**
 * Provides a Tagged constructor for a Case Class.
 * @example
 *   class Person extends Data.TaggedClass("Person")<{ readonly name: string }> {}
 *   const mike1 = new Person({ name: "Mike" })
 *   mike1._tag // "Person"
 *   Equal.equals(mike1, new Person({ name: "Mike" })) // true
 * @since 2.0.0
 * @category constructors
 */
export const TaggedClass = <Tag extends string>(tag: Tag): new<A extends Record<string, any> = {}>(
  args: Types.VoidIfEmpty<...>
) => Readonly<A> & { readonly _tag: Tag } => { ... }
```

**`Data.Class` vs `Schema.Class` — which one to use?**

Both are class forms, and they are easy to confuse. Here is the rule:

- Use **`Data.Class`** when you need structural equality for domain value objects and do not need runtime parsing or encoding. It is lightweight — no schema overhead.
- Use **`Schema.Class`** (Chapter 14) when you need to parse and validate external input (JSON, environment, database rows) or encode values back to a wire format.

Under the hood, `Schema.Class` uses `Data.Class` as its base (see `repos/effect/packages/effect/src/Schema.ts:8727-8734`, where `Base: data_.Class` is passed to `makeClass`). This means every `Schema.Class` instance is *also* structurally equatable via `Equal.equals`. You get both — but if you only need value-object semantics and no schema logic, the lighter `Data.Class` form is less ceremony.

`Data.TaggedError` (covered in Chapter 06) is built on `Data.Error`, which extends `core.YieldableError` — a class extending the native `Error`. Tagged errors get the `_tag` discriminator and the yieldable-in-`Effect.gen` behavior from this chain, but they do NOT inherit `StructuralPrototype` — the `Equal.equals` and `Hash` traits do not apply to `Data.Error` instances. If you need structural equality on an error, wrap its fields in a `Data.struct` or use `Data.Class` instead. (`Data.ts:554-590`)

### Part C — `Data.TaggedEnum` (type) vs `Data.taggedEnum` (constructor)

This naming distinction is easy to miss and is the source of a common bug.

**`Data.TaggedEnum`** (PascalCase) is a **type-level** construct. It lives at `repos/effect/packages/effect/src/Data.ts:252-285`:

```ts
// repos/effect/packages/effect/src/Data.ts:252-285
/**
 * Create a tagged enum data type, which is a union of Data structs.
 * @example
 *   type HttpError = Data.TaggedEnum<{
 *     BadRequest: { readonly status: 400, readonly message: string }
 *     NotFound:   { readonly status: 404, readonly message: string }
 *   }>
 * @since 2.0.0
 * @category models
 */
export type TaggedEnum<
  A extends Record<string, Record<string, any>> & UntaggedChildren<A>
> = keyof A extends infer Tag ?
  Tag extends keyof A ? Types.Simplify<{ readonly _tag: Tag } & { readonly [K in keyof A[Tag]]: A[Tag][K] }>
  : never
  : never
```

You pass it a record of variant shapes; it distributes the union and injects `_tag` into each member. The result is a plain discriminated union type — nothing is produced at runtime.

**`Data.taggedEnum`** (camelCase) is the **runtime constructor factory**. It lives at `repos/effect/packages/effect/src/Data.ts:422-517`:

```ts
// repos/effect/packages/effect/src/Data.ts:422-517
/**
 * Create a constructor for a tagged union of Data structs.
 * @example
 *   const { BadRequest, NotFound } = Data.taggedEnum<
 *     | { readonly _tag: "BadRequest"; readonly status: 400; readonly message: string }
 *     | { readonly _tag: "NotFound"; readonly status: 404; readonly message: string }
 *   >()
 * @since 2.0.0
 * @category constructors
 */
export const taggedEnum: { <A extends { readonly _tag: string }>(): TaggedEnum.Constructor<A> } = () =>
  new Proxy({}, {
    get(_target, tag, _receiver) {
      if (tag === "$is") return Predicate.isTagged
      else if (tag === "$match") return taggedMatch
      return tagged(tag as string)
    }
  }) as any
```

`taggedEnum()` returns a `Proxy` object. Accessing any property on it — say `Foo.OrderPlaced` — dynamically returns a `Data.tagged` constructor for that tag name. The `$match` and `$is` helpers are also wired in.

The standard pattern is to share the same name for both the type and the runtime value (TypeScript allows this because they live in different namespaces):

```ts
import { Data } from "effect"

// The type — PascalCase
type OrderEvent = Data.TaggedEnum<{
  OrderPlaced:    { readonly orderId: string; readonly total: number }
  OrderCancelled: { readonly orderId: string; readonly reason: string }
  OrderFulfilled: { readonly orderId: string }
}>

// The runtime constructors — same PascalCase identifier, value namespace
const OrderEvent = Data.taggedEnum<OrderEvent>()

// Use the constructors
const placed = OrderEvent.OrderPlaced({ orderId: "o-1", total: 99 })
// placed._tag === "OrderPlaced"
// placed.orderId === "o-1"
```

`repos/effect/packages/cluster/src/ShardingRegistrationEvent.ts` (around line 61) shows a real-world `Data.taggedEnum` usage: the cluster package declares the variant interfaces (`EntityRegistered`, `SingletonRegistered`) and a union type alias (`ShardingRegistrationEvent`) directly in TypeScript, then calls `Data.taggedEnum<ShardingRegistrationEvent>()` to derive the constructor record. This is a valid alternative to the `Data.TaggedEnum<{...}>` pattern the chapter showed earlier — both produce equivalent runtime constructors, but the manual interface form is preferred when the variants need to be exported individually as named types.

### Part D — `Equal.Equal` and `Hash.Hash` interfaces

Most users never implement these manually — `Data.struct`, `Data.Class`, `Data.TaggedClass`, and `Data.taggedEnum` produce instances that already satisfy them. But understanding the interfaces explains why `HashMap` and `HashSet` work the way they do.

**`Equal.Equal`** is declared at `repos/effect/packages/effect/src/Equal.ts:19-21`:

```ts
// repos/effect/packages/effect/src/Equal.ts:19-21
export interface Equal extends Hash.Hash {
  [symbol](that: Equal): boolean
}
```

It extends `Hash.Hash` — you cannot implement equality without also providing a hash code. This is a correctness constraint: two values that compare equal must have identical hash codes or hash-table lookup breaks.

**`Hash.Hash`** is declared at `repos/effect/packages/effect/src/Hash.ts:25-27`:

```ts
// repos/effect/packages/effect/src/Hash.ts:25-27
export interface Hash {
  [symbol](): number
}
```

**`Equal.equals`** is the public function for structural comparison (`repos/effect/packages/effect/src/Equal.ts:27-28`):

```ts
// repos/effect/packages/effect/src/Equal.ts:27-28
export function equals<B>(that: B): <A>(self: A) => boolean
export function equals<A, B>(self: A, that: B): boolean
```

It is a dual function — data-first or data-last (Chapter 04). `Equal.equals(a, b)` and `a.pipe(Equal.equals(b))` are equivalent.

**`Hash.hash`** is the public hash function (`repos/effect/packages/effect/src/Hash.ts:33`):

```ts
// repos/effect/packages/effect/src/Hash.ts:33
export const hash: <A>(self: A) => number = ...
```

For values that implement `Hash.Hash` (i.e., anything produced by `Data.*`), it calls `self[symbol]()`. If the value's class doesn't implement `Hash`, the runtime falls back to a random number generated once per object reference and cached in a `WeakMap` keyed by the object identity (`Hash.ts:62-66` — see the `randomHashCache`). The hash is stable for the lifetime of the reference within a process, but two equivalent objects with different references will get different hashes.

To implement `Equal` and `Hash` manually on a custom class — for example, when you cannot extend `Data.Class` — you add both symbol-keyed methods:

```ts
import { Equal, Hash } from "effect"

class Vector2 implements Equal.Equal {
  constructor(readonly x: number, readonly y: number) {}

  [Equal.symbol](that: Equal.Equal): boolean {
    return that instanceof Vector2 && this.x === that.x && this.y === that.y
  }

  [Hash.symbol](): number {
    return Hash.combine(Hash.hash(this.x))(Hash.hash(this.y))
  }
}
```

---

## A production example

The following example models a simple order event log. It uses `Data.TaggedEnum` for the event type, `Data.struct` for the order key, `HashMap` for a per-order event log, and `HashSet` to detect duplicate event submissions — all tied together with Effect.

```ts
import { Data, Effect, Equal, HashMap, HashSet } from "effect"

// --- Domain types ---

type OrderEvent = Data.TaggedEnum<{
  OrderPlaced:    { readonly orderId: string; readonly total: number }
  OrderCancelled: { readonly orderId: string; readonly reason: string }
  OrderFulfilled: { readonly orderId: string }
}>
const OrderEvent = Data.taggedEnum<OrderEvent>()

// Value object used as a HashMap key — needs structural equality
const makeOrderKey = (orderId: string) => Data.struct({ orderId })
type OrderKey = ReturnType<typeof makeOrderKey>

// --- Helper: describe an event as a string ---

const describeEvent = OrderEvent.$match({
  OrderPlaced:    (e) => `placed — total ${e.total}`,
  OrderCancelled: (e) => `cancelled — reason: ${e.reason}`,
  OrderFulfilled: (_e) => `fulfilled`,
})

// --- Process a batch of events ---
// Returns a HashMap from OrderKey to the latest event for that order,
// discarding duplicates (same event submitted twice is idempotent).

const processBatch = (
  events: ReadonlyArray<OrderEvent>
): Effect.Effect<HashMap.HashMap<OrderKey, OrderEvent>> =>
  Effect.sync(() => {
    // Track events we have already seen — structural equality means the same
    // event object (same fields) will not be inserted twice.
    let seen = HashSet.empty<OrderEvent>()
    let log = HashMap.empty<OrderKey, OrderEvent>()

    for (const event of events) {
      if (HashSet.has(seen, event)) continue  // duplicate — skip
      seen = HashSet.add(seen, event)

      const key = makeOrderKey(event.orderId)
      log = HashMap.set(log, key, event)
    }

    return log
  })

// --- Demo ---

const program = Effect.gen(function* () {
  const placed    = OrderEvent.OrderPlaced({ orderId: "o-1", total: 49 })
  const fulfilled = OrderEvent.OrderFulfilled({ orderId: "o-1" })
  const duplicate = OrderEvent.OrderPlaced({ orderId: "o-1", total: 49 }) // same as placed

  // Two objects with same fields are Equal.equals — the duplicate is filtered
  console.log(Equal.equals(placed, duplicate))  // true

  const log = yield* processBatch([placed, fulfilled, duplicate])

  // o-1 appears once; the duplicate was filtered
  console.log(HashMap.size(log))  // 1 (only one key: { orderId: "o-1" })

  // Retrieve by a freshly constructed key — works because Data.struct gives
  // structural equality, so the new key matches the stored key
  const key = makeOrderKey("o-1")
  const latest = HashMap.get(log, key)
  console.log(latest)  // Option.some(OrderFulfilled { _tag: "OrderFulfilled", orderId: "o-1" })

  // Describe the event
  if (latest._tag === "Some") {
    console.log(describeEvent(latest.value))  // "fulfilled"
  }
})

Effect.runPromise(program)
```

---

## Variations

```ts
import { Data, Equal, Hash } from "effect"

// Data.struct — structural-equality record
const point = Data.struct({ x: 1, y: 2 })
// Equal.equals(point, Data.struct({ x: 1, y: 2 })) === true

// Data.tuple — structural-equality tuple
const pair = Data.tuple(1, "hello")
// Equal.equals(pair, Data.tuple(1, "hello")) === true

// Data.array — structural-equality array
const items = Data.array([Data.struct({ id: 1 }), Data.struct({ id: 2 })])
// Equal.equals(items, Data.array([Data.struct({ id: 1 }), Data.struct({ id: 2 })])) === true

// Data.Class — class form with structural equality
class Point extends Data.Class<{ x: number; y: number }> {}
// new Point({ x: 1, y: 2 }) equals new Point({ x: 1, y: 2 }) by Equal.equals

// Data.TaggedClass — tagged class with _tag discriminant
class Created extends Data.TaggedClass("Created")<{ id: string }> {}
// new Created({ id: "1" })._tag === "Created"
// Equal.equals(new Created({ id: "1" }), new Created({ id: "1" })) === true

// Data.taggedEnum — discriminated union constructors + matchers
type Shape = Data.TaggedEnum<{ Circle: { radius: number }; Square: { side: number } }>
const Shape = Data.taggedEnum<Shape>()
const circle = Shape.Circle({ radius: 5 })
// Shape.$match({ Circle: (c) => Math.PI * c.radius ** 2, Square: (s) => s.side ** 2 })(circle)

// Equal.equals / Hash.hash — direct trait usage
console.log(Equal.equals(Data.struct({ a: 1 }), Data.struct({ a: 1 })))  // true
console.log(Hash.hash(Data.struct({ a: 1 })))                             // a stable number
```

---

## Anti-patterns

**Using plain `===` to compare records and getting always-false.**

```ts
// Wrong — reference equality, always false for distinct objects
const a = { id: 1, role: "admin" }
const b = { id: 1, role: "admin" }
if (a === b) { /* never reached */ }

// Right — wrap with Data.struct so Equal.equals works
import { Data, Equal } from "effect"
const pa = Data.struct({ id: 1, role: "admin" })
const pb = Data.struct({ id: 1, role: "admin" })
if (Equal.equals(pa, pb)) { /* reached */ }
```

**Using `Map` or `Set` with object keys (JS reference equality).**

```ts
// Wrong — Map uses reference equality for keys; lookups always miss
const cache = new Map<{ userId: string }, string>()
cache.set({ userId: "u-1" }, "alice")
console.log(cache.get({ userId: "u-1" }))  // undefined

// Right — use HashMap with Data.struct keys
import { Data, HashMap } from "effect"
const key = (userId: string) => Data.struct({ userId })
let hmap = HashMap.empty<ReturnType<typeof key>, string>()
hmap = HashMap.set(hmap, key("u-1"), "alice")
console.log(HashMap.get(hmap, key("u-1")))  // Option.some("alice")
```

**Defining a plain class for a value type without structural equality.**

```ts
// Wrong — two instances with same fields are not Equal.equals
class OrderId {
  constructor(readonly value: string) {}
}
const a = new OrderId("o-1")
const b = new OrderId("o-1")
console.log(Equal.equals(a, b))  // false — no Equal implementation

// Right — extend Data.Class so instances participate in structural equality
import { Data, Equal } from "effect"
class OrderId extends Data.Class<{ value: string }> {}
const c = new OrderId({ value: "o-1" })
const d = new OrderId({ value: "o-1" })
console.log(Equal.equals(c, d))  // true
```

---

## See also

- [Chapter 06 — Typed errors](06-typed-errors.md) — `Data.TaggedError` builds on `Data.Error`, which extends ES `Error` and does not participate in `StructuralPrototype`-based equality.
- [Chapter 12 — Option and Either](12-option-and-either.md) — Option/Either values from Effect also implement `Equal`; `Equal.equals(Option.some(1), Option.some(1))` is `true`
- [Chapter 14 — Schema part 1](14-schema-part-1.md) — `Schema.Class` and `Schema.TaggedClass` use `Data.Class` as their base, so they carry structural equality automatically
- [Chapter 17 — Fibers and structured concurrency](17-fibers-and-concurrency.md)
- [Part II Chapter 40 — Immutable collections](../part-2-tour/40-immutable-collections.md) — `HashMap`, `HashSet`, `Chunk`, and `List` all key on `Equal.equals` and `Hash.hash`; this chapter is their prerequisite
- [Patterns Catalog: `Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](../../research/02-patterns-catalog.md#datastruct--tuple--array--class--taggedclass)
- [Patterns Catalog: `Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors)
- [Patterns Catalog: `Equal.equals` interface and `Hash`](../../research/02-patterns-catalog.md#equalequals-interface-and-hash--structural-equality)
- [Per-package note: effect](../../research/packages/effect.md)

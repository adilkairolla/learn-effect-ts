# Chapter 42 — Algebraic typeclasses with @effect/typeclass

> **Package(s):** `@effect/typeclass`
> **Patterns introduced:** [SortedMap / SortedSet (with Order)](../../research/02-patterns-catalog.md#sortedmap--sortedset-with-order)
> **Reads from:** [Chapter 18 — Data, Equal, Hash](../part-1-foundations/18-data-equal-hash.md), [Chapter 40 — Immutable collections](40-immutable-collections.md)
> **Reads into:** nothing (this is a reference chapter)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Plain TypeScript offers no shared abstraction for "things that can be combined," "things that can be ordered," or "things that can be mapped over." Each generic operation has to reinvent its own convention.

Sorting is the clearest example. `Array.prototype.sort` takes an inline comparator:

```ts
// Plain TypeScript — comparator duplicated at every call site
const events = [
  { ts: 1700000003, name: "login" },
  { ts: 1700000001, name: "open" },
  { ts: 1700000002, name: "click" },
]

// Comparator copied everywhere you need to sort
events.sort((a, b) => a.ts - b.ts)

// And again when you want reverse order
events.sort((a, b) => b.ts - a.ts)

// And again when composing two orderings (sort by status, then by ts)
events.sort((a, b) => {
  const cmp = a.name.localeCompare(b.name)
  return cmp !== 0 ? cmp : a.ts - b.ts
})
```

There is no way to name the `ts` ordering and reuse it. `Array.sort` has no concept of composing orderings. Each of the three calls above is a new anonymous function that the next reader must interpret from scratch.

The problem compounds with combination. Every team merging maps or accumulating values writes the same structural `if-else` by hand — `mergeCounts` vs `mergeMinLatency` are structurally identical except for the combining operation. Without a named abstraction for "combining values of type `A`," that structure cannot be extracted.

Higher-kinded polymorphism — writing a function over both `Option<A>` and `Effect<A, E, R>` — requires higher-kinded types, which TypeScript does not natively support. Without an encoding, every generic algorithm is copy-pasted once per container type.

`@effect/typeclass` solves all three problems by providing:
1. A hierarchy of typed interfaces — `Order`, `Semigroup`, `Monoid`, `Functor`, `Monad`, and more — as named, reusable values.
2. Generic combinators that accept those interfaces and derive new behaviour automatically.
3. A `TypeLambda`/`Kind` encoding that simulates higher-kinded types in TypeScript, enabling truly polymorphic algorithms.

---

## The minimal example

`Order` is the foundation of `SortedMap`. Passing an `Order<K>` to `SortedMap.empty` locks in the sort invariant for the entire lifetime of the map — no comparator at call site, no re-sorting on read.

```ts
import { Order, SortedMap, Option } from "effect"

// Order<number> is a stable, reusable value
// repos/effect/packages/effect/src/Order.ts:57-57
const byNumber: Order.Order<number> = Order.number

// SortedMap.empty — creates a map sorted by the given Order
// repos/effect/packages/effect/src/SortedMap.ts:92-92
let scores: SortedMap.SortedMap<number, string> = SortedMap.empty<number, string>(byNumber)

// SortedMap.set — O(log n), returns a new map with the sort invariant maintained
// repos/effect/packages/effect/src/SortedMap.ts:215-224
scores = SortedMap.set(scores, 42, "alice")
scores = SortedMap.set(scores, 7,  "bob")
scores = SortedMap.set(scores, 99, "carol")

// SortedMap.get — O(log n), returns Option<V>
// repos/effect/packages/effect/src/SortedMap.ts:136-142
const found: Option.Option<string> = SortedMap.get(scores, 42) // Option.some("alice")

// Iteration is always in ascending key order — no sort on read
for (const [k, v] of scores) {
  console.log(k, v)
  // 7  "bob"
  // 42 "alice"
  // 99 "carol"
}
```

The `Order.number` value — `(self, that) => self < that ? -1 : 1` — is defined once and reused wherever a numeric ordering is needed. No inline comparator, no drift between sort sites.

---

## Tour

### Foundation typeclasses: Equivalence and Order

`Equivalence` is the typeclass for structural equality. Chapter 18 introduced `Equal.equals`, which is built on the same principle. `@effect/typeclass` provides `Equivalence` as an interface you can implement for your own types and compose into larger structures.

`Order` goes further: it defines a total ordering via a single function `(self: A, that: A) => -1 | 0 | 1`. `Order` lives only in core `effect` (`effect/Order`) — `@effect/typeclass` has no `Order.ts` and does not re-export `Order` from its index. `@effect/typeclass` imports `Order` internally for `Bounded` and other type classes, but you must always import it from `"effect"`.

- **`effect/Order`** (`repos/effect/packages/effect/src/Order.ts:26-28`) — the canonical definition and instances (`Order.number`, `Order.string`, `Order.boolean`, `Order.bigint`).

The core `Order` module also provides combinators for free:

- **`Order.mapInput`** (`repos/effect/packages/effect/src/Order.ts:129-135`) — derive an `Order<B>` from an `Order<A>` by mapping `B → A`. This is the contravariant map for orderings.
- **`Order.combine`** (`repos/effect/packages/effect/src/Order.ts:80-90`) — compose two orderings: try the first; if it says equal, fall through to the second. This is how you build compound sort keys without writing a single `if` statement.
- **`Order.reverse`** (`repos/effect/packages/effect/src/Order.ts:74-74`) — flip an ordering to get descending order.

### Combination typeclasses: Semigroup and Monoid

A `Semigroup<A>` captures "two values of type `A` can be combined into one" (`repos/effect/packages/typeclass/src/Semigroup.ts:16-19`). It has two methods: `combine` and `combineMany`. `Semigroup.make` derives `combineMany` automatically, so in practice you only supply `combine`. Built-in constructors `Semigroup.min` and `Semigroup.max` take an `Order<A>` and pick the smaller or larger element (`repos/effect/packages/typeclass/src/Semigroup.ts:51-59`); `Semigroup.intercalate` joins values with a separator (`repos/effect/packages/typeclass/src/Semigroup.ts:95-101`).

A `Monoid<A>` extends `Semigroup<A>` with an `empty` element (`repos/effect/packages/typeclass/src/Monoid.ts:12-15`) — the identity for `combine`. `Monoid.fromSemigroup` lifts any `Semigroup` to a `Monoid` by providing the `empty` value (`repos/effect/packages/typeclass/src/Monoid.ts:21-26`).

`Bounded` adds `minBound` and `maxBound` to an `Order`, forming a fully bounded total order (`repos/effect/packages/typeclass/src/Bounded.ts:15-19`). `Bounded.min` and `Bounded.max` derive `Monoid` instances whose empty values are the respective bounds — useful for accumulating extreme values over a collection.

### HKT typeclasses: Functor, Applicative, Monad

TypeScript cannot natively abstract over a type constructor `F<_>`. `@effect/typeclass` uses the `TypeLambda`/`Kind` encoding from `effect/HKT`: each data type declares an interface `extends TypeLambda`, and `Kind<F, R, O, E, A>` reconstructs the concrete type at compile time with zero runtime cost.

**Covariant (Functor)** provides `map` for containers (`repos/effect/packages/typeclass/src/Covariant.ts:12-17`). Every typeclass method carries dual-arity overloads (data-last for `pipe`, data-first for direct calls). `Option`, `Either`, `Array`, and `Effect` all have `Covariant` instances in `repos/effect/packages/typeclass/src/data/`.

**Applicative** extends `SemiApplicative` (`product` for combining contexts) and `Product` (`of` for lifting pure values). `Applicative.getMonoid` lifts a `Monoid<A>` into `Monoid<F<A>>` — the mechanism behind `Traversable`'s parallel accumulation (`repos/effect/packages/typeclass/src/Applicative.ts:25-30`).

**Monad** inherits `flatMap` from `FlatMap` and `of` from `Pointed` (`repos/effect/packages/typeclass/src/Monad.ts:12`). A function generic over `Monad<F>` works unchanged for `Option`, `Either`, `Effect`, and any future type that supplies the dictionary.

### Traversal typeclasses: Foldable and Traversable

**Foldable** exposes `reduce` as its single primitive (`repos/effect/packages/typeclass/src/Foldable.ts:15-20`). `Foldable.combineMap` takes a `Monoid<M>` and a function `A → M` to fold a structure into a single value — sum a list, merge maps, or collect results all with the same generic function (`repos/effect/packages/typeclass/src/Foldable.ts:62-70`).

**Traversable** threads an `Applicative` through a container (`repos/effect/packages/typeclass/src/Traversable.ts:12-24`): given a `T<A>` and `A → F<B>`, it produces `F<T<B>>`. For `Effect` as the applicative this runs all effects in the container and collects results, short-circuiting on the first failure. `Traversable.sequence` is the specialization where the function is the identity (`repos/effect/packages/typeclass/src/Traversable.ts:46-51`).

### SortedMap and SortedSet: Order as a first-class value

`SortedMap` and `SortedSet` live in core `effect` (`repos/effect/packages/effect/src/SortedMap.ts`, `repos/effect/packages/effect/src/SortedSet.ts`), backed by a red-black tree. The `Order` is stored inside the collection at construction time — pass it once to `empty` or `fromIterable` and the sort invariant is maintained automatically on every subsequent mutation.

```ts
import { Order, SortedMap, SortedSet } from "effect"

// Derive an Order<{ts: number}> from Order.number via contravariant map
const byTimestamp = Order.mapInput(Order.number, (e: { ts: number }) => e.ts)

// SortedSet — deduplicated, sorted by timestamp
// repos/effect/packages/effect/src/SortedSet.ts:92-92
let seen = SortedSet.empty<number>(Order.number)
seen = SortedSet.add(seen, 3)
seen = SortedSet.add(seen, 1)
seen = SortedSet.add(seen, 2)
seen = SortedSet.add(seen, 1)  // duplicate — ignored
// Iteration: 1, 2, 3

// SortedSet.has — O(log n)
// repos/effect/packages/effect/src/SortedSet.ts:221-227
console.log(SortedSet.has(seen, 2))  // true
console.log(SortedSet.has(seen, 9))  // false
```

Because the `Order` is a plain value (not a class or interface with special runtime meaning), you can build composite orderings before passing them to the collection:

```ts
import { Order, SortedMap } from "effect"

type Task = { priority: number; name: string }

// Primary: descending priority. Secondary: ascending name.
const byPriorityThenName = Order.combine(
  Order.reverse(Order.mapInput(Order.number, (t: Task) => t.priority)),
  Order.mapInput(Order.string, (t: Task) => t.name)
)

const tasks = SortedMap.fromIterable(byPriorityThenName)([
  [{ priority: 2, name: "b-task" }, "medium-b"],
  [{ priority: 3, name: "a-task" }, "high-a"],
  [{ priority: 2, name: "a-task" }, "medium-a"],
])
// Sorted: high-a (3), medium-a (2), medium-b (2)
```

The ordering lives in one place, is named, is composable, and is never repeated.

---

## A production example

The scenario: a metrics collector aggregates telemetry events. Events arrive in arbitrary order; the output must be time-ordered. Event counts for the same second are summed using a `Semigroup`. A final fold produces the grand total.

```ts
import { Option, Order, SortedMap } from "effect"
import { Semigroup, Monoid } from "@effect/typeclass"

// ── Domain ────────────────────────────────────────────────────────────────────

/** Unix timestamp in seconds */
type Timestamp = number

/** Count of events in a one-second bucket */
type EventCount = number

// ── Semigroup for event counts: sum ──────────────────────────────────────────

// Semigroup.make derives combineMany automatically from combine
// repos/effect/packages/typeclass/src/Semigroup.ts:37-43
const EventCountSemigroup: Semigroup.Semigroup<EventCount> = Semigroup.make(
  (a, b) => a + b
)

// Lift to Monoid with identity 0
// repos/effect/packages/typeclass/src/Monoid.ts:21-26
const EventCountMonoid: Monoid.Monoid<EventCount> = Monoid.fromSemigroup(
  EventCountSemigroup,
  0
)

// ── Order for timestamps: ascending ──────────────────────────────────────────

// repos/effect/packages/effect/src/Order.ts:57-57
const byTimestamp: Order.Order<Timestamp> = Order.number

// ── Telemetry aggregation ─────────────────────────────────────────────────────

type TelemetryEntry = readonly [Timestamp, EventCount]

/**
 * Merge a batch of (timestamp, count) pairs into a SortedMap.
 * Entries with the same timestamp are combined via EventCountSemigroup.
 * The map is always in ascending timestamp order — no sort-on-read.
 *
 * SortedMap.empty: repos/effect/packages/effect/src/SortedMap.ts:92-92
 * SortedMap.set:   repos/effect/packages/effect/src/SortedMap.ts:215-224
 * SortedMap.get:   repos/effect/packages/effect/src/SortedMap.ts:136-142
 */
function ingest(
  entries: ReadonlyArray<TelemetryEntry>
): SortedMap.SortedMap<Timestamp, EventCount> {
  let acc = SortedMap.empty<Timestamp, EventCount>(byTimestamp)
  for (const [ts, count] of entries) {
    const existing = SortedMap.get(acc, ts)
    const combined = Option.isSome(existing)
      ? EventCountSemigroup.combine(existing.value, count)
      : count
    acc = SortedMap.set(acc, ts, combined)
  }
  return acc
}

/**
 * Merge two already-aggregated SortedMaps, combining counts for shared keys.
 */
function mergeAggregates(
  a: SortedMap.SortedMap<Timestamp, EventCount>,
  b: SortedMap.SortedMap<Timestamp, EventCount>
): SortedMap.SortedMap<Timestamp, EventCount> {
  return SortedMap.reduce(b, a, (acc, count, ts) => {
    const existing = SortedMap.get(acc, ts)
    const combined = Option.isSome(existing)
      ? EventCountSemigroup.combine(existing.value, count)
      : count
    return SortedMap.set(acc, ts, combined)
  })
}

/**
 * Fold the sorted map into a grand total using Monoid.combineAll.
 *
 * repos/effect/packages/typeclass/src/Monoid.ts:12-15
 */
function totalEvents(
  m: SortedMap.SortedMap<Timestamp, EventCount>
): EventCount {
  return EventCountMonoid.combineAll(SortedMap.values(m))
}

// ── Wire together ─────────────────────────────────────────────────────────────

const batch1: ReadonlyArray<TelemetryEntry> = [
  [1700000003, 5],
  [1700000001, 12],
  [1700000001, 3],   // same second as above — will be summed to 15
  [1700000002, 8],
]

const batch2: ReadonlyArray<TelemetryEntry> = [
  [1700000002, 2],   // overlaps with batch1 — will sum to 10
  [1700000004, 1],
]

const agg1 = ingest(batch1)
const agg2 = ingest(batch2)
const merged = mergeAggregates(agg1, agg2)
const total = totalEvents(merged)

// Sorted iteration: ts=1700000001 → 15, ts=1700000002 → 10, ts=1700000003 → 5, ts=1700000004 → 1
// total === 31
```

The structure is entirely driven by the typeclass abstractions. The `Semigroup` captures the merging rule in one place. `SortedMap` enforces the ordering invariant at the data level. `Monoid.combineAll` removes the explicit fold loop. Each piece can be swapped independently — change the `Semigroup` to `Semigroup.max` and the aggregation becomes "peak count per second" without touching any other line.

---

## Variations

**Custom Order via `Order.make`**

```ts
import { Order } from "effect"

// repos/effect/packages/effect/src/Order.ts:42-45
const byAbsValue: Order.Order<number> = Order.make((a, b) =>
  Math.abs(a) < Math.abs(b) ? -1 : Math.abs(a) > Math.abs(b) ? 1 : 0
)
```

**Compound sort with `Order.combine`**

```ts
import { Order, SortedMap } from "effect"

type Item = { category: string; price: number }

const byItem = Order.combine(
  Order.mapInput(Order.string, (i: Item) => i.category),
  Order.mapInput(Order.number, (i: Item) => i.price)
)
const catalog = SortedMap.empty<Item, string>(byItem)
```

**Reduce a collection with `Monoid.combineAll`**

```ts
import { Monoid } from "@effect/typeclass"

// repos/effect/packages/typeclass/src/Monoid.ts:12-15
const StringMonoid: Monoid.Monoid<string> = Monoid.fromSemigroup(
  { combine: (a, b) => a + b, combineMany: (a, bs) => [a, ...bs].join("") },
  ""
)
const joined = StringMonoid.combineAll(["hello", " ", "world"])  // "hello world"
```

**Traversable for sequencing Effects**

```ts
import { Effect } from "effect"
import { Traversable } from "@effect/typeclass"
import * as ArrayT from "@effect/typeclass/data/Array"
import * as EffectT from "@effect/typeclass/data/Effect"

// traverse visits each element and sequences the Effect applicative
// repos/effect/packages/typeclass/src/Traversable.ts:12-24
const validateAll = (ids: ReadonlyArray<string>): Effect.Effect<ReadonlyArray<string>> =>
  ArrayT.Traversable.traverse(EffectT.getApplicative())(
    ids,
    (id) => id.length > 0 ? Effect.succeed(id) : Effect.fail(new Error("empty id"))
  )
```

**Bounded for min/max accumulation**

```ts
import { Bounded, Monoid } from "@effect/typeclass"
import { Order } from "effect"

// repos/effect/packages/typeclass/src/Bounded.ts:15-19
const U8Bounded: Bounded.Bounded<number> = {
  compare: Order.number,
  minBound: 0,
  maxBound: 255,
}

// Monoid whose empty is maxBound — combining always picks the minimum
// repos/effect/packages/typeclass/src/Bounded.ts:35-35
const MinU8 = Bounded.min(U8Bounded)
const smallest = MinU8.combineAll([200, 42, 17, 255])  // 17
```

**`Order.reverse` for descending SortedMap**

```ts
import { Order, SortedMap } from "effect"

// repos/effect/packages/effect/src/Order.ts:74-74
const descending = Order.reverse(Order.number)
const topScores = SortedMap.empty<number, string>(descending)
// Largest key iterates first
```

---

## Anti-patterns

**Inline comparator in `Array.sort`**

```ts
// Wrong: the ordering is anonymous, cannot be composed or reused
const sorted = items.sort((a, b) => a.ts - b.ts)

// Correct: name it as an Order value
import { Order, SortedMap } from "effect"
const byTs = Order.mapInput(Order.number, (item: { ts: number }) => item.ts)
// Now pass byTs to SortedMap.empty, Order.reverse, Order.combine, etc.
```

**Manual if-else for merging**

```ts
// Wrong: the merging rule is embedded in the loop and cannot be replaced
function merge(a: number, b: number) { return a + b }
for (const [k, v] of otherMap) {
  result.set(k, result.has(k) ? merge(result.get(k)!, v) : v)
}

// Correct: capture the rule as a Semigroup once
import { Semigroup } from "@effect/typeclass"
const SumSemigroup = Semigroup.make<number>((a, b) => a + b)
// Swap to Semigroup.max(Order.number) without changing the merge loop structure
```

**Re-deriving polymorphic helpers per type**

```ts
// Wrong: a separate mapOption and mapArray for each container
function mapOption<A, B>(opt: Option<A>, f: (a: A) => B): Option<B> { ... }
function mapArray<A, B>(arr: Array<A>, f: (a: A) => B): Array<B> { ... }

// Correct: a single function generic over Covariant<F>
import type { Covariant } from "@effect/typeclass"
import type { Kind, TypeLambda } from "effect/HKT"

function transform<F extends TypeLambda, A, B>(
  F: Covariant.Covariant<F>,
  fa: Kind<F, never, never, never, A>,
  f: (a: A) => B
): Kind<F, never, never, never, B> {
  return F.map(fa, f)
}
// Works with OptionCovariant, ArrayCovariant, or any future Covariant instance
```

**Using `Array.prototype.sort` for a sorted map**

```ts
// Wrong: O(n log n) on every read; sort order is not enforced on insert
function getInOrder(map: Map<number, string>): Array<[number, string]> {
  return [...map.entries()].sort(([a], [b]) => a - b)
}

// Correct: SortedMap maintains sort order on each O(log n) insert
// repos/effect/packages/effect/src/SortedMap.ts:92-92
import { Order, SortedMap } from "effect"
const sorted = SortedMap.empty<number, string>(Order.number)
// Iterate sorted directly — no sort-on-read
```

---

## See also

- [Chapter 18 — Data, Equal, Hash](../part-1-foundations/18-data-equal-hash.md) — `Equal.equals` and `Hash` are the structural-equality layer that `@effect/typeclass` Equivalence formalises; `Data.struct` gives you value-typed objects for use as `SortedMap` keys.
- [Chapter 40 — Immutable collections](40-immutable-collections.md) — `HashMap`, `HashSet`, `Chunk`, `List` are the concrete collections; `SortedMap` and `SortedSet` (introduced here) are their sorted siblings backed by `RedBlackTree`.
- [Chapter 12 — Option and Either](../part-1-foundations/12-option-and-either.md) — both types have `Covariant`, `Monad`, and `Traversable` instances in `repos/effect/packages/typeclass/src/data/Option.ts` and `data/Either.ts`; the typeclass dictionary for `Option.Monad` is shown at `repos/effect/packages/typeclass/src/data/Option.ts:134-139`.
- [Chapter 16 — Stream](../part-1-foundations/16-stream.md) — `Stream` implements `Covariant` and `FlatMap`; `Foldable`-style reduction over a `Stream` uses `Stream.runFold`, which follows the same `reduce` interface pattern covered here.
- [Patterns catalog — SortedMap / SortedSet (with Order)](../../research/02-patterns-catalog.md#sortedmap--sortedset-with-order) — canonical pattern entry with source citations, "when to use," and the anti-pattern it replaces.
- [Per-package note — @effect/typeclass](../../research/packages/typeclass.md) — `TypeLambda`/`Kind` encoding deep-dive, the `data/` instance registry, and open questions about law encoding and `data/Effect.ts` concurrency options.

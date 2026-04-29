# Chapter 40 — Immutable collections — HashMap, HashSet, Chunk, List, and trees

> **Package(s):** `effect`
> **Patterns introduced:** [HashMap — structural-equality keyed map](../../research/02-patterns-catalog.md#hashmap--structural-equality-keyed-map), [HashSet — structural-equality set](../../research/02-patterns-catalog.md#hashset--structural-equality-set), [List — persistent linked list](../../research/02-patterns-catalog.md#list--persistent-linked-list), [RedBlackTree](../../research/02-patterns-catalog.md#redblacktree), [Trie](../../research/02-patterns-catalog.md#trie)
> **Reads from:** Chapter 18 (Data, Equal, Hash), Chapter 12 (Option and Either)
> **Reads into:** Chapter 42 (typeclass — Order, SortedMap, SortedSet)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

## The problem

JavaScript's built-in `Map` and `Set` use reference equality for object keys and members. That sounds fine until you try to use a plain object as a map key.

```ts
// Plain JS — reference-equality trap
const cache = new Map<{ userId: number }, string>()
cache.set({ userId: 42 }, "alice")

// Different object reference — lookup fails even though the value is the same
console.log(cache.get({ userId: 42 })) // undefined
```

The lookup returns `undefined` because `{ userId: 42 } !== { userId: 42 }` by reference. Every lookup creates a fresh object literal that has never been stored in the map. This is the most common subtle bug in JS codebases that try to use composite keys.

Arrays add their own pain. JavaScript's `Array.unshift` mutates the array in place and copies every existing element to make room — O(n) and destructive. If you want a persistent "history" or "stack" data structure, you are left implementing your own linked list or accepting the performance cost.

There is also no built-in sorted map, no ordered set that maintains a sort invariant on insert, no prefix-indexed collection, and no persistent tree. The moment you need "give me all log entries between timestamp A and timestamp B" from an in-memory structure, you are reaching for a sorted array and a binary-search helper that you wrote yourself.

Effect ships a complete suite of persistent, immutable collection types that solve these problems. They are not experimental — they have been stable since Effect 2.0 and are used extensively in Effect's own internals. The five types this chapter covers are:

- **`HashMap`** — a hash-array mapped trie keyed by structural equality (`Equal.equals`), not reference equality. Correct with value-typed keys.
- **`HashSet`** — a structural-equality set backed by the same HAMT internals. Correct deduplication for value objects.
- **`List`** — a persistent singly-linked list with O(1) prepend and O(1) head/tail access; the immutable alternative to an array used as a stack.
- **`RedBlackTree`** — a self-balancing BST with O(log n) insert and ordered range traversal. The foundation for `SortedMap` and `SortedSet` (those are covered in Chapter 42 — typeclass).
- **`Trie`** — a string-keyed prefix tree for O(prefix-length) lookups and `keysWithPrefix` queries.

All five are part of the `effect` core package, imported from the same entry point.

## The minimal example

```ts
import { Data, HashMap, Option } from "effect"

// Structural-equality key via Data.struct (see Chapter 18)
interface UserId {
  readonly tenantId: string
  readonly localId: number
}
const UserId = (tenantId: string, localId: number): UserId =>
  Data.struct({ tenantId, localId })

// HashMap.empty — creates an empty map keyed by UserId
// repos/effect/packages/effect/src/HashMap.ts:108-108
let users: HashMap.HashMap<UserId, string> = HashMap.empty<UserId, string>()

// HashMap.set returns a NEW map — the original is unchanged
users = HashMap.set(users, UserId("acme", 1), "alice")
users = HashMap.set(users, UserId("acme", 2), "bob")

// HashMap.get — returns Option<V>; see Chapter 12
const found: Option.Option<string> = HashMap.get(users, UserId("acme", 1))
// Option.some("alice") — structural equality matched the key

const missing: Option.Option<string> = HashMap.get(users, UserId("acme", 99))
// Option.none() — key not present

console.log(HashMap.size(users)) // 2
```

The `Data.struct` call produces an object whose `Equal.equals` and `Hash.hash` implementations compare by value (see Chapter 18 for the full mechanics). Without that, `HashMap` would behave identically to a plain JS `Map` — lookups would always miss.

## Tour

This section walks the API surface of each of the five collection types. Every name cited here is a real export from the pinned source; none are invented.

### HashMap — structural-equality keyed map

**Source:** `repos/effect/packages/effect/src/HashMap.ts` — stable since 2.0.0.

The `HashMap<K, V>` interface extends `Iterable<[K, V]>`, `Equal`, `Pipeable`, and `Inspectable`
(`repos/effect/packages/effect/src/HashMap.ts:26-28`).

**Core constructors** (`repos/effect/packages/effect/src/HashMap.ts:102-129`):

```ts
import { HashMap } from "effect"

// empty — O(1)
const m0 = HashMap.empty<string, number>()

// make — from vararg key-value pairs
const m1 = HashMap.make(["a", 1], ["b", 2])

// fromIterable — from any Iterable<readonly [K, V]>
const m2 = HashMap.fromIterable([["a", 1], ["b", 2]])
```

**Lookup and mutation** (`repos/effect/packages/effect/src/HashMap.ts:146-391`):

- `HashMap.get(map, key)` — returns `Option<V>`. Safe lookup; no `undefined` leakage. (`repos/effect/packages/effect/src/HashMap.ts:146-149`)
- `HashMap.has(map, key)` — returns `boolean`. (`repos/effect/packages/effect/src/HashMap.ts:180-183`)
- `HashMap.set(map, key, value)` — returns a new `HashMap` with the entry added or replaced. (`repos/effect/packages/effect/src/HashMap.ts:224-227`)
- `HashMap.remove(map, key)` — returns a new map without the entry. (`repos/effect/packages/effect/src/HashMap.ts:388-391`)
- `HashMap.modify(map, key, f)` — update an existing value in place (functionally). (`repos/effect/packages/effect/src/HashMap.ts:367-370`)
- `HashMap.modifyAt(map, key, f)` — takes `Option<V>` and returns `Option<V>`; covers insert-or-update atomically. (`repos/effect/packages/effect/src/HashMap.ts:340-343`)
- `HashMap.union(a, b)` — merge two maps, with `b` winning on key conflicts. (`repos/effect/packages/effect/src/HashMap.ts:377-380`)

**When to use `HashMap`:** Your keys are value objects — `Data.struct`, `Data.Class`, branded types, or any type implementing `Equal`. Use plain `Map<string, V>` or `Record<string, V>` for string-keyed maps; `HashMap` is not faster there.

**Performance:** O(1) average for get/set/has/remove. The underlying implementation is a Hash-Array Mapped Trie (HAMT); structural sharing means most updates copy only O(log n) nodes.

### HashSet — structural-equality set

**Source:** `repos/effect/packages/effect/src/HashSet.ts` — stable since 2.0.0.

The module-level JSDoc (`repos/effect/packages/effect/src/HashSet.ts:1-100`) is particularly thorough — it documents performance, equality semantics, and operation complexity in a reference table.

**Core constructors** (`repos/effect/packages/effect/src/HashSet.ts:375-470`):

```ts
import { HashSet } from "effect"

const s0 = HashSet.empty<number>()
const s1 = HashSet.make(1, 2, 3)
const s2 = HashSet.fromIterable([1, 2, 3, 1, 2]) // deduplicates: {1, 2, 3}
```

**Key operations:**

- `HashSet.add(set, value)` — returns a new set with the value included; O(1) avg. (`repos/effect/packages/effect/src/HashSet.ts:375` area)
- `HashSet.has(set, value)` — O(1) avg membership test.
- `HashSet.remove(set, value)` — O(1) avg removal.
- `HashSet.union(a, b)`, `HashSet.intersection(a, b)`, `HashSet.difference(a, b)` — set algebra, O(n).
- `HashSet.map(set, f)`, `HashSet.filter(set, pred)`, `HashSet.reduce(set, z, f)` — standard functional collection operations.

**Equality of elements:** `HashSet` uses `Equal.equals` from Effect's `Equal` module for deduplication. For primitive values this behaves like `===`. For objects you must implement `Equal` (or use `Data.struct` / `Data.Class`) — otherwise every distinct object reference is treated as a unique element, which silently defeats deduplication.

```ts
import { Data, Equal, HashSet } from "effect"

const Point = (x: number, y: number) => Data.struct({ x, y })

// Without Data.struct, Set keeps duplicates (reference inequality)
// With Data.struct, HashSet correctly deduplicates
const points = HashSet.fromIterable([Point(1, 2), Point(1, 2), Point(3, 4)])
console.log(HashSet.size(points)) // 2, not 3
```

**When NOT to use:** String or number elements — `new Set<string>()` is simpler and faster. Sorted iteration — use `SortedSet` with an `Order` (Chapter 42).

### List — persistent linked list

**Source:** `repos/effect/packages/effect/src/List.ts` — ported from Scala's standard library, stable since 2.0.0.

The module-level JSDoc (`repos/effect/packages/effect/src/List.ts:1-11`) states the fundamental guarantee: O(1) prepend (`cons`), O(1) head/tail access, O(n) for everything else (length, append, reverse, indexed lookup).

`List<A>` is a discriminated union of `Cons<A>` and `Nil<A>` (`repos/effect/packages/effect/src/List.ts:49`). Pattern-matching over it is idiomatic:

```ts
import { List, Option } from "effect"

// Construction
const stack: List.List<number> = List.make(3, 2, 1) // [3, 2, 1]
const pushed = List.cons(4, stack)                  // [4, 3, 2, 1] — O(1)

// Head and tail — safe via Option
const head: Option.Option<number> = List.head(pushed) // Option.some(4)
const tail: List.List<number>     = List.tail(pushed) // [3, 2, 1]

// Build from any iterable
const fromArr = List.fromIterable([10, 20, 30])

// Convert back
const asArray = List.toArray(fromArr) // [10, 20, 30]
```

**Constructors** (`repos/effect/packages/effect/src/List.ts:245-310`):

- `List.nil()` / `List.empty()` — the empty list. (`repos/effect/packages/effect/src/List.ts:251`)
- `List.cons(head, tail)` — prepend; O(1). (`repos/effect/packages/effect/src/List.ts:259`)
- `List.of(value)` — singleton list. (`repos/effect/packages/effect/src/List.ts:277`)
- `List.fromIterable(prefix)` — build from any iterable. (`repos/effect/packages/effect/src/List.ts:285-295`)
- `List.make(...elements)` — vararg. (`repos/effect/packages/effect/src/List.ts:308-310`)

**Structural sharing:** When you `cons` a new head onto an existing list, the new `Cons` node points at the old tail. No copying occurs. Two lists can share a suffix. This is the "persistent" property: old references remain valid and point to the original data.

**List vs Chunk vs Array:** Use `Array` for most application code (random access, JSON, interop). Use `Chunk` when working in stream pipelines (Chapter 16 — Stream uses `Chunk` as its element container). Use `List` specifically when you need O(1) prepend-heavy patterns: recursive algorithms, stack-like accumulation, or building a result by consing in reverse then reading from the front.

### RedBlackTree — ordered range queries

**Source:** `repos/effect/packages/effect/src/RedBlackTree.ts` — stable since 2.0.0.

`RedBlackTree<K, V>` is a self-balancing binary search tree parameterised by an `Order<K>`. Insert, delete, and exact lookup are O(log n). Its most powerful feature is ordered range traversal: half-open and closed ranges of keys are available as lazy iterables with no up-front allocation.

**Constructors** (`repos/effect/packages/effect/src/RedBlackTree.ts:62-91`):

```ts
import { Order, RedBlackTree } from "effect"

const byNumber = Order.number

const tree = RedBlackTree.empty<number, string>(byNumber)
const t1 = RedBlackTree.insert(tree, 5, "five")
const t2 = RedBlackTree.insert(t1, 2, "two")
const t3 = RedBlackTree.insert(t2, 8, "eight")
const t4 = RedBlackTree.insert(t3, 1, "one")

// fromIterable — build from entries at once
const t5 = RedBlackTree.fromIterable(byNumber)([
  [1, "one"], [2, "two"], [5, "five"], [8, "eight"]
])
```

**Range traversal** (`repos/effect/packages/effect/src/RedBlackTree.ts:178-310`):

- `RedBlackTree.greaterThan(tree, lo)` — all entries with key `> lo`, in order.
- `RedBlackTree.greaterThanEqual(tree, lo)` — keys `>= lo`.
- `RedBlackTree.lessThan(tree, hi)` — keys `< hi`.
- `RedBlackTree.lessThanEqual(tree, hi)` — keys `<= hi`.

To get a half-open range `[lo, hi)`, iterate `greaterThanEqual(tree, lo)` and `takeWhile` key `< hi`. These traversals are lazy iterators — they do not materialise the entire result upfront.

**Lookup** (`repos/effect/packages/effect/src/RedBlackTree.ts:127-141`):

- `RedBlackTree.findFirst(tree, key)` — `Option<V>` for the first value at `key`.
- `RedBlackTree.findAll(tree, key)` — `Chunk<V>` for all values at `key` (the tree allows duplicate keys).
- `RedBlackTree.has(tree, key)` — `boolean`. (`repos/effect/packages/effect/src/RedBlackTree.ts:225-228`)

**Relation to SortedMap/SortedSet:** `SortedMap` and `SortedSet` are ergonomic wrappers around `RedBlackTree` that hide the duplicate-key semantics and expose a map/set interface. If you need the full range API or duplicate keys, use `RedBlackTree` directly. If you only need an ordered map or set, see Chapter 42 — typeclass, which covers `SortedMap` (`repos/effect/packages/effect/src/SortedMap.ts:92-102`) and `SortedSet` (`repos/effect/packages/effect/src/SortedSet.ts:92-92`).

### Trie — prefix-indexed string map

**Source:** `repos/effect/packages/effect/src/Trie.ts` — stable since 2.0.0.

The module-level JSDoc (`repos/effect/packages/effect/src/Trie.ts:1-17`) summarises it well: a `Trie` works like a `HashMap` with the additional constraint that keys must be `string`. That constraint enables two things plain `HashMap` cannot offer: prefix lookups in O(prefix length + result count) instead of O(n), and a `longestPrefixOf` query that finds the longest stored key that is a prefix of a given input.

```ts
import { Option, Trie } from "effect"

const routes = Trie.empty<string>().pipe(
  Trie.insert("api/users", "users-handler"),
  Trie.insert("api/users/profile", "profile-handler"),
  Trie.insert("api/posts", "posts-handler"),
  Trie.insert("health", "health-handler")
)
```

**Core API** (`repos/effect/packages/effect/src/Trie.ts:60-372`):

- `Trie.empty<V>()` — empty trie. (`repos/effect/packages/effect/src/Trie.ts:60`)
- `Trie.fromIterable(entries)` — build from `Iterable<readonly [string, V]>`. (`repos/effect/packages/effect/src/Trie.ts:81`)
- `Trie.make(...entries)` — vararg. (`repos/effect/packages/effect/src/Trie.ts:100-102`)
- `Trie.insert(trie, key, value)` — returns a new `Trie`; O(key length). (`repos/effect/packages/effect/src/Trie.ts:128-131`)
- `Trie.keysWithPrefix(trie, prefix)` — lazy iterator of all keys sharing `prefix`. (`repos/effect/packages/effect/src/Trie.ts:254-257`)
- `Trie.entriesWithPrefix(trie, prefix)` — lazy `[key, value]` pairs with `prefix`. (`repos/effect/packages/effect/src/Trie.ts:312-315`)
- `Trie.longestPrefixOf(trie, key)` — returns `Option<[string, V]>` for the longest stored key that is a prefix of `key`. (`repos/effect/packages/effect/src/Trie.ts:369-372`)

Entries are always iterated in **alphabetical order**, regardless of insertion order — a natural property of the trie structure.

## A production example

The following example models a request-log analysis component. It uses all five collection types together to demonstrate their complementary strengths.

```ts
import { Data, HashMap, HashSet, List, Order, RedBlackTree, Trie } from "effect"

// --- Domain types ---

interface IpAddress {
  readonly value: string
}
const IpAddress = (value: string): IpAddress => Data.struct({ value })

interface RequestEntry {
  readonly timestamp: number  // Unix ms
  readonly ip: string
  readonly path: string
  readonly statusCode: number
}

// --- State ---

interface LogState {
  // HashMap: userId (structural key) -> request count for this session
  readonly requestCounts: HashMap.HashMap<IpAddress, number>
  // HashSet: IPs flagged as suspicious (structural equality deduplication)
  readonly suspiciousIps: HashSet.HashSet<IpAddress>
  // List: recent log entries, newest at head (O(1) prepend)
  readonly recentEntries: List.List<RequestEntry>
  // RedBlackTree: timestamp -> entry for time-range queries (O(log n) insert)
  readonly timeIndex: RedBlackTree.RedBlackTree<number, RequestEntry>
  // Trie: path prefix -> handler name for route matching
  readonly routeTable: Trie.Trie<string>
}

const emptyState: LogState = {
  requestCounts: HashMap.empty<IpAddress, number>(),
  suspiciousIps: HashSet.empty<IpAddress>(),
  recentEntries: List.nil<RequestEntry>(),
  timeIndex: RedBlackTree.empty<number, RequestEntry>(Order.number),
  routeTable: Trie.make(
    ["api/users", "users-handler"],
    ["api/users/profile", "profile-handler"],
    ["api/posts", "posts-handler"],
    ["health", "health-handler"]
  )
}

// --- Pure update functions ---

function recordRequest(state: LogState, entry: RequestEntry): LogState {
  const ip = IpAddress(entry.ip)

  // HashMap.modify — increment count atomically, defaulting to 0
  const requestCounts = HashMap.modifyAt(state.requestCounts, ip, (opt) =>
    opt._tag === "None"
      ? { _tag: "Some", value: 1 }
      : { _tag: "Some", value: opt.value + 1 }
  )

  // HashSet.add — flag IP if it has accumulated >100 requests
  const count = HashMap.get(requestCounts, ip)
  const suspiciousIps = count._tag === "Some" && count.value > 100
    ? HashSet.add(state.suspiciousIps, ip)
    : state.suspiciousIps

  // List.cons — prepend the new entry; O(1), preserves history
  const recentEntries = List.cons(entry, state.recentEntries)

  // RedBlackTree.insert — index by timestamp for range queries
  const timeIndex = RedBlackTree.insert(state.timeIndex, entry.timestamp, entry)

  return { ...state, requestCounts, suspiciousIps, recentEntries, timeIndex }
}

function queryTimeRange(
  state: LogState,
  from: number,
  to: number
): Array<RequestEntry> {
  // RedBlackTree range traversal — O(log n + result count)
  // greaterThanEqual(from) gives all entries with timestamp >= from
  // We then filter to < to in the loop
  const results: Array<RequestEntry> = []
  for (const [ts, entry] of RedBlackTree.greaterThanEqual(state.timeIndex, from)) {
    if (ts >= to) break
    results.push(entry)
  }
  return results
}

function resolveRoute(state: LogState, path: string): string {
  // Trie.longestPrefixOf — finds the best matching route prefix
  // e.g. "api/users/profile/avatar" matches "api/users/profile"
  const match = Trie.longestPrefixOf(state.routeTable, path)
  return match._tag === "Some" ? match.value[1] : "not-found"
}

// --- Usage ---

let state = emptyState
state = recordRequest(state, { timestamp: 1000, ip: "10.0.0.1", path: "api/users", statusCode: 200 })
state = recordRequest(state, { timestamp: 2000, ip: "10.0.0.2", path: "api/posts", statusCode: 200 })
state = recordRequest(state, { timestamp: 3000, ip: "10.0.0.1", path: "api/users/profile", statusCode: 200 })

console.log(queryTimeRange(state, 1500, 3500))   // entries at ts 2000 and 3000
console.log(resolveRoute(state, "api/users/profile/avatar")) // "profile-handler"
console.log(HashSet.size(state.suspiciousIps))   // 0 (counts are low)
```

Every `recordRequest` call returns a completely new `LogState` with none of the collections mutated. The previous state is still valid; you can snapshot it, compare it, or roll back to it without any extra work.

## Variations

**1. `HashMap.modifyAt` for insert-or-update in one step**

```ts
import { HashMap, Option } from "effect"

// Increment a counter, inserting 0 -> 1 if key was absent
const bump = <K>(map: HashMap.HashMap<K, number>, key: K) =>
  HashMap.modifyAt(map, key, (opt: Option.Option<number>) =>
    Option.some(Option.getOrElse(opt, () => 0) + 1)
  )
```

**2. `HashSet.union` and `HashSet.intersection` for set algebra**

```ts
import { HashSet } from "effect"

const a = HashSet.make(1, 2, 3)
const b = HashSet.make(2, 3, 4)
const union = HashSet.union(a, b)        // {1, 2, 3, 4}
const inter = HashSet.intersection(a, b) // {2, 3}
const diff  = HashSet.difference(a, b)   // {1}
```

**3. Converting `List` to `Chunk` for stream pipelines**

```ts
import { Chunk, List } from "effect"

const list = List.make(1, 2, 3)
// List -> Array is built-in; then Array -> Chunk
const chunk = Chunk.fromIterable(list) // Chunk<number>
```

**4. `RedBlackTree.greaterThanEqual` + `lessThan` for closed-range queries**

```ts
import { Order, RedBlackTree } from "effect"

const tree = RedBlackTree.fromIterable(Order.number)(
  [[1, "a"], [3, "b"], [5, "c"], [7, "d"], [9, "e"]]
)
// Keys in [3, 7): collect from >= 3, stop at >= 7
const range: Array<[number, string]> = []
for (const entry of RedBlackTree.greaterThanEqual(tree, 3)) {
  if (entry[0] >= 7) break
  range.push(entry)
}
// [[3, "b"], [5, "c"]]
```

**5. `Trie.keysWithPrefix` for autocomplete**

```ts
import { Trie } from "effect"

const dictionary = Trie.make(
  ["apple", 1], ["application", 2], ["apply", 3], ["banana", 4]
)
const suggestions = Array.from(Trie.keysWithPrefix(dictionary, "app"))
// ["apple", "application", "apply"]
```

**6. `SortedMap` / `SortedSet` (note — covered in Chapter 42)**

`SortedMap<K, V>` (`repos/effect/packages/effect/src/SortedMap.ts:92-102`) and `SortedSet<A>` (`repos/effect/packages/effect/src/SortedSet.ts:92-92`) are ergonomic wrappers around `RedBlackTree` that provide a map/set interface with guaranteed sorted iteration. Both require an `Order<K>` at construction time and are covered in depth in Chapter 42 — typeclass, alongside the `Order` typeclass itself.

## Anti-patterns

### Using `Map<{...}, V>` for composite keys

```ts
// WRONG — reference equality; lookups always miss for fresh objects
const wrong = new Map<{ x: number; y: number }, string>()
wrong.set({ x: 1, y: 2 }, "point")
wrong.get({ x: 1, y: 2 }) // undefined — different reference

// CORRECT — structural equality via Data.struct
import { Data, HashMap } from "effect"
const Point = (x: number, y: number) => Data.struct({ x, y })
let correct = HashMap.empty<ReturnType<typeof Point>, string>()
correct = HashMap.set(correct, Point(1, 2), "point")
HashMap.get(correct, Point(1, 2)) // Option.some("point")
```

The same applies to `Set` vs `HashSet`: `new Set([Point(1,2), Point(1,2)])` has size 2; `HashSet.fromIterable([Point(1,2), Point(1,2)])` has size 1.

### Using `Array.unshift` as a persistent stack

```ts
// WRONG — O(n) and mutates in place
const log: Array<string> = []
log.unshift("event-3") // copies the entire array

// CORRECT — O(1) prepend, persistent
import { List } from "effect"
let log2 = List.nil<string>()
log2 = List.cons("event-3", log2) // structural sharing, old list intact
```

### Scanning a Map for prefix matches

```ts
// WRONG — O(n) scan on every autocomplete keystroke
const commands = new Map([["git-add", fn1], ["git-commit", fn2], ["grep", fn3]])
const matches = [...commands.entries()].filter(([k]) => k.startsWith("git"))

// CORRECT — O(prefix-length + results) with Trie
import { Trie } from "effect"
const cmdTrie = Trie.make(["git-add", fn1], ["git-commit", fn2], ["grep", fn3])
const gitCmds = Array.from(Trie.keysWithPrefix(cmdTrie, "git"))
```

### Sorting Map entries on every read

```ts
// WRONG — O(n log n) on every read
const events = new Map<number, string>()
const sorted = [...events.entries()].sort(([a], [b]) => a - b)

// CORRECT — O(log n) insert, O(n) sorted iteration with RedBlackTree
// (or SortedMap for a pure-map interface — see Chapter 42)
import { Order, RedBlackTree } from "effect"
let eventsTree = RedBlackTree.empty<number, string>(Order.number)
eventsTree = RedBlackTree.insert(eventsTree, 5, "later")
eventsTree = RedBlackTree.insert(eventsTree, 1, "earlier")
// Iteration is always in sorted order
```

## See also

- **Chapter 18 — Data, Equal, Hash** (`../part-1-foundations/18-data-equal-hash.md`) — the foundation this chapter builds on. `Data.struct`, `Data.Class`, `Equal.Equal`, and `Hash.Hash` are the mechanism that makes `HashMap` and `HashSet` work with value-typed keys. Read Chapter 18 before using composite keys in any collection here.
- **Chapter 12 — Option and Either** (`../part-1-foundations/12-option-and-either.md`) — `HashMap.get`, `RedBlackTree.findFirst`, and `Trie.longestPrefixOf` all return `Option<V>`. Fluent `Option` handling (`Option.getOrElse`, `Option.map`, `Option.flatMap`) is the correct way to consume those results without unsafe coercion.
- **Chapter 42 — typeclass (Order, SortedMap, SortedSet)** — the forward reference for `SortedMap` and `SortedSet`. Both are thin wrappers over `RedBlackTree` that expose a sorted-map / sorted-set interface via the `Order` typeclass. `SortedMap` source: `repos/effect/packages/effect/src/SortedMap.ts`. `SortedSet` source: `repos/effect/packages/effect/src/SortedSet.ts`.
- **Chapter 16 — Stream** — `Chunk` is Effect's primary sequence type inside stream pipelines and is the element container for `Stream<A>`. When converting between `List` and stream-compatible forms, the path is `List` → `Array` (via `List.toArray`) → `Chunk` (via `Chunk.fromIterable`). `RedBlackTree.findAll` returns a `Chunk<V>`.
- **Patterns catalog — [HashMap — structural-equality keyed map](../../research/02-patterns-catalog.md#hashmap--structural-equality-keyed-map)** — the full catalog entry with source citations.
- **Patterns catalog — [HashSet — structural-equality set](../../research/02-patterns-catalog.md#hashset--structural-equality-set)** — including the anti-pattern it replaces and When-to-use guidance.
- **Patterns catalog — [List — persistent linked list](../../research/02-patterns-catalog.md#list--persistent-linked-list)** — Scala provenance, structural sharing details, and the comparison with `Chunk`.
- **Patterns catalog — [RedBlackTree](../../research/02-patterns-catalog.md#redblacktree)** — range query API summary and comparison with sorted arrays.
- **Patterns catalog — [Trie](../../research/02-patterns-catalog.md#trie)** — prefix-search use cases and complexity analysis.
- **Per-package note:** `research/packages/effect.md` — the collections are listed under "Data and collections" alongside `Graph`, `HashRing`, and `SortedMap`/`SortedSet`. The note flags `Trie`, `Graph`, and `HashRing` as potentially internal-use modules that lacked catalog entries at the time of writing; this chapter confirms `Trie` is intended for application use.

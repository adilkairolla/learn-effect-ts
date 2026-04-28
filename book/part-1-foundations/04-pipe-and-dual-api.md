# Chapter 04 — The `pipe` function and the dual API style

> **Patterns introduced:** [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait), [`pipe` vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining)
> **Reads from:** [Chapter 02 — Effect as a value](02-effect-as-a-value.md), [Chapter 03 — Running Effects](03-running-effects.md)
> **Reads into:** every subsequent chapter — the API style is universal
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

JavaScript's standard composition techniques each have a critical weakness.

**Prototype methods** are ergonomic. You write `arr.filter(f).map(g).reduce(h, 0)` and it reads left-to-right, one operation per line. The problem is structural: every method has to live on the prototype of the type. For a library author, this means either shipping a massive class that can never be tree-shaken — you always get every method, even the ones your application never calls — or shipping a small class and leaving users to reach for external utility functions anyway. For a library user, this means you cannot add a step to a chain without forking the class or monkey-patching the prototype.

**Standalone functions** avoid the prototype problem. They can be imported individually (`import { map } from "./utils"`), they are tree-shakable, and they work on any value that fits the expected type — no class required. The problem is readability. When you need to apply a sequence of four transformations, you end up writing:

```ts
// Standalone, unpiped — reads right-to-left, outermost operation first.
const result = tap(map(flatMap(Effect.succeed(1), fetchUser), formatUser), logUser)
```

This is the nested function call problem. The code reads right-to-left, in reverse order of execution. Adding a fifth step means wrapping the whole expression in another call. Indenting for readability forces the opening and closing parentheses far apart.

**Method chaining on your own types** tries to get the best of both worlds by adding a `.pipe()` method that applies standalone functions in sequence. But this only works if the type implements that method.

What we want is:

1. Standalone, importable, tree-shakable functions — no prototype pollution.
2. Left-to-right reading order — the same ergonomics as prototype methods.
3. Works on any type that opts in — not hardcoded to one class.
4. Each operator usable both inside a pipeline and as a standalone call — no need to choose a style at authoring time.

Effect delivers all four with two mechanisms: the `pipe` function and the `dual` API convention. This chapter explains both and shows you the forms you will encounter throughout the rest of the book.

---

## The minimal example

```ts
import { pipe, Effect } from "effect"

// Form 1: standalone pipe — works on any value
const program = pipe(
  Effect.succeed(1),
  Effect.map((n) => n + 1),
  Effect.tap((n) => Effect.sync(() => console.log(n))),
)

// Form 2: method form — Effect types implement Pipeable, so .pipe() is always available
const program2 = Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),
  Effect.tap((n) => Effect.sync(() => console.log(n))),
)

// Form 3: data-first — use the operator as a plain function call
const program3 = Effect.map(Effect.succeed(1), (n) => n + 1)

// All three produce the same Effect<number, never, never>. The choice is stylistic.
```

---

## How it works

### `pipe` — left-to-right function application

`pipe` is defined at `repos/effect/packages/effect/src/Function.ts:526-538`. Its overloads follow this pattern:

```ts
export function pipe<A>(a: A): A
export function pipe<A, B>(a: A, ab: (a: A) => B): B
export function pipe<A, B, C>(a: A, ab: (a: A) => B, bc: (b: B) => C): C
// ... up to 20 overloads
```

The implementation is simple: it takes a value and a sequence of unary functions, then applies them left-to-right. `pipe(x, f, g, h)` is exactly `h(g(f(x)))` — but it reads in execution order. Each function receives the return value of the previous one, and TypeScript infers all intermediate types from left to right without annotation.

`pipe` is imported from the top-level `"effect"` package and works on any value — plain numbers, arrays, Option, Either, or Effect. It has no knowledge of Effect internals; it is purely a function application utility.

### The `Pipeable` trait — `.pipe()` without importing `pipe`

Most types in the Effect ecosystem implement the `Pipeable` interface, defined at `repos/effect/packages/effect/src/Pipeable.ts:11-13`:

```ts
export interface Pipeable {
  pipe<A>(this: A): A
  pipe<A, B>(this: A, ab: (_: A) => B): B
  pipe<A, B, C>(this: A, ab: (_: A) => B, bc: (_: B) => C): C
  // ... further overloads
}
```

Any type that implements `Pipeable` gets a `.pipe()` method. The concrete implementation lives at `repos/effect/packages/effect/src/Pipeable.ts:540-543`, as a shared `Prototype` object:

```ts
export const Prototype: Pipeable = {
  pipe() {
    return pipeArguments(this, arguments)
  }
}
```

`pipeArguments` (at `repos/effect/packages/effect/src/Pipeable.ts:496-526`) dispatches on `arguments.length` with a switch statement for the common arities, then falls back to a loop. It is the same logic as the standalone `pipe` function, just bound to `this`.

The types that implement `Pipeable` include `Effect`, `Layer`, `Stream`, `Schema`, `Option`, `Either`, and most others in the ecosystem. This means you can almost always write `value.pipe(f, g, h)` without importing `pipe` at all. The standalone `pipe` import remains useful for plain values that do not implement `Pipeable` (raw arrays, plain objects, etc.).

### `dual` — the two-call-shape convention

`dual` is the mechanism that allows every Effect operator to work in two forms without writing two separate functions.

Its type signature, at `repos/effect/packages/effect/src/Function.ts:95-103`, is:

```ts
export const dual: {
  <DataLast extends (...args: Array<any>) => any, DataFirst extends (...args: Array<any>) => any>(
    arity: Parameters<DataFirst>["length"],
    body: DataFirst
  ): DataLast & DataFirst
  <DataLast extends (...args: Array<any>) => any, DataFirst extends (...args: Array<any>) => any>(
    isDataFirst: (args: IArguments) => boolean,
    body: DataFirst
  ): DataLast & DataFirst
}
```

You pass `dual` the arity of the data-first form (the total argument count including `self`) and the data-first body function. `dual` wraps that function in a runtime check: if it was called with the full argument count, dispatch to the data-first body; if it was called with fewer arguments, return a curried function waiting for `self`.

The result type is `DataLast & DataFirst` — the returned function satisfies both call shapes simultaneously.

**`Effect.map` — a concrete example**

`Effect.map` is defined at `repos/effect/packages/effect/src/internal/core.ts:1039-1046`:

```ts
export const map: {
  <A, B>(f: (a: A) => B): <E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<B, E, R>
  <A, E, R, B>(self: Effect.Effect<A, E, R>, f: (a: A) => B): Effect.Effect<B, E, R>
} = dual(
  2,
  <A, E, R, B>(self: Effect.Effect<A, E, R>, f: (a: A) => B): Effect.Effect<B, E, R> =>
    flatMap(self, (a) => sync(() => f(a)))
)
```

The implementation body is the data-first form. `dual(2, body)` wraps it so that:

- `Effect.map(effect, f)` — two arguments, data-first, calls the body immediately.
- `Effect.map(f)` — one argument, data-last, returns `(self) => body(self, f)`.

The second form is what you use inside `pipe` or `.pipe()`. The first form is what you use when you are calling it on a single value without a pipeline.

**`Effect.flatMap` — the same pattern at the fiber level**

`Effect.flatMap` at `repos/effect/packages/effect/src/internal/core.ts:746-762` uses the same convention:

```ts
export const flatMap = dual<
  <A, B, E1, R1>(
    f: (a: A) => Effect.Effect<B, E1, R1>
  ) => <E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<B, E1 | E, R1 | R>,
  <A, E, R, B, E1, R1>(
    self: Effect.Effect<A, E, R>,
    f: (a: A) => Effect.Effect<B, E1, R1>
  ) => Effect.Effect<B, E | E1, R | R1>
>(
  2,
  (self, f) => { /* ... core primitive ... */ }
)
```

This is the pattern across the entire Effect API surface. Any operator that takes `self` as its first argument is defined this way, so it always participates in pipelines.

### Type inference through pipe

When you use the data-last form inside `pipe` or `.pipe()`, TypeScript infers the callback argument types from left to right. When you write:

```ts
Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),  // TypeScript knows n: number
)
```

TypeScript knows `n` is `number` because `Effect.succeed(1)` produces `Effect<number, never, never>`, and `Effect.map` in data-last form is typed to accept a callback `(a: A) => B` where `A` is inferred from the preceding `Effect<A, E, R>`. You get full inference without annotations.

If you wrote the nested form instead:

```ts
Effect.map(Effect.succeed(1), (n) => n + 1)
```

TypeScript still infers `n: number` — but in a long chain of nested calls, the nesting makes this harder to read and the intermediate types can only be inspected by counting parentheses.

---

## A production example

Take a small program that fetches a user, formats their name, logs the result, and returns the name. Below are all three equivalent forms, from least readable to most.

```ts
import { Effect } from "effect"

interface User { id: string; firstName: string; lastName: string }

declare const fetchUser: (id: string) => Effect.Effect<User, Error>
declare const saveAuditLog: (entry: string) => Effect.Effect<void, Error>

// --- Form 1: Nested calls — execution order is inside-out, hard to follow ---

const nestedForm = Effect.flatMap(
  fetchUser("u-1"),
  (user) => Effect.flatMap(
    Effect.succeed(`${user.firstName} ${user.lastName}`),
    (name) => Effect.map(
      saveAuditLog(`fetched ${name}`),
      () => name
    )
  )
)

// --- Form 2: pipe — linear, reads top-to-bottom in execution order ---

const pipeForm = pipe(
  fetchUser("u-1"),
  Effect.map((user) => `${user.firstName} ${user.lastName}`),
  Effect.flatMap((name) =>
    pipe(
      saveAuditLog(`fetched ${name}`),
      Effect.map(() => name),
    )
  ),
)

// --- Form 3: .pipe() method — same as Form 2, no import needed ---

const methodForm = fetchUser("u-1").pipe(
  Effect.map((user) => `${user.firstName} ${user.lastName}`),
  Effect.flatMap((name) =>
    saveAuditLog(`fetched ${name}`).pipe(
      Effect.map(() => name),
    )
  ),
)

// All three have the same inferred type: Effect.Effect<string, Error, never>
// All three are equivalent in behavior.
// Form 3 is the style you will see most in Effect codebases.
```

The `.pipe()` method form (Form 3) is what the Effect team uses in production and what you will see in the rest of this book. It requires no extra import, reads in execution order, and composes naturally with the `dual` API.

---

## Variations

**`pipe(self, fn1, fn2, ...)`** — the standalone `pipe`; works on any value, not just `Pipeable` types. Import from `"effect"`.

```ts
import { pipe } from "effect"
const result = pipe([1, 2, 3], (arr) => arr.filter((n) => n > 1), (arr) => arr.length)
```

**`self.pipe(fn1, fn2, ...)`** — the `Pipeable` trait method; available on `Effect`, `Layer`, `Stream`, `Schema`, `Option`, `Either`, and most other Effect types. No import required.

```ts
import { Effect } from "effect"
const doubled = Effect.succeed(5).pipe(Effect.map((n) => n * 2))
```

**`Effect.map(self, f)`** — data-first form; useful when applying a single operator without a pipeline. Defined via `dual` at `repos/effect/packages/effect/src/internal/core.ts:1042`.

```ts
import { Effect } from "effect"
const incremented = Effect.map(Effect.succeed(1), (n) => n + 1)
```

**`Effect.map(f)`** — data-last (curried) form; returns a function `(self) => ...` that fits into `pipe` or `.pipe()`.

```ts
import { Effect } from "effect"
const addOne = Effect.map((n: number) => n + 1)
// addOne: (self: Effect<number, E, R>) => Effect<number, E, R>
```

**`dual<DataLast, DataFirst>(arity, fn)`** — the helper for defining your own dual operators. Export the result and your users get both call shapes automatically.

```ts
import { dual } from "effect/Function"
import { Effect } from "effect"

export const withTimeout: {
  (ms: number): <A, E, R>(self: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  <A, E, R>(self: Effect.Effect<A, E, R>, ms: number): Effect.Effect<A, E, R>
} = dual(2, <A, E, R>(self: Effect.Effect<A, E, R>, ms: number) =>
  Effect.timeout(self, ms)
)
```

---

## Anti-patterns

### Mixing styles within one expression

Alternating between `pipe`, `.pipe()`, and nested calls in a single expression makes the flow of data hard to follow. Pick one style per expression and keep it consistent.

```ts
import { pipe, Effect } from "effect"

// Wrong: the reader must track three different composition styles at once.
const bad = pipe(
  Effect.succeed(1).pipe(Effect.map((n) => n + 1)),
  Effect.flatMap((n) => Effect.map(Effect.succeed(n * 2), (r) => r.toString())),
)

// Right: pick .pipe() and use it throughout.
const good = Effect.succeed(1).pipe(
  Effect.map((n) => n + 1),
  Effect.flatMap((n) => Effect.succeed(n * 2).pipe(Effect.map((r) => r.toString()))),
)
```

### Importing `pipe` when the type already implements `Pipeable`

If the value you are working with is an `Effect`, `Layer`, `Stream`, `Option`, or any other `Pipeable` type, importing the standalone `pipe` from `"effect"` adds a dependency you do not need.

```ts
import { pipe, Effect } from "effect"

// Unnecessary: Effect already has .pipe()
const bad = pipe(Effect.succeed(1), Effect.map((n) => n + 1))

// Better: use the method directly
const good = Effect.succeed(1).pipe(Effect.map((n) => n + 1))
```

Reserve the `pipe` import for plain values — arrays, strings, plain objects — that do not implement `Pipeable`.

### Writing custom operators without the `dual` convention

If you write a library function that only works as `f(self, arg)` (data-first only), users who compose with pipelines must write `pipe(self, (s) => f(s, arg))` — an unnecessary wrapper. If you write it as only `f(arg)(self)` (data-last only), users who call it standalone must write `f(arg)(self)` with reversed-feeling argument order. `dual` eliminates the choice entirely.

```ts
import { dual } from "effect/Function"

// Wrong: forces users into one style.
const badTransform = (self: string, prefix: string): string => `${prefix}:${self}`

// Right: dual lets users call it either way.
export const transform: {
  (prefix: string): (self: string) => string
  (self: string, prefix: string): string
} = dual(2, (self: string, prefix: string): string => `${prefix}:${self}`)
```

---

## See also

- [Chapter 02 — Effect as a value](02-effect-as-a-value.md) — explains `Effect<A, E, R>` as a lazy description; understanding why you compose before running motivates the pipe style
- [Chapter 03 — Running Effects](03-running-effects.md) — the `run*` functions consume the composed Effect; `.pipe()` is used in those examples
- [Chapter 05 — Effect.gen](05-effect-gen.md) — the generator-based alternative to `pipe` chains; use `gen` when you need branching, loops, or local bindings that `pipe` makes awkward
- [Chapter 11 — Constructors](11-constructors.md) — `.make`, `.of`, and the naming conventions that complement the dual API style
- [Chapter 53 — The dual API surface](../part-3-authoring/53-dual-api.md) — adding `dual(...)` to a real worked-example library (`effect-cache`)
- [Patterns Catalog: Dual data-first / data-last](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — canonical reference entry with the full signature
- [Patterns Catalog: pipe vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining) — when to use each form and the anti-pattern they replace

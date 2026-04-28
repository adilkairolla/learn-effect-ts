# @effect/typeclass

> Source: `repos/effect/packages/typeclass/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: core
> Effect deps: `effect` (peer + dev, `"effect": "workspace:^"` — `repos/effect/packages/typeclass/package.json:51-53`)

## What it does

`@effect/typeclass` is the algebraic-abstraction layer of the Effect ecosystem: it defines a hierarchy of parameterized interfaces — `Covariant`, `Monad`, `Traversable`, `Semigroup`, `Monoid`, and so on — that any data type can implement, unlocking a library of generic combinators for free. Library authors consume it when writing code that is *polymorphic over the container type* (e.g., a function that works on both `Effect` and `Option` by only requiring `Monad<F>`). Without this package every generic pattern would have to be re-implemented per type. It is also the canonical reference for how Effect encodes higher-kinded types in plain TypeScript via `TypeLambda`/`Kind` — the encoding other typed-FP TypeScript libraries copy.

## Public API surface

All modules live under `repos/effect/packages/typeclass/src/` and are re-exported from `index.ts` (`repos/effect/packages/typeclass/src/index.ts:1-129`).

**The HKT spine (lives in `effect` core, consumed here)**

- `effect/HKT` — `TypeLambda`, `TypeClass<F>`, `Kind<F,In,Out2,Out1,Target>`: the three primitives the entire package is built on (`repos/effect/packages/effect/src/HKT.ts:1-46`).

**Algebraic typeclasses (monomorphic, no `TypeLambda`)**

- `Semigroup` — `combine`, `combineMany`; constructors `make`, `min`, `max`, `first`, `last`, `reverse`, `intercalate`; combinators `tuple`, `struct`, `array` (`repos/effect/packages/typeclass/src/Semigroup.ts:16-239`).
- `Monoid` — extends `Semigroup`; adds `empty`, `combineAll`; `fromSemigroup`, `tuple`, `struct` (`repos/effect/packages/typeclass/src/Monoid.ts:12-111`).
- `Bounded` — `compare`, `minBound`, `maxBound`; `between`, `clamp`, `reverse` (`repos/effect/packages/typeclass/src/Bounded.ts:15-73`).

**Functor-family (parameterized by a `TypeLambda`)**

- `Invariant<F>` — hierarchy root; `imap`; `bindTo`, `tupled` (`repos/effect/packages/typeclass/src/Invariant.ts:16-70`).
- `Covariant<F>` — extends `Invariant`; `map`; derived `flap`, `as`, `asVoid`, `let`, `mapComposition` (`repos/effect/packages/typeclass/src/Covariant.ts:12-135`).
- `Contravariant<F>` — `contramap`; two contravariants compose to a covariant (`repos/effect/packages/typeclass/src/Contravariant.ts:12-45`).
- `Bicovariant<F>` — `bimap` over the error and success channels; derived `mapLeft`, `map` (`repos/effect/packages/typeclass/src/Bicovariant.ts:12-68`).
- `Of<F>` — `of`; derived `Do`, `void` (`repos/effect/packages/typeclass/src/Of.ts:10-43`).
- `FlatMap<F>` — `flatMap`; derived `flatten`, `zipRight`, `composeK` (Kleisli) (`repos/effect/packages/typeclass/src/FlatMap.ts:11-73`).
- `Chainable<F>` — extends `FlatMap + Covariant`; derived `tap`, `bind` (do-notation) (`repos/effect/packages/typeclass/src/Chainable.ts:14-82`).
- `Monad<F>` — extends `FlatMap + Pointed`; interface body is three lines (`repos/effect/packages/typeclass/src/Monad.ts:12`).

**Product / coproduct families**

- `SemiProduct<F>` / `Product<F>` — `product`, `productMany`, `productAll`; `tuple`, `struct` constructors (`repos/effect/packages/typeclass/src/SemiProduct.ts:14-24`, `repos/effect/packages/typeclass/src/Product.ts:13-17`).
- `SemiApplicative<F>` / `Applicative<F>` — derived `getSemigroup`, `getMonoid`, `zipWith`, `ap`, `lift2` (`repos/effect/packages/typeclass/src/SemiApplicative.ts:15-127`, `repos/effect/packages/typeclass/src/Applicative.ts:15-30`).
- `SemiCoproduct<F>` / `Coproduct<F>` / `SemiAlternative<F>` / `Alternative<F>` — `coproduct`, `zero`, `coproductAll`; non-determinism/choice hierarchy (`repos/effect/packages/typeclass/src/Coproduct.ts:13-31`, `repos/effect/packages/typeclass/src/Alternative.ts:12`).

**Traversal / filtration**

- `Foldable<F>` — `reduce`; derived `toArray`, `combineMap`, `reduceKind`, `coproductMapKind` (`repos/effect/packages/typeclass/src/Foldable.ts:15-114`).
- `Filterable<F>` — `partitionMap`, `filterMap`; derived `compact`, `filter`, `partition` (`repos/effect/packages/typeclass/src/Filterable.ts:16-140`).
- `Traversable<T>` — `traverse` accepting any `Applicative<F>`; derived `sequence`, `traverseTap`, `traverseComposition` (`repos/effect/packages/typeclass/src/Traversable.ts:12-74`).
- `TraversableFilterable` — effectful `traversePartitionMap`, `traverseFilterMap` (`repos/effect/packages/typeclass/src/TraversableFilterable.ts`).

**Concrete data instances (`src/data/`)**

Ready-made instance objects for `Option`, `Either`, `Array`, `Record`, `Effect`, `Micro`, and eight more standard types (`repos/effect/packages/typeclass/src/data/`). Import these when calling generic combinators with concrete Effect types.

## Patterns used

- [Dual data-first / data-last (`dual(...)`)](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — every exported combinator uses `dual(2, ...)` or `dual(3, ...)` so it works both directly and inside `pipe` (`repos/effect/packages/typeclass/src/Covariant.ts:46-53`, `repos/effect/packages/typeclass/src/FlatMap.ts:36-48`, `repos/effect/packages/typeclass/src/Chainable.ts:32-35`).
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all 24 typeclass modules are individually importable as deep paths (`@effect/typeclass/Covariant`) and also aggregated through a single `index.ts` using `export * as Covariant from "./Covariant.js"` (`repos/effect/packages/typeclass/src/index.ts:1-129`).
- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `Semigroup.make` provides a canonical constructor that derives `combineMany` automatically when only `combine` is given, eliminating boilerplate for the 95% case (`repos/effect/packages/typeclass/src/Semigroup.ts:37-43`).
- [`JSDoc` `@since`, `@category`, `@example` tags](../02-patterns-catalog.md#jsdoc-since-category-example-tags) — every export carries `@since 0.24.0` and a `@category` tag (`type class`, `instances`, `mapping`, `do notation`, etc.); `Covariant.let` includes a fully worked `@example` with custom `TypeLambda` definition and `Do`-notation (`repos/effect/packages/typeclass/src/Covariant.ts:99-135`).

## What's unique about this package's design

The deepest design decision is the **`TypeLambda`/`Kind` encoding** for higher-kinded types — something TypeScript does not natively support.

TypeScript cannot abstract over a type constructor `F<_>`. The `@effect/typeclass` solution is a **type-level lambda**: `TypeLambda` is an interface with four phantom fields (`In`, `Out2`, `Out1`, `Target`) and an optional `type` field (`repos/effect/packages/effect/src/HKT.ts:21-26`). To represent `Option<A>`, declare `interface OptionTypeLambda extends TypeLambda { readonly type: Option<this["Target"]> }`. The `Kind<F, R, O, E, A>` utility intersects `F` with a record that fills those slots and reads back `F["type"]`, materializing the concrete type (`repos/effect/packages/effect/src/HKT.ts:31-45`).

Three consequences: (1) the four slots map onto Effect's `R/O/E/A` signature, encoding variance without extra wrappers; (2) `TypeClass<F>` holds a `readonly [URI]?: F` phantom whose unique symbol prevents unrelated instances colliding structurally (`repos/effect/packages/effect/src/HKT.ts:8-16`); (3) `Kind` is a pure type-level computation — zero runtime overhead. The result: `Traversable.traverseComposition` (`repos/effect/packages/typeclass/src/Traversable.ts:31-39`) takes two `Traversable` dictionaries for *different* `TypeLambda`s and composes them into a third, all statically typed.

## Conventions observed

- **Typeclass = plain interface.** Every typeclass is a plain `interface Foo<F extends TypeLambda>` with named method slots — no abstract class, no prototype. Implementors supply a plain object literal (`repos/effect/packages/typeclass/src/data/Option.ts:81-84`).
- **Dictionary-passing style.** Generic combinators receive the instance as first argument: `const map = <F extends TypeLambda>(F: Covariant<F>) => ...`. Naming the dictionary `F` (uppercase) to mirror the type parameter is uniform across all 24 modules (`repos/effect/packages/typeclass/src/Covariant.ts:46`).
- **Four-channel variance.** `Kind<F, R, O, E, A>` maps onto Effect's `R/O/E/A` slots. Types that only use `Target` set the other three to `never`/`unknown` in their `TypeLambda` (`repos/effect/packages/typeclass/src/data/Option.ts:47`).
- **`imap` as hierarchy root.** Every parameterized typeclass ultimately extends `Invariant<F>`. Higher classes derive a free `imap` via `covariant.imap(map)` or `contravariant.imap(contramap)`, keeping instance objects minimal (`repos/effect/packages/typeclass/src/Covariant.ts:38-40`).
- **`Semi-*` / full split.** `SemiProduct`/`Product`, `SemiCoproduct`/`Coproduct`, `SemiApplicative`/`Applicative`, `SemiAlternative`/`Alternative` — the `Semi-` prefix marks typeclasses without a unit, allowing non-unital structures to still get combinators.
- **`data/` as instance registry.** Witnesses live in `src/data/`; the main Effect modules carry no typeclass dependency. The package itself only imports from `effect/HKT`, `effect/Function`, and the standard data modules.

## "If you were authoring something similar, copy this"

- **The `TypeLambda`/`Kind` encoding** (`repos/effect/packages/effect/src/HKT.ts:21-45`). Declare `interface MyTypeLambda extends TypeLambda { readonly type: MyType<this["Target"]> }` once; all generic combinators become available for free. No codegen, no plugins.
- **`TypeClass<F>` phantom marker** (`repos/effect/packages/effect/src/HKT.ts:8-16`). Adding `readonly [URI]?: F` prevents TypeScript from structurally unifying unrelated instances that happen to have the same method names.
- **Default derivations via exported functions.** Rather than forcing every implementor to write `imap` from scratch, `Covariant` exports `export const imap = (map) => dual(3, (self, to, _) => map(self, to))` — implementors call it once (`repos/effect/packages/typeclass/src/Covariant.ts:38-40`). This "derive from minimal" idiom minimizes implementation burden.
- **`SemiX` / `X` split for non-unital structures** (`repos/effect/packages/typeclass/src/SemiProduct.ts:14-24`, `repos/effect/packages/typeclass/src/Product.ts:13-17`). Splitting lets non-unital types (e.g., non-empty lists) implement `SemiProduct` and gain combinators like `zip` without needing `of`.
- **Dictionary objects, not classes.** `export const Monad: monad.Monad<Option.OptionTypeLambda> = { imap, of, map, flatMap }` (`repos/effect/packages/typeclass/src/data/Option.ts:134-139`). Consumers import only what they need; tree-shaking removes the rest.
- **`mapComposition` / `traverseComposition` helpers** (`repos/effect/packages/typeclass/src/Covariant.ts:24-31`, `repos/effect/packages/typeclass/src/Traversable.ts:31-39`). Exporting named composition proofs spares users from re-deriving them.

## Open questions

1. **Laws are not encoded.** No law-checking utilities (`checkFunctorLaws(F, Arbitrary)`) are provided. Is there an expectation that consumers use `fast-check` with hand-written tests, or is a laws package planned?
2. **`data/Effect.ts` concurrency options.** `getApplicative` / `getProduct` accept `ConcurrencyOptions` (`repos/effect/packages/typeclass/src/data/Effect.ts:36-157`), making the `Applicative` for `Effect` a factory rather than a singleton. It is unclear how library authors should thread these options through generic algorithms.
3. **`SemigroupTypeLambda` / `BoundedTypeLambda`.** `Semigroup` and `Bounded` define their own `TypeLambda`s (`repos/effect/packages/typeclass/src/Semigroup.ts:25-27`, `repos/effect/packages/typeclass/src/Bounded.ts:25-27`), enabling the typeclass hierarchy to parameterize over them. Practical uses beyond `Invariant<SemigroupTypeLambda>` are undocumented.
4. **Absence of `Profunctor`.** The hierarchy covers covariant, contravariant, invariant, and bicovariant but omits `Profunctor` (contravariant in the first arg, covariant in the second). Is this intentional or a gap for future arrow/lens encodings?

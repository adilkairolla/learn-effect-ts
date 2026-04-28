# @effect/vitest

> Source: `repos/effect/packages/vitest/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: tooling
> Effect deps: `effect` (peer, `workspace:^`), `vitest` (peer, `^3.2.0`) — see `repos/effect/packages/vitest/package.json:37-40`

## What it does

`@effect/vitest` bridges Effect's fiber runtime and test-service layer into Vitest so test authors never call `Effect.runPromise` manually or wire up `TestContext` by hand. It provides a drop-in `it` augmented with Effect-aware variants (`it.effect`, `it.scoped`, `it.live`, `it.scopedLive`). Without it every test would need its own `Effect.runPromise(effect.pipe(Effect.provide(TestEnvironment.TestContext)))` boilerplate, lose deterministic time control, and have no fiber-aware interrupt/cleanup guarantees on timeout.

The package also re-exports the entire Vitest namespace (`export * from "vitest"` at `repos/effect/packages/vitest/src/index.ts:17`) so a single import line covers both Effect helpers and all standard Vitest APIs.

## Public API surface

Single entry point: `repos/effect/packages/vitest/src/index.ts`.

**Effect-aware test runners** — the four core testers:

- `it.effect` — test body runs inside `TestContext` (`TestClock`, `TestRandom`, `TestConfig`, `TestConsole` replace live services); logs silenced via `Logger.remove(Logger.defaultLogger)` (`repos/effect/packages/vitest/src/internal/internal.ts:62-64`; `repos/effect/packages/vitest/src/index.ts:186`).
- `it.live` — no injected environment; real clock, real randomness, real logging (`repos/effect/packages/vitest/src/index.ts:196`).
- `it.scoped` — `it.effect` + automatic `Effect.scoped` wrapper so `acquireRelease` resources are released when the test finishes (`repos/effect/packages/vitest/src/index.ts:191`).
- `it.scopedLive` — `it.live` + `Effect.scoped` (`repos/effect/packages/vitest/src/index.ts:201`).

All four expose `.skip`, `.only`, `.skipIf`, `.runIf`, `.each`, `.fails` (`repos/effect/packages/vitest/src/index.ts:93-125`).

**Layer-scoped test suites** — `layer(MyLayer)` / `layer(MyLayer)("suite name", …)` builds the layer once via `beforeAll`/`afterAll`, wires it into every `it.effect` call through a cached `Runtime`, and closes the scope on teardown. Supports nested `.layer(…)` calls for composable service stacks and `excludeTestServices: true` for live-only runtimes (`repos/effect/packages/vitest/src/internal/internal.ts:189-275`).

**Other exports** — `flakyTest(effect, timeout?)` retries an effect up to 10 times within `timeout` using `Schedule.recurs` + `Schedule.elapsed` (`repos/effect/packages/vitest/src/internal/internal.ts:278-292`); `it.prop` / `prop` integrate `effect/FastCheck` with optional `Schema`-to-arbitrary conversion (`repos/effect/packages/vitest/src/internal/internal.ts:121-186`); `addEqualityTesters()` hooks `Equal.equals` into Vitest's matcher chain (`repos/effect/packages/vitest/src/internal/internal.ts:67-79`); `src/utils.ts` exports `assertSome`, `assertNone`, `assertLeft`, `assertRight`, `assertSuccess`, `assertFailure`, and a full set of typed assertion helpers wrapping `node:assert`.

## Patterns used

- [Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `layer()` calls `Layer.toRuntimeWithMemoMap` with a merged `TestContext` layer to produce a single shared `Runtime` per suite; scope closes in `afterAll` (`repos/effect/packages/vitest/src/internal/internal.ts:217-224`).
- [Layer composition](../02-patterns-catalog.md#layermerge--provide--fresh--layer-composition) — `Layer.provideMerge(userLayer, TestEnv)` keeps `TestServices` available alongside user services unless `excludeTestServices: true` (`repos/effect/packages/vitest/src/internal/internal.ts:214-216`).
- [`Effect.acquireRelease`](../02-patterns-catalog.md#effectacquirerelease--acquireuserelease) — `it.scoped` / `it.scopedLive` call `Effect.scoped` around the test body so resources release on completion or failure (`repos/effect/packages/vitest/src/internal/internal.ts:298-300`).
- [Structured concurrency via Scope](../02-patterns-catalog.md#structured-concurrency-via-scope) — `layer()` allocates a `Scope`, extends the runtime into it, closes it in `afterAll`; timeouts interrupt the fiber via `ctx.onTestFinished` (`repos/effect/packages/vitest/src/internal/internal.ts:219-221`, `33-36`).
- [`Equal.equals` and `Hash`](../02-patterns-catalog.md#equalequals-interface-and-hash--structural-equality) — `addEqualityTesters()` hooks `Equal.equals` into Vitest so `toEqual` works with `Option`, `Either`, `Exit`, `Data.*` (`repos/effect/packages/vitest/src/internal/internal.ts:67-79`).
- [Exit — Effect outcome value](../02-patterns-catalog.md#exit--effect-outcome-value-success--failure-of-cause) — `runPromise` captures results via `Effect.exit` and rethrows `Cause.prettyErrors` for Vitest's reporter (`repos/effect/packages/vitest/src/internal/internal.ts:38-55`).
- [Random — testable RNG](../02-patterns-catalog.md#random--testable-seed-based-rng-service) — `TestContext` swaps the live `Random` service for a controllable implementation, making `Random.next`-dependent effects reproducible without extra setup.
- [Schedule combinators](../02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — `flakyTest` composes `Schedule.recurs(10)` with `Schedule.elapsed` and `Schedule.whileOutput` (`repos/effect/packages/vitest/src/internal/internal.ts:283-291`).

## What's unique about this package's design

The core insight is **context inversion**: the test runner, not the test author, provides `TestContext`. `it.effect` is `makeTester(Effect.provide(TestEnv), it)` where `TestEnv = TestContext.TestContext.pipe(Layer.provide(Logger.remove(Logger.defaultLogger)))` (`repos/effect/packages/vitest/src/internal/internal.ts:62-64`, `297`). Authors write plain Effect generators; the harness ensures the right test services are in scope.

`layer()` extends this: it pre-builds a `Runtime` once via `Layer.toRuntimeWithMemoMap` and wraps every `it.effect` call with `Effect.provide(runtime)` (`repos/effect/packages/vitest/src/internal/internal.ts:229-231`). Service layers initialize once per suite — matching production startup — while remaining inside Vitest's `beforeAll`/`afterAll` lifecycle.

The `TestClock` split (`it.effect` vs `it.live`) makes time-dependent tests deterministic by default. An effect calling `Clock.sleep("1 hour")` inside `it.effect` completes instantly once `TestClock.adjust("1 hour")` is issued — wall-clock time is a first-class test operation (`repos/effect/packages/vitest/README.md:116-161`). Fiber-aware teardown: `ctx.onTestFinished` interrupts the running fiber on timeout so finalizers always execute (`repos/effect/packages/vitest/src/internal/internal.ts:33-36`).

## Conventions observed

Standard Effect layout (`src/`, `src/internal/`, single `src/index.ts` barrel). One deviation: `src/index.ts` opens with `export * from "vitest"` (wildcard named re-export) making `@effect/vitest` a full drop-in for `vitest` (`repos/effect/packages/vitest/src/index.ts:17`).

`it` is produced by `Object.assign(V.it, { ...methods, scopedFixtures: V.it.scoped.bind(V.it) })` (`repos/effect/packages/vitest/src/index.ts:280-283`); Vitest's built-in `.scoped` fixture is renamed to `it.scopedFixtures` to avoid collision with `it.scoped`.

The `Vitest.Methods` / `Vitest.MethodsNonLive` / `Vitest.Tester` namespace hierarchy types the augmented `it` without extra imports for callers (`repos/effect/packages/vitest/src/index.ts:63-176`).

Logger suppression via `Logger.remove(Logger.defaultLogger)` silences all `it.effect` tests by default; opt in by providing `Logger.pretty` or switching to `it.live` (`repos/effect/packages/vitest/src/internal/internal.ts:62-64`; `repos/effect/packages/vitest/README.md:247-268`).

## "If you were authoring something similar, copy this"

- **Patch, don't replace**: `Object.assign(V.it, methods)` preserves Vitest's `.only`/`.skip` type narrowing; a wrapper class would break them (`repos/effect/packages/vitest/src/index.ts:280-283`).
- **Single `makeTester` for all variants**: a different `mapEffect` function is the only argument that varies between `effect`, `live`, `scoped`, and `scopedLive` — adding a new variant is one call (`repos/effect/packages/vitest/src/internal/internal.ts:86-159`, `295-304`).
- **Memoize the layer runtime**: `Layer.makeMemoMap` + `Layer.toRuntimeWithMemoMap` builds once per suite, preventing resource duplication across tests (`repos/effect/packages/vitest/src/internal/internal.ts:217-218`).
- **`layer()` as a declarative suite wrapper**: a callback-based API rather than `beforeAll`/`afterAll` in test files makes teardown automatic and impossible to forget (`repos/effect/packages/vitest/src/internal/internal.ts:252-274`).
- **Schema-to-arbitrary bridging**: `Schema.isSchema(arb) ? Arbitrary.make(arb) : arb` lets `prop` accept `Schema` or raw fast-check arbitraries interchangeably; refinements are encoded in generated values (`repos/effect/packages/vitest/src/internal/internal.ts:124-126`).

## Open questions

1. **`addEqualityTesters()` opt-in**: must be called in `setupFiles`; the Effect monorepo's own tests use typed helpers from `"@effect/vitest/utils"` instead, leaving the canonical approach unclear.
2. **`excludeTestServices` type gap**: `layer(SomeLayer, { excludeTestServices: true })` removes `TestContext`, so `TestClock.adjust` inside `it.effect` silently fails at runtime — not a type error.
3. **`flakyTest` retry count is hard-coded** at 10 (`repos/effect/packages/vitest/src/internal/internal.ts:284`); no way to pass a custom `Schedule`.
4. **`makeMethods` / `describeWrapped` stability**: exported without documentation; unclear whether they are a stable extension API or effectively internal.

# @effect/workflow

> Source: `repos/effect/packages/workflow/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: domain
> Effect deps: `effect`, `@effect/experimental`, `@effect/platform`, `@effect/rpc` (all peer deps; verified in `repos/effect/packages/workflow/package.json:35-40`)

## What it does

`@effect/workflow` provides durable, restart-safe execution of long-running business processes — the same problem space as Temporal or Restate, but integrated natively with the Effect type system. A `Workflow` records every `Activity` result in a persistent journal; if the process dies mid-run, the engine replays the journal to fast-forward to the last known state without re-executing completed side effects. Without this package, teams must implement their own checkpoint/rollback logic or accept data inconsistency after crashes. Consumers are application developers who need multi-step processes (order fulfilment, approval flows, email campaigns) resilient to restarts and operator intervention.

## Public API surface

All modules are re-exported from `repos/effect/packages/workflow/src/index.ts:1-44`.

- **`Workflow`** (`src/Workflow.ts:263-711`) — `Workflow.make` defines a named, schema-typed execution with payload, success, error, and an idempotency key. The returned object carries `.execute`, `.poll`, `.interrupt`, `.resume`, `.toLayer`, and `.withCompensation`. The `Result` union — `Complete<A,E>` or `Suspended` — is the serializable journal form (`src/Workflow.ts:400-505`). `CaptureDefects` and `SuspendOnFailure` are `Context.Reference` annotations tuning per-workflow behaviour (`src/Workflow.ts:693-711`).

- **`Activity`** (`src/Activity.ts:85-226`) — unit of durable work. `Activity.make` wraps any `Effect` with a name and schemas; the engine records the result after the first execution and short-circuits on replay. `Activity.CurrentAttempt` is a `Context.Reference` readable inside the execute effect (`src/Activity.ts:175-177`). `Activity.idempotencyKey` derives a stable SHA-256-based key for use in external APIs (`src/Activity.ts:183-199`). `Activity.raceAll` persists whichever of several activities finishes first (`src/Activity.ts:205-226`).

- **`WorkflowEngine`** (`src/WorkflowEngine.ts:24-183`) — the `Context.Tag` service interface all back-ends must satisfy: `register`, `execute`, `poll`, `interrupt`, `resume`, `activityExecute`, `deferredResult`, `deferredDone`, `scheduleClock`. `WorkflowEngine.makeUnsafe` adapts a lower-level `Encoded` interface (plain objects, `Exit<unknown, unknown>`) into the typed service, handling schema encode/decode (`src/WorkflowEngine.ts:317-458`). `WorkflowEngine.layerMemory` is an in-memory back-end for tests (`src/WorkflowEngine.ts:468-638`); the production back-end is `ClusterWorkflowEngine.layer` from `@effect/cluster`.

- **`WorkflowInstance`** (`src/WorkflowEngine.ts:189-246`) — per-execution `Context.Tag` carrying the execution ID, definition, a `CloseableScope`, mutable `suspended`/`interrupted` flags, and an `activityState` latch. Consumed by `Activity`, `DurableDeferred`, and `DurableClock` to communicate suspension state to the engine.

- **`DurableDeferred`** (`src/DurableDeferred.ts:62-293`) — named, persistent one-shot signal. `DurableDeferred.await` suspends the workflow; `DurableDeferred.token` produces a Base64-URL opaque token an external system can later use with `DurableDeferred.done` / `succeed` / `fail` to resume the workflow. `TokenParsed` encodes `(workflowName, executionId, deferredName)` as a URL-safe string (`src/DurableDeferred.ts:253-293`).

- **`DurableClock`** (`src/DurableClock.ts:61-108`) — restart-safe sleep. Uses an in-memory `Activity` for durations under 60 s; for longer sleeps, delegates to `engine.scheduleClock` + `DurableDeferred.await`, consuming zero memory between restarts.

- **`DurableQueue`** (`src/DurableQueue.ts:155-330`) — named persistent queue bridging `@effect/experimental/PersistedQueue` with `DurableDeferred`. A workflow calls `DurableQueue.process` to enqueue and suspend; `DurableQueue.worker` defines the consumer side.

- **`DurableRateLimiter`** (`src/DurableRateLimiter.ts:15-43`) — composes `@effect/experimental/RateLimiter` with `DurableClock.sleep` into a rate-limiting `Activity` correct across restarts.

- **`WorkflowProxy` / `WorkflowProxyServer`** (`src/WorkflowProxy.ts`, `src/WorkflowProxyServer.ts`) — derive RPC or HTTP groups from a workflow list. Each workflow gets three endpoints: execute, discard (fire-and-forget), and resume (`src/WorkflowProxy.ts:45-71`, `src/WorkflowProxyServer.ts:19-124`).

## Patterns used

- [Context.GenericTag / Tag class / Reference — tag variants](../02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants) — `WorkflowEngine` and `WorkflowInstance` are `Context.Tag` classes (`src/WorkflowEngine.ts:24`, `src/WorkflowEngine.ts:189`); `CaptureDefects` and `SuspendOnFailure` are `Context.Reference` with defaults (`src/Workflow.ts:693-711`).

- [Effect.gen + yield*](../02-patterns-catalog.md#effectgen--yield) — used throughout `layerMemory` (`src/WorkflowEngine.ts:470-537`) and `Activity.makeExecute` (`src/Activity.ts:239-258`) to sequence journal look-ups and result routing.

- [Effect.fn (named effect functions with auto-tracing)](../02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing) — `Effect.fnUntraced` is used for every `Workflow` method paired with `Effect.withSpan`, attaching spans named `"${workflow.name}.execute"` etc. (`src/Workflow.ts:301-348`).

- [Layer.succeed / effect / scoped — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `WorkflowEngine.layerMemory` is `Layer.scoped` (`src/WorkflowEngine.ts:468`); `Workflow.toLayer` is `Layer.scopedDiscard` (`src/Workflow.ts:349-353`).

- [Schema.Class and Schema.TaggedClass](../02-patterns-catalog.md#schemaclass-and-schemataggedclass) — `Workflow.Suspended` is a `Schema.TaggedClass` that round-trips through the journal (`src/Workflow.ts:483-490`); `DurableDeferred.TokenParsed` is a `Schema.Class` with `Schema.StringFromBase64Url` transforms (`src/DurableDeferred.ts:253-293`).

- [Dual data-first / data-last (dual(...)) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `Workflow.withCompensation`, `DurableDeferred.into`, `done`, `succeed`, `fail`, and `tokenFromExecutionId` are `dual(2, ...)` (`src/Workflow.ts:653-672`, `src/DurableDeferred.ts:136-513`).

- [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking) — `layerMemory` uses `FiberMap.make()` to deduplicate `DurableClock` fibers with `onlyIfMissing: true` (`src/WorkflowEngine.ts:537`, `src/WorkflowEngine.ts:624-634`).

- [Schedule.spaced / exponential / fixed / recurs](../02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs) — `Activity.retryOnInterrupt` uses exponential + spaced + recurs (`src/Activity.ts:128-132`); the default `suspendedRetrySchedule` polls suspended workflows with exponential back-off (`src/WorkflowEngine.ts:460-462`).

- [Exit — Effect outcome value](../02-patterns-catalog.md#exit--effect-outcome-value-success--failure-of-cause) — `Workflow.Complete` wraps `Exit.Exit<A,E>` as the persisted result; `Workflow.intoResult` converts any outcome including interrupts and defects (`src/Workflow.ts:511-552`).

## What's unique about this package's design

The defining novelty is the **suspend-and-replay model** grafted onto Effect's fiber scheduler. When an `Activity` or `DurableDeferred.await` finds no stored result, it calls `Workflow.suspend`, which self-interrupts the current fiber without failing the workflow (`src/Workflow.ts:677-682`). The engine reschedules a fresh fiber; on replay, every journaled result returns synchronously (`src/WorkflowEngine.ts:577-605`). Deterministic replay is enforced by the runtime, not user discipline — the workflow generator re-runs top-to-bottom but only incomplete activities side-effect.

The second distinctive design is **typed schema boundaries at every journal edge**. `WorkflowEngine.makeUnsafe` calls `Schema.encode` before writing and `Schema.decode` after reading for every activity result (`src/WorkflowEngine.ts:406-418`), so replay always produces correctly typed values and a new persistence back-end only needs to implement the untyped `Encoded` interface. The `@effect/cluster` package embeds the `WorkflowEngine` service via `ClusterWorkflowEngine.layer`, making the cluster the reference durable back-end.

The third distinctive design is the **`withCompensation` saga pattern**. `Workflow.withCompensation` registers a `Scope.addFinalizerExit` on the workflow's long-lived scope that fires only on failure, receiving both the activity's success value and the workflow-level `Cause` (`src/Workflow.ts:626-672`). No separate orchestration layer is required — the Saga pattern is expressed as a plain scope finalizer.

## Conventions observed

- **Module namespace re-exports**: `src/index.ts` uses `export * as ModuleName` for all nine modules. Callers write `import { Activity, Workflow, WorkflowEngine } from "@effect/workflow"`.
- **`internal/` isolation**: only `src/internal/crypto.ts` lives in `internal/` (`src/internal/crypto.ts:1-16`). `package.json` nulls the `./internal/*` export (`repos/effect/packages/workflow/package.json:33`).
- **Structural interface for service value**: `WorkflowEngine`'s value type is a plain interface, not a class (`src/WorkflowEngine.ts:24-183`), mirroring `@effect/sql`'s `SqlClient`. `makeUnsafe` isolates schema logic from back-end implementors and callers.
- **`Effect.fnUntraced` + `Effect.withSpan` on all multi-step methods**: every public multi-step operation pairs `Effect.fnUntraced` with an explicit named span, avoiding the overhead of captured stack traces.

## "If you were authoring something similar, copy this"

- **`wrapActivityResult` + `Workflow.suspend` as the replay gate** (`src/Workflow.ts:558-593`): any new durable primitive calls `wrapActivityResult(engine.check(...), isSuspendPredicate)`, then `Workflow.suspend` if the predicate fires. The entire mechanism lives in ~60 lines and requires no changes to workflow bodies.
- **`WorkflowInstance` for per-execution mutable state** (`src/WorkflowEngine.ts:189-246`): each execution carries its own `activityState.latch` in context, avoiding global `Ref` and cross-execution interference.
- **`makeUnsafe(Encoded)` splits schema-aware from schema-agnostic layers** (`src/WorkflowEngine.ts:317-458`): drivers implement untyped `Encoded`; `makeUnsafe` centralises schema encode/decode. A new back-end needs zero knowledge of Effect schemas.
- **`Context.Reference` with `defaultValue` for opt-in workflow flags** (`src/Workflow.ts:693-711`): `CaptureDefects` and `SuspendOnFailure` default sensibly and are opt-in via `workflow.annotate(...)`, with no constructor parameter pollution.

## Open questions

1. **Exactly-once vs at-least-once for `Activity`**: the in-memory engine keys activity state by `"${executionId}/${activityName}/${attempt}"` (`src/WorkflowEngine.ts:578-579`). Whether `ClusterWorkflowEngine` uses a two-phase commit or optimistic writes — and the failure window between execution and journal commit — is not visible in this package's source.
2. **`DurableClock` persistence in cluster**: `scheduleClock` must survive process restart (`src/WorkflowEngine.ts:173-181`), but the table/key structure is only visible in `@effect/cluster`'s migration files, not here.
3. **`inMemoryThreshold` and replay speed**: sleeps under 60 s re-execute `Effect.sleep(duration)` on replay (`src/DurableClock.ts:88-95`), making replay non-instantaneous for those sleeps — undocumented trade-off.
4. **`SuspendOnFailure` + `resume` error visibility**: it is undocumented whether the triggering error is re-thrown on `Workflow.resume`, swallowed, or stored in `Suspended.cause`, which affects error-handling patterns.

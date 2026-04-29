# Chapter 29 — Durable workflows with @effect/workflow

> **Package(s):** `@effect/workflow`
> **Patterns introduced:** [`Reloadable — hot-reload a service layer at runtime`](../../research/02-patterns-catalog.md#reloadable--hot-reload-a-service-layer-at-runtime)
> **Reads from:** Chapter 06 (typed errors), Chapter 09 (Layer), Chapter 14 (Schema part 1), Chapter 28 (type-safe RPC)
> **Reads into:** Chapter 30 (distributed actors with @effect/cluster — the reference durable back-end for workflow)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Multi-step business processes — place an order, charge a card, reserve inventory, trigger a shipment, send a confirmation email — are routine in backend systems. The problem is not writing the happy path; it is what happens when a step fails, the process crashes mid-execution, or a downstream service is temporarily unavailable.

Consider the naive version:

```ts
// Plain TypeScript — no durability
async function processOrder(orderId: string): Promise<void> {
  const charge = await chargePayment(orderId)   // step 1
  const reservation = await reserveInventory(orderId) // step 2 — crashes here
  await arrangeShipment(reservation)            // step 3 — never reached
  await sendConfirmation(orderId, charge)       // step 4 — never reached
}
```

A crash on step 2 leaves the payment taken but no shipment or email. Re-running from the top charges the customer twice. Fixing this requires idempotency keys for every external call, a checkpoint table, retry back-off, and a resume mechanism — compounded by timers (a 24-hour sleep is lost on restart) and external callbacks (a payment webhook that must park the workflow and resume it later).

`@effect/workflow` solves this by recording every unit of work (`Activity`) in a persistent journal. On restart the engine replays the journal: completed activities return their stored result; incomplete ones resume from scratch. Timers and external signals are journaled too (`DurableClock`, `DurableDeferred`).

> **`@experimental` notice.** `@effect/workflow` carries the `@experimental` tag. The API may change between minor versions of the `effect` monorepo. Treat the signatures shown here as accurate for `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`) and review the changelog before upgrading.

---

## The minimal example

A single-activity workflow that sends a welcome email, executed via the in-memory engine:

```ts
import { Activity, Workflow, WorkflowEngine } from "@effect/workflow"
import { Effect, Layer, Schema } from "effect"

// 1. Define the workflow: name, typed payload, idempotency key.
const WelcomeWorkflow = Workflow.make({
  name: "WelcomeWorkflow",
  payload: { userId: Schema.String, email: Schema.String },
  idempotencyKey: ({ userId }) => userId,
  success: Schema.Struct({ messageId: Schema.String })
})

// 2. Define one Activity. Its result is checkpointed after the first run.
const sendWelcomeEmail = Activity.make({
  name: "sendWelcomeEmail",
  success: Schema.Struct({ messageId: Schema.String }),
  execute: Effect.gen(function*() {
    // real call goes here; simulated for the example
    yield* Effect.log("Sending welcome email…")
    return { messageId: "msg-001" }
  })
})

// 3. Register the workflow handler.
const WelcomeWorkflowLive = WelcomeWorkflow.toLayer(
  (payload) => Effect.gen(function*() {
    const result = yield* sendWelcomeEmail
    return result
  })
)

// 4. Execute — the engine runs the workflow and returns the typed result.
const program = Effect.gen(function*() {
  const result = yield* WelcomeWorkflow.execute({ userId: "u1", email: "hi@example.com" })
  yield* Effect.log(`Done: ${result.messageId}`)
})

Effect.runPromise(
  program.pipe(
    Effect.provide(WelcomeWorkflowLive),
    Effect.provide(WorkflowEngine.layerMemory)
  )
)
```

---

## Tour

### `Workflow.make` — defining a named, schema-typed execution

`Workflow.make` is the entry point for every durable execution unit.

```ts
// repos/effect/packages/workflow/src/Workflow.ts:259-280
export const make = <
  const Name extends string,
  Payload extends Schema.Struct.Fields | AnyStructSchema,
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never
>(options: {
  readonly name: Name
  readonly payload: Payload
  readonly idempotencyKey: (payload: ...) => string
  readonly success?: Success
  readonly error?: Error
  readonly suspendedRetrySchedule?: Schedule.Schedule<any, unknown>
  readonly annotations?: Context.Context<never>
}): Workflow<Name, ..., Success, Error>
```

The type parameters map to a Schema shape (Chapter 14): `Payload` defines the input record; `Success` and `Error` are the typed outcome schemas — `Schema.Void` and `Schema.Never` by default. The engine encodes every payload and result via these schemas before writing to the journal, and decodes on replay.

`idempotencyKey` derives a stable string from the payload. The engine hashes `"${name}-${idempotencyKey(payload)}"` via SHA-256 to produce a deterministic `executionId` (`repos/effect/packages/workflow/src/Workflow.ts:281`). Two calls with the same key share one execution — the second call awaits the in-flight run or returns the stored result.

`Workflow.make` returns an object with several methods:
- `.execute(payload)` — start or resume an execution and await completion.
- `.poll(executionId)` — non-blocking check; returns `Complete | Suspended | undefined`.
- `.interrupt(executionId)` — signal the running fiber to stop.
- `.resume(executionId)` — un-park a suspended execution.
- `.toLayer(handler)` — produces a `Layer` that registers the workflow handler with the engine.

The `Result` union is the serializable journal form: `Workflow.Complete` wraps an `Exit.Exit<A, E>`, and `Workflow.Suspended` is a `Schema.TaggedClass` that round-trips through the journal (`repos/effect/packages/workflow/src/Workflow.ts:407-490`).

### `Activity.make` — the idempotent unit of work

An `Activity` is the minimal durable building block. It wraps any `Effect` and gives it a name. The engine checks the journal before running: if a stored result exists for `"${executionId}/${activityName}/${attempt}"`, that result is returned immediately without re-executing the effect.

```ts
// repos/effect/packages/workflow/src/Activity.ts:81-95
export const make = <R, Success, Error>(options: {
  readonly name: string
  readonly success?: Success
  readonly error?: Error
  readonly execute: Effect.Effect<Success["Type"], Error["Type"], R>
  readonly interruptRetryPolicy?: Schedule.Schedule<...>
}): Activity<Success, Error, ...>
```

`Activity` is an `Effect` itself — it implements `Effectable.CommitPrototype` — so you use it directly with `yield*` inside a workflow handler. The journal key includes an attempt counter: `Activity.retry` increments the `CurrentAttempt` reference between retries, and `Activity.make`'s internal `makeExecute` uses that counter to allocate a distinct journal slot per attempt (`repos/effect/packages/workflow/src/Activity.ts:148-168`).

`Activity.idempotencyKey` derives a stable SHA-256 key from `executionId` and a name — pass it to external APIs (e.g. Stripe charges) that require exactly-once semantics (`repos/effect/packages/workflow/src/Activity.ts:183-199`).

`Activity.raceAll` accepts multiple activities and persists whichever finishes first (`repos/effect/packages/workflow/src/Activity.ts:205-226`). The winning result is stored as a `DurableDeferred` so the outcome is stable across restarts.

### `DurableClock.sleep` — sleeps that survive restarts

A plain `Effect.sleep("24 hours")` inside a long-running workflow is lost when the process restarts. `DurableClock.sleep` replaces it with a journaled sleep.

```ts
// repos/effect/packages/workflow/src/DurableClock.ts:57-108
export const sleep: (options: {
  readonly name: string
  readonly duration: Duration.DurationInput
  readonly inMemoryThreshold?: Duration.DurationInput
}) => Effect.Effect<void, never, WorkflowEngine | WorkflowInstance>
```

For durations at or below the `inMemoryThreshold` (default 60 seconds), `DurableClock.sleep` wraps a plain `Effect.sleep` in a named `Activity` — the engine checkpoints the "sleep started" event. For longer durations it delegates to `engine.scheduleClock` and then parks via `DurableDeferred.await`. This means a 24-hour sleep consumes zero memory between the scheduling call and the wake-up: the process can be restarted freely, and the engine (typically `@effect/cluster` in production) resumes the workflow after the interval elapses.

> Note: the `inMemoryThreshold` trade-off is documented in the per-package research note `research/packages/workflow.md`. Short sleeps on replay re-execute `Effect.sleep(duration)`, so replay is not instantaneous for those sleeps.

### `DurableDeferred` — promises that survive restarts

`DurableDeferred` is the workflow-level equivalent of `Deferred` (which Chapter 36 covers in detail), but backed by the journal rather than an in-memory fiber latch.

```ts
// repos/effect/packages/workflow/src/DurableDeferred.ts:58-85
export const make = <
  Success extends Schema.Schema.Any = typeof Schema.Void,
  Error extends Schema.Schema.All = typeof Schema.Never
>(name: string, options?: {
  readonly success?: Success
  readonly error?: Error
}): DurableDeferred<Success, Error>
```

`DurableDeferred.await(deferred)` checks the journal for a stored result. If none exists, it calls `Workflow.suspend`, which self-interrupts the fiber without failing the workflow (`repos/effect/packages/workflow/src/Workflow.ts:674-682`). The engine then reschedules a fresh fiber; when an external caller eventually supplies the result via `DurableDeferred.done(token, exit)`, the engine resumes the workflow from the park point.

`DurableDeferred.token` produces a Base64-URL opaque string encoding `(workflowName, executionId, deferredName)`. You hand this token to an external system (a webhook, a human approver, a payment gateway); when the event arrives, the caller supplies the token back to `DurableDeferred.done`. No database join or lookup table required — the token is self-describing (`repos/effect/packages/workflow/src/DurableDeferred.ts:253-310`).

### Engine layers — wiring the back-end

The engine is a `Context.Tag` service (`WorkflowEngine`) defined at `repos/effect/packages/workflow/src/WorkflowEngine.ts:20-183`. Any back-end must satisfy its interface: `register`, `execute`, `poll`, `interrupt`, `resume`, `activityExecute`, `deferredResult`, `deferredDone`, and `scheduleClock`.

`WorkflowEngine.makeUnsafe(options: Encoded)` adapts a lower-level untyped interface into the typed service. It centralises all `Schema.encode` / `Schema.decode` calls, so a new back-end only implements plain-object reads and writes (`repos/effect/packages/workflow/src/WorkflowEngine.ts:313-458`).

For tests, `WorkflowEngine.layerMemory` provides a complete in-memory implementation:

```ts
// repos/effect/packages/workflow/src/WorkflowEngine.ts:464-468
export const layerMemory: Layer.Layer<WorkflowEngine> = Layer.scoped(
  WorkflowEngine,
  Effect.gen(function*() { /* in-memory Maps + FiberMap for clocks */ })
)
```

For production, use `ClusterWorkflowEngine.layer` from `@effect/cluster` (Chapter 30). The `@effect/workflow` package has no dependency on `@effect/cluster` — the separation lets you swap engines without changing workflow code.

### Compensation — the Saga pattern as a scope finalizer

`Workflow.withCompensation` registers a cleanup effect that fires only when the workflow fails, expressed as a `Scope.addFinalizerExit`. Registered compensations run in reverse acquisition order on failure — payment refunded, inventory unreserved — without a separate orchestration layer:

```ts
// repos/effect/packages/workflow/src/Workflow.ts:642-672
export const withCompensation: {
  <A, R2>(
    compensation: (value: A, cause: Cause.Cause<unknown>) => Effect.Effect<void, never, R2>
  ): <E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R | R2 | WorkflowInstance | Scope.Scope>
  // ...
}
```

Two `Context.Reference` annotations adjust failure semantics: `Workflow.CaptureDefects` (default `true`) captures defects into the result; `Workflow.SuspendOnFailure` (default `false`) parks the workflow as `Suspended` on error so an operator can inspect and resume. Both use `defaultValue` and require no constructor change (`repos/effect/packages/workflow/src/Workflow.ts:693-711`).

### Reloadable — hot-reloading the engine layer at runtime

`Reloadable` wraps any `Layer` in a `ScopedRef`, letting the underlying service be re-initialized at runtime while consumers keep the same outer reference. Two constructors:

```ts
// repos/effect/packages/effect/src/Reloadable.ts:60-68
export const auto: <I, S, E, In, R>(
  tag: Context.Tag<I, S>,
  options: {
    readonly layer: Layer.Layer<I, E, In>
    readonly schedule: Schedule.Schedule<unknown, unknown, R>
  }
) => Layer.Layer<Reloadable<I>, E, R | In>

// repos/effect/packages/effect/src/Reloadable.ts:98-104
export const manual: <I, S, In, E>(
  tag: Context.Tag<I, S>,
  options: { readonly layer: Layer.Layer<I, E, In> }
) => Layer.Layer<Reloadable<I>, E, In>
```

`auto` schedules periodic reloads on a `Schedule`; `manual` exposes `Reloadable.reload(tag)` for on-demand swaps (SIGHUP, admin endpoint). `Reloadable.get(tag)` retrieves the current live instance.

```ts
import { Reloadable, Schedule } from "effect"

const StripeClientReloadable = Reloadable.auto(StripeClient, {
  layer: StripeClient.live,
  schedule: Schedule.fixed("1 hour")
})

const AppLayer = Layer.mergeAll(
  WorkflowEngine.layerMemory,
  CheckoutWorkflowLive,
  StripeClientReloadable
)
```

`Reloadable` replaces the layer value, not the fiber tree. In-flight workflow fibers finish on the old `StripeClient`; newly scheduled activity fibers pick up the next instance.

The patterns catalog entry is at [`Reloadable — hot-reload a service layer at runtime`](../../research/02-patterns-catalog.md#reloadable--hot-reload-a-service-layer-at-runtime).

---

## A production example

A checkout workflow with four activities, a durable sleep between retry attempts, and compensation logic on the payment step:

```ts
import { Activity, DurableClock, Workflow, WorkflowEngine } from "@effect/workflow"
import { Data, Effect, Layer, Schema } from "effect"

// --- Errors (Chapter 06 pattern) ---
class PaymentFailed extends Data.TaggedError("PaymentFailed")<{
  readonly reason: string
}> {}
class InventoryUnavailable extends Data.TaggedError("InventoryUnavailable")<{
  readonly itemId: string
}> {}

// --- Workflow definition ---
const CheckoutWorkflow = Workflow.make({
  name: "CheckoutWorkflow",
  payload: {
    orderId: Schema.String,
    itemId: Schema.String,
    amountCents: Schema.Number
  },
  idempotencyKey: ({ orderId }) => orderId,
  success: Schema.Struct({ shipmentId: Schema.String }),
  error: Schema.Union(
    Schema.typeSchema(PaymentFailed),
    Schema.typeSchema(InventoryUnavailable)
  )
})

// --- Activities ---
const chargePayment = (orderId: string, amountCents: number) =>
  Activity.make({
    name: "chargePayment",
    success: Schema.Struct({ chargeId: Schema.String }),
    error: Schema.typeSchema(PaymentFailed),
    execute: Effect.gen(function*() {
      // Retrieve stable idempotency key for the external call.
      const key = yield* Activity.idempotencyKey("chargePayment")
      yield* Effect.log(`Charging ${amountCents} cents (idempotency: ${key})`)
      // Simulate: call Stripe with key to avoid double-charge.
      return { chargeId: `ch_${orderId}` }
    })
  })

const reserveInventory = (itemId: string) =>
  Activity.make({
    name: "reserveInventory",
    success: Schema.Struct({ reservationId: Schema.String }),
    error: Schema.typeSchema(InventoryUnavailable),
    execute: Effect.gen(function*() {
      yield* Effect.log(`Reserving item ${itemId}`)
      return { reservationId: `res_${itemId}` }
    })
  })

const arrangeShipment = (reservationId: string) =>
  Activity.make({
    name: "arrangeShipment",
    success: Schema.Struct({ shipmentId: Schema.String }),
    execute: Effect.gen(function*() {
      yield* Effect.log(`Arranging shipment for reservation ${reservationId}`)
      return { shipmentId: `ship_${reservationId}` }
    })
  })

const sendConfirmation = (orderId: string, shipmentId: string) =>
  Activity.make({
    name: "sendConfirmation",
    execute: Effect.log(`Order ${orderId} confirmed, shipment ${shipmentId}`)
  })

// --- Workflow handler ---
const CheckoutWorkflowLive = CheckoutWorkflow.toLayer(
  ({ orderId, itemId, amountCents }) =>
    Effect.gen(function*() {
      // Step 1 — charge; register a refund compensation if the workflow
      // fails after this point.
      const { chargeId } = yield* chargePayment(orderId, amountCents).pipe(
        Workflow.withCompensation(({ chargeId }, _cause) =>
          Effect.log(`Refunding charge ${chargeId}`)
        )
      )

      // Step 2 — wait 2 s between the charge and the inventory call (demo
      // of DurableClock; use a real back-off in production).
      yield* DurableClock.sleep({ name: "post-charge-pause", duration: "2 seconds" })

      // Step 3 — reserve inventory.
      const { reservationId } = yield* reserveInventory(itemId)

      // Step 4 — arrange shipment.
      const { shipmentId } = yield* arrangeShipment(reservationId)

      // Step 5 — send confirmation email (fire-and-forget activity).
      yield* sendConfirmation(orderId, shipmentId)

      return { shipmentId }
    })
)

// --- Layer composition ---
const AppLayer = Layer.mergeAll(
  WorkflowEngine.layerMemory,
  CheckoutWorkflowLive
)

// --- Entry point ---
const program = Effect.gen(function*() {
  const result = yield* CheckoutWorkflow.execute({
    orderId: "order-99",
    itemId: "widget-1",
    amountCents: 4999
  })
  yield* Effect.log(`Shipment: ${result.shipmentId}`)
})

Effect.runPromise(program.pipe(Effect.provide(AppLayer)))
```

The workflow body is a plain `Effect.gen` block. Every `yield* activity` looks like a normal effect call but is in fact checkpointed. If the process crashes between step 2 and step 3, restart replays steps 1 and 2 from the journal (no re-charge, no real sleep) and continues from step 3.

---

## Variations

**1. In-memory engine for tests.** Swap `WorkflowEngine.layerMemory` in tests — no database, no cluster:

```ts
import { WorkflowEngine } from "@effect/workflow"
import { Effect } from "effect"
import { it } from "@effect/vitest"

it.effect("checkout succeeds", () =>
  Effect.gen(function*() {
    const result = yield* CheckoutWorkflow.execute({
      orderId: "test-1", itemId: "sku-A", amountCents: 100
    })
    expect(result.shipmentId).toMatch(/^ship_/)
  }).pipe(
    Effect.provide(CheckoutWorkflowLive),
    Effect.provide(WorkflowEngine.layerMemory)
  )
)
```

**2. Poll instead of await.** When you want fire-and-forget semantics, `discard: true` returns the `executionId` immediately; you poll for completion separately:

```ts
const executionId = yield* CheckoutWorkflow.execute(payload, { discard: true })
// Later:
const result = yield* CheckoutWorkflow.poll(executionId)
// result is Workflow.Complete | Workflow.Suspended | undefined
```

**3. External signal via `DurableDeferred`.** Pause the workflow until a webhook arrives:

```ts
import { DurableDeferred } from "@effect/workflow"
import { Schema } from "effect"

const approvalDeferred = DurableDeferred.make("humanApproval", {
  success: Schema.Struct({ approved: Schema.Boolean })
})

// Inside the workflow handler:
const token = yield* DurableDeferred.token(approvalDeferred)
yield* Effect.log(`Send this token to the approver: ${token}`)
const { approved } = yield* DurableDeferred.await(approvalDeferred)
```

**4. Workflow-level annotations and sub-workflows.** `SuspendOnFailure` parks on error instead of failing, enabling operator inspection and manual resume. Sub-workflow composition works by calling `yield* AnotherWorkflow.execute(...)` inside a handler — the engine tracks the parent–child relationship:

```ts
const SafeCheckout = CheckoutWorkflow.annotate(Workflow.SuspendOnFailure, true)
```

**5. `WorkflowProxy` — expose workflows over RPC.** `WorkflowProxy.toRpcGroup` derives an `RpcGroup` (Chapter 28 pattern) from a list of workflows. Each workflow gets `execute`, `discard`, and `resume` endpoints automatically (`repos/effect/packages/workflow/src/WorkflowProxy.ts:45-71`):

```ts
import { WorkflowProxy, WorkflowProxyServer } from "@effect/workflow"
import { RpcServer } from "@effect/rpc"
import { Layer } from "effect"

const myWorkflows = [CheckoutWorkflow] as const
class CheckoutRpcs extends WorkflowProxy.toRpcGroup(myWorkflows) {}

const ApiLayer = RpcServer.layer(CheckoutRpcs).pipe(
  Layer.provide(WorkflowProxyServer.layerRpcHandlers(myWorkflows))
)
```

---

## Anti-patterns

**1. Side effects directly in the workflow body (outside an Activity).**

Wrong — the payment call runs on every replay:

```ts
// Wrong: side-effectful call outside an Activity
const CheckoutWorkflowBad = CheckoutWorkflow.toLayer(
  ({ orderId, amountCents }) =>
    Effect.gen(function*() {
      // This runs every time the workflow fiber is re-spawned for replay.
      const chargeId = yield* Effect.promise(() => stripe.charges.create({ amount: amountCents }))
      return { shipmentId: `ship_${chargeId}` }
    })
)
```

Correct — wrap every side effect in an `Activity`:

```ts
// Correct: the engine checkpoints the activity result after the first run.
const CheckoutWorkflowGood = CheckoutWorkflow.toLayer(
  ({ orderId, amountCents }) =>
    Effect.gen(function*() {
      const { chargeId } = yield* chargePayment(orderId, amountCents)
      return { shipmentId: `ship_${chargeId}` }
    })
)
```

**2. Using `Effect.sleep` directly instead of `DurableClock.sleep`.**

Wrong — the sleep is lost on restart:

```ts
// Wrong: in-memory sleep; evaporates on process restart.
yield* Effect.sleep("24 hours")
```

Correct — use the journaled clock:

```ts
// Correct: the engine schedules the wake-up; the workflow survives restart.
yield* DurableClock.sleep({ name: "reminder-delay", duration: "24 hours" })
```

**3. Throwing untyped errors instead of using the `error` schema.**

Activity errors must be schema-encodable. Throwing a plain `Error` object bypasses the typed error channel and forces the engine to treat the failure as a defect (captured by `CaptureDefects`), losing the structured type.

```ts
// Wrong: untyped throw bypasses the error schema.
Activity.make({
  name: "reserveInventory",
  execute: Effect.tryPromise(() => {
    throw new Error("out of stock") // plain Error, not schema-typed
  })
})

// Correct: use Data.TaggedError (Chapter 06) and declare it in `error`.
Activity.make({
  name: "reserveInventory",
  error: Schema.typeSchema(InventoryUnavailable),
  execute: Effect.fail(new InventoryUnavailable({ itemId: "widget-1" }))
})
```

**4. Assuming an activity runs exactly once per workflow execution.**

With at-least-once semantics, an activity may execute more than once if the process crashes between the activity completing and the result being written to the journal. Always pass `Activity.idempotencyKey(name)` to external APIs that require exactly-once semantics:

```ts
// Correct: stable key prevents duplicate charges even if the activity retries.
const key = yield* Activity.idempotencyKey("chargePayment")
yield* Effect.promise(() => stripe.charges.create({ amount: cents, idempotency_key: key }))
```

---

## See also

- [Chapter 06 — Typed errors](../part-1-foundations/06-typed-errors.md) — `Data.TaggedError` is the correct way to type `Activity` error schemas; untyped throws bypass the journal's error channel.
- [Chapter 09 — Layer](../part-1-foundations/09-layer.md) — `Workflow.toLayer`, `WorkflowEngine.layerMemory`, and `Reloadable.auto` are all `Layer` values; the composition patterns from Chapter 09 apply directly.
- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md) — every journal edge uses `Schema.encode` / `Schema.decode`; understanding `Schema.Struct`, `Schema.Class`, and `Schema.TaggedClass` is a prerequisite for defining correct payload and result schemas.
- [Chapter 28 — Type-safe RPC with @effect/rpc](28-rpc.md) — `WorkflowProxy.toRpcGroup` derives an `RpcGroup` from a list of workflows; the RPC group / handler pattern from Chapter 28 carries over directly.
- [Chapter 30 — Distributed actors with @effect/cluster](../part-2-tour/30-cluster.md) — `ClusterWorkflowEngine.layer` from `@effect/cluster` is the reference durable back-end; cluster provides the persistence, scheduling, and distribution that `WorkflowEngine.layerMemory` simulates in-process.
- [`Reloadable — hot-reload a service layer at runtime`](../../research/02-patterns-catalog.md#reloadable--hot-reload-a-service-layer-at-runtime) — the introduced pattern for this chapter; wraps any `Layer` in a `ScopedRef` for zero-downtime service replacement.
- [Per-package research note](../../research/packages/workflow.md) — covers open questions around exactly-once semantics, `DurableClock` persistence in cluster, and the `wrapActivityResult` + `Workflow.suspend` replay gate implementation.

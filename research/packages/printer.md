# @effect/printer

> Source: `repos/effect/packages/printer/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: tooling
> Effect deps: `effect`, `@effect/typeclass` (both peers; see `repos/effect/packages/printer/package.json:49–55`)

## What it does

`@effect/printer` is a TypeScript port of the Wadler/Lindig pretty-printing algebra. It solves the problem of rendering structured data to human-readable, page-width-respecting text without hard-coding layout decisions at construction time. The primary consumer is `@effect/cli`, which uses it to render help text (via `HelpDoc`), and `@effect/printer-ansi` extends it with ANSI terminal color annotations. Without this package, every CLI or code-generation tool in the Effect ecosystem would need to roll its own line-wrapping and indentation logic; with it they share a single battle-tested layout engine.

## Public API surface

Grouped by pipeline stage, not alphabetically. Each module is a top-level re-export from `repos/effect/packages/printer/src/index.ts:19–49`.

**Stage 1 — Document construction (`Doc`)**

- `Doc` — the central type `Doc<A>` is a discriminated union of 13 constructors: `Fail`, `Empty`, `Char`, `Text`, `Line`, `FlatAlt`, `Cat`, `Nest`, `Union`, `Column`, `WithPageWidth`, `Nesting`, `Annotated` (`repos/effect/packages/printer/src/Doc.ts:56–69`). Key combinators: `text`, `char`, `string`, `line`, `hardLine`, `softLine`, `group`, `flatAlt`, `nest`, `align`, `hang`, `indent`, `cat`, `hcat`, `vcat`, `hsep`, `vsep`, `fillSep`, `fillCat`, `seps`, `annotate`, `column`, `nesting`, `pageWidth`, `width`, `render`. Also exposes `Doc.RenderConfig` (`{ style: "compact" | "pretty" | "smart" }`) so callers can drive layout without importing `Layout` directly (`repos/effect/packages/printer/src/Doc.ts:94–119`).

**Stage 1b — Flattening oracle (`Flatten`)**

- `Flatten` — a three-way result type `Flattened<A> | AlreadyFlat<A> | NeverFlat<A>` used internally by `group` to decide whether creating a `Union` alternative is worthwhile; prevents the exponential blow-up that would occur if every node generated a `Union` blindly (`repos/effect/packages/printer/src/Flatten.ts:27–91`).

**Stage 1c — Pre-layout optimization (`Optimize`)**

- `Optimize` — fuses adjacent `Char`/`Text` concatenations in the `Doc` tree before layout runs, reducing `DocStream` node count. Controlled by `FusionDepth`: `Shallow` (text nodes only) vs `Deep` (recurses into `Union` alternatives and location-sensitive nodes — use only when profiling proves it helps) (`repos/effect/packages/printer/src/Optimize.ts:39–132`).

**Stage 2 — Layout to stream (`Layout`)**

- `Layout` — converts `Doc<A>` → `DocStream<A>` via four algorithms: `compact` (no indentation, strips annotations), `pretty` (one-lookahead Wadler/Lindig), `smart` (multi-line lookahead — stops at the first line whose indentation equals or undershoots the current start), and `unbounded` (no page width). All non-trivial algorithms delegate to `wadlerLeijen` with a pluggable `FittingPredicate<A>` (`repos/effect/packages/printer/src/Layout.ts:81–267`). `Layout.Options` carries a `PageWidth` (`repos/effect/packages/printer/src/Layout.ts:33–35`).

**Stage 2 inputs — `PageWidth`**

- `PageWidth` — discriminated union `AvailablePerLine { lineWidth, ribbonFraction } | Unbounded`. The `ribbonFraction` field (0–1) independently limits the printable fraction of each line beyond the raw character count (`repos/effect/packages/printer/src/PageWidth.ts:32–77`). Default is `AvailablePerLine(80, 1)` (`repos/effect/packages/printer/src/PageWidth.ts:130`).

**Stage 3 — Intermediate representation (`DocStream`)**

- `DocStream` — linked-list IR with 7 constructors: `FailedStream`, `EmptyStream`, `CharStream`, `TextStream`, `LineStream`, `PushAnnotationStream`, `PopAnnotationStream` (`repos/effect/packages/printer/src/DocStream.ts:42–159`). Annotations are tracked as a push/pop stack rather than tree nesting, making forward-only rendering trivial. Implements `Covariant` and `Invariant` from `@effect/typeclass` (`repos/effect/packages/printer/src/DocStream.ts:382–388`).

**Stage 3 alt — Tree IR (`DocTree`)**

- `DocTree` — alternative IR shaped as a tree: `EmptyTree | CharTree | TextTree | LineTree | AnnotationTree | ConcatTree`. Converted from `DocStream` via `DocTree.treeForm`. Used when the render target needs nested markup (HTML, rich terminal widgets) rather than a flat character stream. Provides `renderSimplyDecorated` as a fold-based rendering primitive (`repos/effect/packages/printer/src/DocTree.ts:44–356`).

**Internal — Layout work-list (`LayoutPipeline`)**

- `LayoutPipeline` — the private work-list thread through the recursive `wadlerLeijen` loop: `Nil | Cons<A> | UndoAnnotation<A>`. Not exported; exists solely to enable the layout algorithm's trampolined recursion via `Effect.gen` / `Effect.suspend` (`repos/effect/packages/printer/src/internal/layoutPipeline.ts:1–51`).

## Patterns used

- [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — nearly every `Doc` combinator is a `dual`-wrapped function; `Doc<A>` itself extends `Pipeable`, enabling `.pipe(Doc.group).pipe(Doc.nest(2))` chains (`repos/effect/packages/printer/src/Doc.ts:79–83`).
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all runtime logic lives in `src/internal/`; the public modules (`Doc.ts`, `Layout.ts`, etc.) contain only types, JSDoc, and delegation to `import * as internal from "./internal/doc.js"` (`repos/effect/packages/printer/src/Doc.ts:29`).
- [JSDoc `@since`, `@category`, `@example` tags](../02-patterns-catalog.md#jsdoc-since-category-example-tags) — every public export carries `@since 1.0.0` and a `@category` tag; most carry a runnable `@example` block with `assert.strictEqual` (`repos/effect/packages/printer/src/Doc.ts:432–460`).
- [`Data.TaggedEnum` / discriminated union constructors](../02-patterns-catalog.md#datataggedenum--discriminated-union-constructors) — `Doc<A>`, `DocStream<A>`, `DocTree<A>`, `Flatten<A>`, and `PageWidth` are all hand-written discriminated unions keyed on `_tag`; `match` helpers expose exhaustive pattern matching (`repos/effect/packages/printer/src/DocStream.ts:343–367`).
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — the layout algorithms (`wadlerLeijenSafe`, `compactSafe`) are written as `Effect.gen` trampolines using `Effect.suspend` to avoid stack overflow on deeply nested documents, then driven synchronously with `Effect.runSync` at the boundary (`repos/effect/packages/printer/src/internal/layout.ts:41–135`, `repos/effect/packages/printer/src/internal/render.ts:33–70`).

## What's unique about this package's design

The central insight is the **two-stage pipeline with a pluggable fitting predicate**. `Doc<A>` is a pure algebra — a tree that describes layout possibilities, not a rendered string — and the `Union` node (`repos/effect/packages/printer/src/Doc.ts:246–250`) stores both a "multi-line" and a "single-line" alternative. The `Layout.wadlerLeijen` function (`repos/effect/packages/printer/src/Layout.ts:81–84`) selects between them at layout time by calling a caller-supplied `FittingPredicate<A>`, which explains why `pretty` and `smart` can share the same recursive core (`repos/effect/packages/printer/src/internal/layout.ts:25–154`) while behaving differently: `pretty` checks only the first line, while `smart` looks ahead until it finds a line at or below the start indentation.

The annotation model is equally clean: `Doc.annotate` wraps a sub-document with arbitrary data of type `A` (color, tooltip, visibility flag); during layout that data is encoded as balanced `PushAnnotationStream`/`PopAnnotationStream` events in the `DocStream` (`repos/effect/packages/printer/src/DocStream.ts:144–159`). The rendering layer either consumes annotations (plain-text `renderStream` strips them silently, `repos/effect/packages/printer/src/internal/render.ts:65–68`) or converts them to a `DocTree` for renderers that need nested markup (`repos/effect/packages/printer/src/DocTree.ts:29–40`). This means `@effect/printer-ansi` needs only to supply a different annotation type (`AnsiDoc`) and a different rendering fold — the entire layout engine is shared unchanged.

The `Flatten` type (`repos/effect/packages/printer/src/Flatten.ts:27–32`) is a subtle optimization: before creating a `Union`, `group` asks "is flattening this document meaningful?" and returns `AlreadyFlat` or `NeverFlat` instead of `Flattened` when appropriate. This avoids creating a spurious `Union` node that the layout algorithm would have to traverse, which would otherwise cause exponential behavior on deeply grouped documents.

## Conventions observed

- No `Effect` type in the public API surface: the package has zero runtime `Effect` dependencies visible to callers. The only use of `Effect` is inside `src/internal/layout.ts` and `src/internal/render.ts` as a trampolining device to avoid stack overflows. The trampolines are driven with `Effect.runSync` immediately, so the public API remains fully synchronous (`repos/effect/packages/printer/src/internal/render.ts:33`).
- `Doc<A>` extends `Pipeable` but the other types (`DocStream<A>`, `DocTree<A>`) do not. `DocStream` and `DocTree` are consumed rather than composed, so the chaining style is less needed and the extra machinery is omitted (`repos/effect/packages/printer/src/Doc.ts:79`).
- Unique symbol `TypeId` pattern is used on all four main types (`DocTypeId`, `DocStreamTypeId`, `DocTreeTypeId`, `FlattenTypeId`, `PageWidthTypeId`) with the variance encoded directly in the interface — `_A: () => A` for `Doc` (covariant in `A`) vs `_A: (_: never) => A` for `DocStream` and `DocTree` (`repos/effect/packages/printer/src/Doc.ts:41–47`, `repos/effect/packages/printer/src/DocStream.ts:21–28`).
- `@effect/typeclass` typeclass instances (`Covariant`, `Invariant`, `Monoid`, `Semigroup`) are provided as named module-level exports rather than merged into the type namespace, following the package-wide convention (`repos/effect/packages/printer/src/DocStream.ts:382–388`, `repos/effect/packages/printer/src/DocTree.ts:361–384`).
- `Doc.render` is the high-level convenience entry point that accepts a `RenderConfig` object (`{ style: "compact" | "pretty" | "smart", options?: ... }`) rather than forcing callers to import `Layout` and `PageWidth` directly; the lower-level `Layout.*` functions remain available for callers who need the `DocStream` intermediate (`repos/effect/packages/printer/src/Doc.ts:94–119`, `repos/effect/packages/printer/src/internal/render.ts:13–30`).

## "If you were authoring something similar, copy this"

- **Pluggable fitting predicate as a first-class type**: exporting `Layout.FittingPredicate<A>` and `Layout.wadlerLeijen` as public API lets downstream packages or tests supply custom fitting logic without forking the layout engine — an extension point that costs nothing to maintain (`repos/effect/packages/printer/src/Layout.ts:47–55`, `repos/effect/packages/printer/src/Layout.ts:81–84`).
- **`Effect.gen` trampoline for recursive algorithms**: using `Effect.suspend(() => recursiveCall(...))` inside an `Effect.gen` block, then running the whole thing with `Effect.runSync`, is a clean pattern for making deeply recursive pure algorithms stack-safe without rewriting them in continuation-passing style (`repos/effect/packages/printer/src/internal/layout.ts:41–53`).
- **Flatten oracle to avoid exponential branching**: encoding the "is this document already flat?" question as a three-way type (`Flattened | AlreadyFlat | NeverFlat`) rather than a boolean prevents unnecessary `Union` nodes in the `Doc` tree, which would force the layout algorithm to explore dead branches (`repos/effect/packages/printer/src/Flatten.ts:27–32`).
- **Annotation as push/pop event pairs in the IR**: tracking annotations as balanced `PushAnnotationStream`/`PopAnnotationStream` pairs in the flat `DocStream` means renderers need only maintain a stack of active annotations — no tree traversal required (`repos/effect/packages/printer/src/DocStream.ts:144–159`).
- **Dual IR for different render targets**: shipping both a flat `DocStream` (for sequential renderers like plain text and ANSI) and a nested `DocTree` (for markup renderers like HTML) from the same `DocStream` input via `DocTree.treeForm` avoids duplicating the layout algorithm (`repos/effect/packages/printer/src/DocTree.ts:350–356`).
- **`ribbonFraction` as an independent line-width constraint**: separating "total characters per line" from "printable fraction of line" via `PageWidth.AvailablePerLine` lets callers enforce a secondary indentation limit (e.g., never use more than 80% of the line for text, leaving room for margin annotations) without changing the algorithm (`repos/effect/packages/printer/src/PageWidth.ts:54–67`).

## Open questions

1. **`DocTree` conversion correctness for nested groups**: `DocTree.treeForm` converts a `DocStream` to a `DocTree` by consuming `PushAnnotationStream`/`PopAnnotationStream` pairs. Does it correctly handle the case where a `FailedStream` appears mid-tree during a fuzz-style stress test, or does it assume a well-formed stream?
2. **Stack safety of `DocTree.treeForm`**: unlike the `Layout` algorithms, `DocTree.treeForm` in `src/internal/docTree.ts` does not appear to use an `Effect.gen` trampoline. Confirming whether it is iterative or recursive, and what the practical depth limit is for deeply nested annotated documents, is worth checking before using `DocTree` with large ASTs.
3. **`smart` vs `pretty` performance trade-off at scale**: the `Layout.smart` algorithm's lookahead stops at the first line with equal-or-lower indentation. For documents like deeply nested function calls with many alternatives, this lookahead could be significantly more expensive than `pretty`. No benchmarks are included in the test suite; it would be worth characterizing the worst case.
4. **`Optimize.Deep` interaction with `Column`/`Nesting` nodes**: the `Deep` fusion depth recurses into location-sensitive values (`Column`, `Nesting`) which cannot be fused until layout time. The JSDoc warns this "often [has] hard to predict" performance cost (`repos/effect/packages/printer/src/Optimize.ts:53–64`). An example showing when `Deep` actually helps would clarify when to reach for it.
5. **No `DocStream` → `Doc` round-trip**: once a document has been laid out to a `DocStream`, there is no path back to `Doc`. This means optimized/pre-rendered fragments cannot be embedded as `Doc` nodes. Investigating whether `@effect/printer-ansi` works around this (e.g., by caching `DocStream` outputs as opaque strings) would clarify the right caching strategy for repeated rendering.

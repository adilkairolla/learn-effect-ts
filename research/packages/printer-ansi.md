# @effect/printer-ansi

> Source: `repos/effect/packages/printer-ansi/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: tooling
> Effect deps: `@effect/printer` (runtime dependency — see note below); `effect`, `@effect/typeclass` (peer dependencies)

## What it does

`@effect/printer-ansi` extends `@effect/printer`'s generic `Doc<A>` with ANSI escape sequences, producing `AnsiDoc` (`Doc<Ansi>`) that renders to styled terminal output. Consumers are CLI tools, REPLs, and test reporters needing colored or formatted text. Without this package you would hand-concatenate escape codes, losing all layout intelligence (`group`, `nest`, `align`, `fill`) from `@effect/printer`. This package contributes the styling vocabulary while the parent's layout algorithm remains the sole owner of line-breaking.

**Dependency note:** Unlike almost every other `@effect/*` sibling, `@effect/printer-ansi` declares `@effect/printer` as a runtime `dependency`, not a peer — it is a concrete instantiation, not a parallel consumer. Verified at `repos/effect/packages/printer-ansi/package.json:52-54`.

## Public API surface

- **`Ansi` module** (`repos/effect/packages/printer-ansi/src/Ansi.ts`) — the annotation type. Style constructors: `bold`, `italicized`, `strikethrough`, `underlined`. Color constructors: `red`, `green`, `blue`, bright/background variants. Cursor/erase commands: `cursorTo`, `cursorUp`, `eraseLines`, `eraseScreen`, etc. `combine` merges two `Ansi` values; `stringify` produces the raw escape string.

- **`AnsiDoc` module** (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts`) — `AnsiDoc = Doc<Ansi>`. Re-exports every layout combinator from `@effect/printer/Doc` so callers need only one import. `render` accepts a `RenderConfig` (`compact | pretty | smart`) and returns a `string`.

- **`Color` module** (`repos/effect/packages/printer-ansi/src/Color.ts`) — discriminated union of eight ANSI base colors with a `toCode` destructor mapping each to its ANSI offset 0-7 (`repos/effect/packages/printer-ansi/src/internal/color.ts:52-79`).

## Patterns used

- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all implementation lives under `src/internal/`; public modules are thin facades, e.g. `repos/effect/packages/printer-ansi/src/Ansi.ts:50` delegates every export to `InternalAnsi`.

- [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — `Ansi.combine` and `AnsiDoc.render` are dual-arity via `effect/Function`'s `dual` (`repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:16-33`, `repos/effect/packages/printer-ansi/src/internal/ansi.ts:342-345`).

- [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](../02-patterns-catalog.md#datastruct--tuple--array--class--taggedclass) — `Ansi`'s internal representation uses `@effect/typeclass`'s `Semigroup.struct` and `Monoid.struct` to compose field-level semigroups into a struct-level monoid (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:51-75`).

## What's unique about this package's design

`AnsiDoc` is not a new type: it is `Doc<Ansi>`, a specialization of the printer's parameterized annotation slot (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts:18`). This means zero duplication of the layout algorithm; `@effect/printer` owns all line-breaking and fill logic while `@effect/printer-ansi` only defines what to do with annotations during the render pass.

The render pass (`repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:61-113`) maintains a `List<Ansi>` stack. On `PushAnnotationStream`, the incoming `Ansi` is merged with the top-of-stack via `Ansi.combine` and the result stringified. On `PopAnnotationStream`, the prior entry is re-emitted. This yields correct nested semantics (inner `bold` inside outer `red` produces `[0;31;1m`) without global mutable state (`repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:98-112`).

`Ansi` is itself a monoid (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:66-75`): `combine` merges annotations field-by-field with "first wins" per attribute via `getFirstSomeSemigroup` (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:47-49`), and `stringify` always prepends a full SGR reset before applying merged attributes (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:353-365`) to prevent style bleed.

## Conventions observed

Standard Effect layout (three tsconfig files, `docgen.json` excluding internals). One deviation: `AnsiDoc.ts` re-exports `@effect/printer/Doc`'s entire value namespace verbatim (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts:390-866`), making `@effect/printer-ansi/AnsiDoc` a one-stop import. The internal SGR model is kept package-private via an explicit `null` entry in the export map (`repos/effect/packages/printer-ansi/package.json:40`).

## "If you were authoring something similar, copy this"

- **Type alias as extension point.** Define `YourDoc = Doc<YourAnnotation>` rather than a new class; you inherit the full layout API for free and only write a render pass (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts:18`).

- **Annotation stack for nested semantics.** Use a stack with a merge combinator rather than global mutable style state; see `renderSafe` at `repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:61-113`.

- **`Monoid.struct` for per-field annotation merge.** When annotations have multiple independent attributes, compose field-level monoids into a struct monoid instead of writing merge logic by hand (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:66-75`).

- **Concrete instantiation belongs in `dependencies`.** When your package is a concrete instantiation of a generic parent, list the parent as `dependencies` not `peerDependencies` (`repos/effect/packages/printer-ansi/package.json:52-54`).

- **One-stop re-export module.** Re-export the parent's full value namespace from your specialized module so consumers need only one import (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts:390-866`).

## Open questions

- `Ansi.combine` uses "first wins" (inner wins) per attribute. Whether "last wins" would be more composable is undocumented; `repos/effect/packages/printer-ansi/test/terminal.test.ts:282-286` verifies current behavior but not the rationale.

- Cursor and erase commands are `Ansi` values with a `commands: ReadonlyArray<string>` field, injected via `Doc.annotate(Doc.empty, ...)` (`repos/effect/packages/printer-ansi/src/internal/ansiDoc.ts:6-79`). Whether composing a cursor-move annotation with a color annotation on the same node is defined behavior is not specified.

- `italicized` carries "NOTE: not widely supported" at `repos/effect/packages/printer-ansi/src/internal/sgr.ts:72`. There is no runtime capability detection; the code is always emitted.

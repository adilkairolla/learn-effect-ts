# Chapter 20 — Pretty-printing with @effect/printer

> **Package(s):** `@effect/printer`
> **Patterns introduced:** [`Chunk — typed array container (Stream's element type)`](../../research/02-patterns-catalog.md#chunk--typed-array-container-streams-element-type)
> **Reads from:** Chapter 16 (Stream — Chunk is Stream's element type)
> **Reads into:** Chapter 21 (printer-ansi — ANSI color annotations), Chapter 41 (Stream deep-dive — Chunk in Stream context)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Formatting structured data as human-readable text is an exercise most programs eventually face: CLI help output, AST dumps, configuration diagnostics, error messages with context. The naive approach is to build the string directly with template literals and manual `\n` plus spaces:

```ts
// Manual string concatenation — no layout awareness
function formatRecord(obj: Record<string, unknown>): string {
  const lines: string[] = ["{"]
  for (const [k, v] of Object.entries(obj)) {
    lines.push(`  ${k}: ${JSON.stringify(v)}`)
  }
  lines.push("}")
  return lines.join("\n")
}

console.log(formatRecord({ name: "Alice", age: 30, active: true }))
// {
//   name: "Alice"
//   age: 30
//   active: true
// }
```

This works for shallow objects, but the problems compound fast. Once values are nested, the indentation counter becomes a manually threaded parameter. If you also want the output to fit a given line width — printing `{ name: "Alice", age: 30 }` on one line when it fits, expanding it vertically when it does not — you end up writing a mini layout engine by hand. `JSON.stringify(value, null, 2)` delegates to the runtime but only handles JSON-serializable data, always applies the multi-line format unconditionally, and cannot make the fit-or-break decision at runtime. `@effect/printer` solves all three problems at once.

---

## The minimal example

```ts
import * as Doc from "@effect/printer/Doc"

// Build the document — pure description, no rendering yet
const greeting: Doc.Doc<never> = Doc.hsep([
  Doc.text("Hello,"),
  Doc.text("world!")
])

// Render to a string with the "pretty" algorithm at default width (80 chars)
const output = Doc.render(greeting, { style: "pretty" })

console.log(output)
// Hello, world!

// Nest two items under a header
const report: Doc.Doc<never> = Doc.vsep([
  Doc.text("Report:"),
  Doc.indent(Doc.vsep([
    Doc.text("- users: 42"),
    Doc.text("- errors: 0")
  ]), 2)
])

console.log(Doc.render(report, { style: "pretty" }))
// Report:
//   - users: 42
//   - errors: 0

// The real power: group tries to flatten to one line, falls back to multi-line
const compact = Doc.group(
  Doc.vsep([Doc.text("one"), Doc.text("two"), Doc.text("three")])
)

console.log(Doc.render(compact, { style: "pretty", options: { lineWidth: 40 } }))
// one two three       (fits on one line)

console.log(Doc.render(compact, { style: "pretty", options: { lineWidth: 10 } }))
// one
// two
// three              (does not fit — falls back to multi-line)
```

The key insight is that `Doc<A>` is a *description* of a layout, not a rendered string. You build the description once using combinators, then pass it to a rendering function that makes the fit-or-break decisions at call time, using the available line width.

---

## Tour

`@effect/printer` is organized as a three-stage pipeline: **construct** a `Doc<A>` from primitives and combinators, **lay it out** into a `DocStream<A>` by choosing between alternatives, then **render** the `DocStream` to a string. Each stage is a separate module; `Doc.render` is the one-stop convenience that runs all three.

### Stage 1 — Document construction

**`Doc<A>`** is the central type. Its definition lives at `repos/effect/packages/printer/src/Doc.ts:49–69`:

```
repos/effect/packages/printer/src/Doc.ts:49-69
```

`Doc<A>` is a discriminated union of 13 constructors, from `Fail` and `Empty` through `Char`, `Text`, `Line`, `FlatAlt`, `Cat`, `Nest`, `Union`, `Column`, `WithPageWidth`, `Nesting`, to `Annotated`. The type parameter `A` is the *annotation* type — arbitrary data (colors, tooltips, visibility flags) that travels through the layout untouched and is consumed by the rendering step. When you do not need annotations, `A` is `never`.

`Doc<A>` extends `Pipeable` (via `Doc.Variance<A>` at `repos/effect/packages/printer/src/Doc.ts:75-83`), so every combinator works in both data-last (pipe-friendly) and data-first forms thanks to `dual` — the same pattern covered in Chapter 04.

**Leaf constructors** produce the atomic `Doc` nodes.

`Doc.text` creates a `Text` node for a string of two or more characters (invariant: no newlines) — `repos/effect/packages/printer/src/Doc.ts:439–449`. `Doc.char` is the single-character variant — `repos/effect/packages/printer/src/Doc.ts:428–437`. For strings that may contain newlines (which the API strips), use `Doc.string` at `repos/effect/packages/printer/src/Doc.ts:451–460`.

`Doc.line` is the soft line break — `repos/effect/packages/printer/src/Doc.ts:513–546`. It collapses to a space when `group` decides the content fits, or expands to a newline plus current indentation otherwise. `Doc.lineBreak` (`repos/effect/packages/printer/src/Doc.ts:548–580`) collapses to `empty` instead of a space. `Doc.softLine` (`repos/effect/packages/printer/src/Doc.ts:582–624`) is for word-wrap: space when grouped, break otherwise.

`Doc.empty` represents the empty document — `repos/effect/packages/printer/src/Doc.ts:466–500`. It has height 1 and can affect layout inside `vcat`.

**Concatenation combinators** join documents.

`Doc.cat` puts two documents directly adjacent, no separator — `repos/effect/packages/printer/src/Doc.ts:861–870`. `Doc.hcat` does the same for a collection (`repos/effect/packages/printer/src/Doc.ts:1155-1176`). `Doc.hsep` joins a collection with spaces — `repos/effect/packages/printer/src/Doc.ts:1197-1232`. `Doc.vsep` joins with `line` separators (spaces when grouped, newlines otherwise) — `repos/effect/packages/printer/src/Doc.ts:1234-1285`. `Doc.vcat` joins with `lineBreak` (empty when grouped) — `repos/effect/packages/printer/src/Doc.ts:1125-1153`.

**Layout combinators** control indentation and alignment.

`Doc.nest` adds `n` columns of indentation to all line breaks within a document — `repos/effect/packages/printer/src/Doc.ts:1622-1667`. It works relative to the *current nesting level*. `Doc.indent` prepends `n` spaces at the current cursor position and then hangs the document, indenting it relative to where the cursor currently is — `repos/effect/packages/printer/src/Doc.ts:1759-1795`. `Doc.align` sets the nesting level to the current column — `repos/effect/packages/printer/src/Doc.ts:1669-1715`. `Doc.hang` is `align` plus `nest`: it indents continuation lines by `n` relative to the first character of the document — `repos/effect/packages/printer/src/Doc.ts:1717-1757`.

**Alternative layout combinators** create the fit-or-break flexibility.

`Doc.group` wraps a document in a `Union` of its flattened (single-line) form and the original — `repos/effect/packages/printer/src/Doc.ts:1435–1446`. The layout algorithm picks single-line if it fits, multi-line otherwise. This is the single most important combinator: wrapping any `vsep` in `group` gives "try one line first."

`Doc.flatAlt` provides manual control over the two branches — `repos/effect/packages/printer/src/Doc.ts:1348-1424`. `Doc.flatAlt(left, right)` renders `left` by default, but when grouped, `right` is preferred as the flattened alternative, with `left` as the fallback if `right` does not fit. **Important:** `left` should be less wide than `right`; if `right` does not fit and the layout falls back to `left`, but `left` is actually wider, the algorithm ends up with an even wider layout. This lets you write a `{;}` style that renders `do { stmtA; stmtB }` on one line but falls back to newline-separated statements when space is tight.

**Annotation** — `Doc.annotate` wraps a sub-document with a value of type `A` — `repos/effect/packages/printer/src/Doc.ts:2052-2065`. The annotation has no effect on layout; it is only used by the rendering step. `@effect/printer-ansi` (Chapter 21) uses this mechanism to attach ANSI color codes without changing a single layout calculation.

### Stage 2 — Layout to stream

`Layout` converts a `Doc<A>` to a `DocStream<A>` by running one of four algorithms. The module is at `repos/effect/packages/printer/src/Layout.ts`.

`Layout.pretty` is the default algorithm — `repos/effect/packages/printer/src/Layout.ts:139–157`. It has one element of lookahead: it commits to laying out a group in single-line form if the *first line* fits, even if subsequent lines of that group would exceed the page width. This is fast and correct for most documents.

`Layout.smart` has greater lookahead — `repos/effect/packages/printer/src/Layout.ts:255–258`. Rather than stopping at the first line, it continues checking until it encounters a line whose indentation is at or below the group's starting indentation, preventing premature one-line commits for deeply nested blocks. Use it when `pretty` produces output that runs off the right margin.

`Layout.compact` strips all indentation and annotations — `repos/effect/packages/printer/src/Layout.ts:86–137`. It is fast and produces machine-parseable output. The `Doc.render(doc, { style: "compact" })` shorthand drives it directly.

All three are driven by the lower-level `Layout.wadlerLeijen` function at `repos/effect/packages/printer/src/Layout.ts:77-84`, which accepts a pluggable `Layout.FittingPredicate<A>`. If you need a custom fitting strategy — for instance, one that accounts for ANSI escape sequence lengths — you can supply your own predicate without forking the layout engine.

`Layout.Options` carries a `PageWidth` value — `repos/effect/packages/printer/src/Layout.ts:28-36`. The default is `AvailablePerLine(80, 1)` from `PageWidth.defaultPageWidth` (`repos/effect/packages/printer/src/PageWidth.ts:126-130`).

### Stage 2 inputs — PageWidth

`PageWidth` is a discriminated union of two constructors — `repos/effect/packages/printer/src/PageWidth.ts:24-77`:

- `AvailablePerLine { lineWidth: number; ribbonFraction: number }` — limits both total character count per line and the printable fraction. A `ribbonFraction` of `0.8` means at most 80% of `lineWidth` characters can be non-indentation content, leaving room for margin notes. The constructor is `PageWidth.availablePerLine(lineWidth, ribbonFraction)` (`repos/effect/packages/printer/src/PageWidth.ts:114-118`).
- `Unbounded` — no line-length limit. Useful for machine output. Constructor: `PageWidth.unbounded` (`repos/effect/packages/printer/src/PageWidth.ts:120-124`).

### Stage 3 — DocStream

`DocStream<A>` is the intermediate representation produced by layout — `repos/effect/packages/printer/src/DocStream.ts:29-49`. It is a linked list with seven constructors: `FailedStream`, `EmptyStream`, `CharStream`, `TextStream`, `LineStream`, `PushAnnotationStream`, `PopAnnotationStream`. All branching and layout decisions have been resolved: a `DocStream` is a flat sequence of tokens ready to be stringified.

Annotations appear in the stream as matched `PushAnnotationStream`/`PopAnnotationStream` pairs (`repos/effect/packages/printer/src/DocStream.ts:138–159`). A renderer that wants to strip them ignores both; a renderer that wants to act on them — such as the ANSI renderer in `@effect/printer-ansi` — maintains a stack of active annotations and applies them as it encounters each push/pop.

`Doc.renderStream` turns a `DocStream<A>` into a plain string, stripping all annotations — `repos/effect/packages/printer/src/Doc.ts:2180-2186`. Use it when you already have a `DocStream` (for example, after calling `Layout.pretty` directly) and want to avoid re-running the layout step.

### The Chunk connection

When you need the rendered output as a typed, immutable sequence rather than a raw string, `Chunk<string>` is the natural container. `Chunk.fromIterable` (`repos/effect/packages/effect/src/Chunk.ts:221-251`) wraps any iterable into a `Chunk` — the same type that `Stream.runCollect` returns, making it easy to feed rendered lines directly into an Effect `Stream` pipeline.

### The `Doc.render` convenience

`Doc.render` is the high-level entry point — `repos/effect/packages/printer/src/Doc.ts:2171-2178`. It accepts a `Doc.RenderConfig` object with three shapes:

```ts
{ style: "compact" }
{ style: "pretty";  options?: Partial<Omit<AvailablePerLine, "_tag">> }
{ style: "smart";   options?: Partial<Omit<AvailablePerLine, "_tag">> }
```

The `options` field, when present, is merged over `PageWidth.defaultPageWidth` (80 columns, ribbon fraction 1.0). Supplying `{ lineWidth: 40 }` narrows the page width without having to construct a `PageWidth` manually. The internal `render.ts` at `repos/effect/packages/printer/src/internal/render.ts:13–30` does this merge and then calls `Layout.pretty` or `Layout.smart` accordingly.

### Implementation note — stack safety via Effect trampoline

The layout algorithms recurse on every `Doc` node, which would overflow the call stack for deeply nested documents. Two complementary mechanisms prevent this: the layout step (`wadlerLeijenSafe`) uses `Effect.gen` — `repos/effect/packages/printer/src/internal/layout.ts:41-135` — making each recursive call a suspension trampolined by the Effect runtime; the rendering step (`renderSafe`) uses `Effect.map` + `Effect.suspend` — `repos/effect/packages/printer/src/internal/render.ts:35-70`. Both are driven synchronously via `Effect.runSync`. The public API is fully synchronous; `Effect` is used solely as a trampolining device.

---

## A production example

The package's own example file (`repos/effect/packages/printer/examples/main.ts`) shows how to pretty-print Haskell-style type signatures. The following extends that idea to a full JSON-like value pretty-printer that respects line width, using `Doc.group` to prefer compact representation and falling back to indented multi-line when values are too wide.

```ts
import * as Doc from "@effect/printer/Doc"
import * as Chunk from "effect/Chunk"
import { pipe } from "effect/Function"

// A tiny JSON-like AST
type JValue =
  | { readonly _tag: "JNull" }
  | { readonly _tag: "JBool";   readonly value: boolean }
  | { readonly _tag: "JNumber"; readonly value: number }
  | { readonly _tag: "JString"; readonly value: string }
  | { readonly _tag: "JArray";  readonly items: ReadonlyArray<JValue> }
  | { readonly _tag: "JObject"; readonly fields: ReadonlyArray<readonly [string, JValue]> }

// Convert a JValue to a Doc<never>
function jDoc(v: JValue): Doc.Doc<never> {
  switch (v._tag) {
    case "JNull":   return Doc.text("null")
    case "JBool":   return Doc.text(String(v.value))
    case "JNumber": return Doc.text(String(v.value))
    case "JString": return Doc.text(`"${v.value}"`)

    case "JArray": {
      if (v.items.length === 0) return Doc.text("[]")
      const items = v.items.map(jDoc)
      // Separate items with ", " on one line, or "," + newline when expanded
      const body = pipe(
        items,
        Doc.encloseSep(
          Doc.flatAlt(Doc.catWithSpace(Doc.char("["), Doc.empty), Doc.char("[")),
          Doc.flatAlt(Doc.catWithSpace(Doc.empty, Doc.char("]")), Doc.char("]")),
          Doc.catWithSpace(Doc.char(","), Doc.empty)
        )
      )
      return Doc.group(Doc.align(body))
    }

    case "JObject": {
      if (v.fields.length === 0) return Doc.text("{}")
      const pairs = v.fields.map(([k, val]) =>
        Doc.catWithSpace(Doc.text(`"${k}":`), jDoc(val))
      )
      const body = pipe(
        pairs,
        Doc.encloseSep(
          Doc.flatAlt(Doc.text("{ "), Doc.char("{")),
          Doc.flatAlt(Doc.text(" }"), Doc.char("}")),
          Doc.text(", ")
        )
      )
      return Doc.group(Doc.align(body))
    }
  }
}

// Gather all rendered lines into a Chunk<string> for downstream processing
function renderLines(doc: Doc.Doc<never>, lineWidth: number): Chunk.Chunk<string> {
  const rendered = Doc.render(doc, { style: "pretty", options: { lineWidth } })
  // Split on newlines, collect into a Chunk for O(1) append semantics
  return Chunk.fromIterable(rendered.split("\n"))
}

// Example usage
const value: JValue = {
  _tag: "JObject",
  fields: [
    ["name",  { _tag: "JString", value: "Alice" }],
    ["score", { _tag: "JNumber", value: 99 }],
    ["tags",  {
      _tag: "JArray",
      items: [
        { _tag: "JString", value: "admin" },
        { _tag: "JString", value: "beta" }
      ]
    }]
  ]
}

const doc = jDoc(value)

// Wide page — compact rendering
console.log(Doc.render(doc, { style: "pretty", options: { lineWidth: 80 } }))
// { "name": "Alice", "score": 99, "tags": [ "admin", "beta" ] }

// Narrow page — indented rendering
console.log(Doc.render(doc, { style: "pretty", options: { lineWidth: 30 } }))
// {
//   "name": "Alice",
//   "score": 99,
//   "tags": [
//     "admin",
//     "beta"
//   ]
// }

// Collect lines as a Chunk
const lines = renderLines(doc, 30)
console.log(Chunk.toArray(lines))
```

The `Chunk<string>` produced by `renderLines` is the pattern introduced by this chapter: `Chunk.fromIterable` (`repos/effect/packages/effect/src/Chunk.ts:221-251`) wraps the split array ready for downstream logging, diffing, or `Stream` processing.

---

## Variations

**Custom line width.** Pass `{ lineWidth: 40 }` in the render options instead of the default 80:

```ts
import * as Doc from "@effect/printer/Doc"
Doc.render(myDoc, { style: "pretty", options: { lineWidth: 40 } })
```

**Ribbon fraction.** Limit printable content to 70% of the line, leaving room for margin annotations — use `Layout.options(PageWidth.availablePerLine(80, 0.7))` and call `Layout.pretty(doc, layoutOptions)` directly (`repos/effect/packages/printer/src/PageWidth.ts:47-67`):

```ts
import * as Doc from "@effect/printer/Doc"
import * as Layout from "@effect/printer/Layout"
import * as PageWidth from "@effect/printer/PageWidth"
const layoutOptions = Layout.options(PageWidth.availablePerLine(80, 0.7))
const stream = Layout.pretty(myDoc, layoutOptions)
const result = Doc.renderStream(stream)
```

**Smart vs pretty algorithm.** Swap `style: "smart"` when `pretty` commits to one-line too eagerly for deeply nested call expressions (`repos/effect/packages/printer/src/Layout.ts:159-258`):

```ts
import * as Doc from "@effect/printer/Doc"
Doc.render(deepDoc, { style: "smart", options: { lineWidth: 26 } })
```

**Compact output for machine consumption.** Strip all indentation and annotations in one call (`repos/effect/packages/printer/src/Layout.ts:86–137`):

```ts
import * as Doc from "@effect/printer/Doc"
Doc.render(myDoc, { style: "compact" })
```

**Unbounded width.** Render without any line breaks by passing `PageWidth.unbounded` through `Layout.options` (`repos/effect/packages/printer/src/PageWidth.ts:120-124`):

```ts
import * as Doc from "@effect/printer/Doc"
import * as Layout from "@effect/printer/Layout"
import * as PageWidth from "@effect/printer/PageWidth"
const stream = Layout.unbounded(myDoc)
const result = Doc.renderStream(stream)
```

**Working directly with DocStream.** Call `Layout.pretty` to get a `DocStream<A>` and process it with `DocStream.match` for custom rendering — such as measuring total character count before emitting output (`repos/effect/packages/printer/src/DocStream.ts:339-367`):

```ts
import * as Doc from "@effect/printer/Doc"
import * as Layout from "@effect/printer/Layout"
import * as DocStream from "@effect/printer/DocStream"
const stream = Layout.pretty(myDoc, Layout.defaultOptions)
// fold over stream nodes...
```

---

## Anti-patterns

**Wrong: building layout with manual `\n` and space concatenation.**

```ts
// Anti-pattern — layout decisions hard-coded at construction time
function renderNode(node: ASTNode, indent: number): string {
  return " ".repeat(indent) + node.name + "\n"
    + node.children.map(c => renderNode(c, indent + 2)).join("")
}
```

The indent counter is threaded manually and there is no way to choose between one-line and multi-line at render time. Use `Doc.nest` and `Doc.group` instead — layout decisions are deferred to `Doc.render`.

```ts
import * as Doc from "@effect/printer/Doc"
function nodeDoc(node: ASTNode): Doc.Doc<never> {
  if (node.children.length === 0) return Doc.text(node.name)
  return Doc.group(Doc.vsep([
    Doc.text(node.name + ":"),
    Doc.nest(Doc.vsep(node.children.map(nodeDoc)), 2)
  ]))
}
```

**Wrong: using `JSON.stringify` with an indent argument for non-JSON data.**

```ts
// Anti-pattern — only works for JSON-serializable data; always multi-line
console.log(JSON.stringify(myData, null, 2))
```

`JSON.stringify` cannot handle custom types, cannot adapt to page width, and ignores `undefined` fields and `BigInt` values. Use `@effect/printer` when the data is not pure JSON or when adaptive layout matters.

**Wrong: calling `console.log` inside a document construction function.**

```ts
// Anti-pattern — mixes rendering concern into construction
function buildDoc(x: number): Doc.Doc<never> {
  console.log("building with x =", x) // side-effecting inside pure construction
  return Doc.text(`x = ${x}`)
}
```

Document construction is pure. Log the rendering result outside the `Doc` algebra: build `doc`, call `Doc.render(doc, config)`, then log the string. The printer is fully synchronous and side-effect-free (`repos/effect/packages/printer/src/internal/render.ts:13–30`).

**Wrong: importing from `@effect/printer` path when tree-shaking deep imports.**

```ts
// Importing the barrel re-exports everything including DocTree
import { Doc } from "@effect/printer"
```

Prefer deep imports (`@effect/printer/Doc`, `@effect/printer/Layout`) to import only what you use. The barrel at `repos/effect/packages/printer/src/index.ts:1–49` re-exports all seven top-level modules. Most programs only need `Doc` and optionally `Layout` and `PageWidth`.

---

## See also

- [Chapter 16 — Stream — pull-based async iteration](../part-1-foundations/16-stream.md) — introduced `Chunk` as `Stream.runCollect`'s return type and explained why it is the right container for accumulated stream elements; the same reasoning applies to collecting `DocStream` tokens into a `Chunk<string>`.
- [Chapter 21 — ANSI colors and terminal rendering with `@effect/printer-ansi`](21-printer-ansi.md) — extends `@effect/printer` with an `AnsiDoc` annotation type that maps to ANSI escape sequences; the layout engine is shared unchanged, only the rendering step differs.
- [Chapter 41 — Stream deep-dive — Channel, Sink, GroupBy, and back-pressure](41-stream-deep-dive.md) — covers `Chunk` in the context of `Sink` accumulators and `Stream.runCollect`; directly relevant to feeding `DocStream` output into an Effect `Stream`.
- [Chapter 19 — Building a CLI with `@effect/cli`](19-cli.md) — `@effect/cli` uses `@effect/printer` internally to render all help text via `HelpDoc`; reading that chapter shows the printer in real-world use.
- [Chapter 04 — The `pipe` function and the dual API style](../part-1-foundations/04-pipe-and-dual-api.md) — `Doc<A>` extends `Pipeable`; every combinator ships in data-first and data-last form via `dual`. The `.pipe(Doc.group).pipe(Doc.nest(2))` style works on any `Doc` value.
- [Patterns catalog — Chunk](../../research/02-patterns-catalog.md#chunk--typed-array-container-streams-element-type) — the full pattern entry with when-to-use, when-not-to-use, and anti-pattern guidance.
- [Per-package note: printer](../../research/packages/printer.md) — covers `Flatten`, `Optimize`, `DocTree`, the Effect trampoline idiom, and the `ribbonFraction` design decision in depth.

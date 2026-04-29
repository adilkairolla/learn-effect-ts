# Chapter 21 — ANSI colors and terminal rendering with @effect/printer-ansi

> **Package(s):** `@effect/printer-ansi`
> **Patterns introduced:** [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern)
> **Reads from:** Chapter 20 (printer — Doc, layout, rendering), Chapter 04 (pipe — Pipeable and dual)
> **Reads into:** Chapter 22 (platform — uses the same dual-export pattern), Part III Chapter 58 (versioning and exports map)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Chapter 20 ended with a pretty-printer that produces clean, reflowable text. The `Doc.render` output is a plain `string` — and a terminal does not care about plain strings. When you want color in a CLI, the usual move is to reach for an escape code library:

```ts
// Raw ANSI escape strings — the naive approach
function printStatus(label: string, ok: boolean): void {
  const color = ok ? "\x1b[32m" : "\x1b[31m"   // green or red
  const reset = "\x1b[0m"
  console.log(`${color}${label}${reset}`)
}

// Or via chalk:
import chalk from "chalk"

function printHelp(commands: ReadonlyArray<{ name: string; desc: string }>) {
  let out = chalk.bold("Commands:\n")
  for (const cmd of commands) {
    out += "  " + chalk.green(cmd.name)
    out += " ".repeat(20 - cmd.name.length)  // manual column alignment
    out += cmd.desc + "\n"
  }
  process.stdout.write(out)
}
```

This breaks in several ways at once.

**Line-width calculations are corrupted.** ANSI escape sequences are invisible characters — `\x1b[32m` occupies zero columns in the terminal but six bytes in the string. Any width-measurement code counts those bytes as real characters, producing misaligned output.

**Layout and color are entangled.** The manual `" ".repeat(20 - cmd.name.length)` works only because `cmd.name` has no embedded escapes. Add color and the length calculation drifts. `chalk.stripAnsi` is a band-aid that requires measuring twice.

**No reflow.** `chalk` produces strings eagerly; once concatenated there is no way to ask "does this fit on one line?". The layout and the color application collapse into a single pass.

`@effect/printer-ansi` separates the two concerns. Color is expressed as an *annotation* on a `Doc` value — pure data attached before rendering. The printer's layout algorithm runs first, entirely ignorant of ANSI codes, making all line-breaking decisions on true text widths. Only at render time does the annotation pass attach escape sequences.

---

## The minimal example

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

// Build a document — same combinators as @effect/printer, but typed as AnsiDoc
const statusLine: Doc.AnsiDoc = Doc.hsep([
  Doc.text("build").pipe(Doc.annotate(Ansi.bold)),
  Doc.text("passed").pipe(Doc.annotate(Ansi.green))
])

// Wrap a deeper example with nested colors
const report: Doc.AnsiDoc = Doc.vsep([
  Doc.text("Results:").pipe(Doc.annotate(Ansi.bold)),
  Doc.indent(
    Doc.vsep([
      Doc.hsep([Doc.text("✓"), Doc.text("unit tests")]).pipe(Doc.annotate(Ansi.green)),
      Doc.hsep([Doc.text("✗"), Doc.text("lint")]).pipe(Doc.annotate(Ansi.red))
    ]),
    2
  )
])

// render returns a plain string with embedded ANSI escape sequences
const output = Doc.render(report, { style: "pretty" })
console.log(output)
// Results: (bold)
//   ✓ unit tests  (green)
//   ✗ lint        (red)
```

Two imports cover everything: `Ansi` carries the style constructors (`bold`, `green`, `red`, `underlined`, …); `Doc` from `@effect/printer-ansi/AnsiDoc` re-exports the full `@effect/printer/Doc` combinator set so you do not need a separate `@effect/printer` import.

---

## Tour

### AnsiDoc — the type alias as extension point

`AnsiDoc` is not a new class. At `repos/effect/packages/printer-ansi/src/AnsiDoc.ts:14-18` it is simply:

```ts
/**
 * @since 1.0.0
 * @category model
 */
export type AnsiDoc = Doc<Ansi>
```

`Ansi` fills the annotation slot `A` of `Doc<A>` from `@effect/printer`. Every combinator from Chapter 20 — `Doc.group`, `Doc.vsep`, `Doc.nest`, `Doc.annotate`, `Doc.render` — works unchanged on `AnsiDoc` values. The layout engine never sees the `Ansi` annotation; it is invisible to line-breaking. This is the annotation mechanism introduced at `repos/effect/packages/printer/src/Doc.ts:2052-2065` in Chapter 20.

The `AnsiDoc` module re-exports the entire `@effect/printer/Doc` value namespace (`repos/effect/packages/printer-ansi/src/AnsiDoc.ts:390-866`), so `@effect/printer-ansi/AnsiDoc` is a one-stop import — no separate `@effect/printer` import needed.

### Ansi — the annotation type

The `Ansi` interface is the concrete annotation. Its internal shape (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:16-24`) is a record of optional `SGR` fields:

```ts
interface AnsiImpl extends Ansi.Ansi {
  readonly commands: ReadonlyArray<string>
  readonly foreground: Option.Option<SGR.SGR>
  readonly background: Option.Option<SGR.SGR>
  readonly bold: Option.Option<SGR.SGR>
  readonly strikethrough: Option.Option<SGR.SGR>
  readonly italicized: Option.Option<SGR.SGR>
  readonly underlined: Option.Option<SGR.SGR>
}
```

Each field is `Option<SGR>` — unset (`None`) means "inherit from surrounding context"; set (`Some`) means "apply this attribute." At `repos/effect/packages/printer-ansi/src/Ansi.ts:46-68`, four text-style constructors are exported:

- `Ansi.bold` — renders as SGR code 1
- `Ansi.italicized` — renders as SGR code 3 (**NOTE**: not widely supported; `repos/effect/packages/printer-ansi/src/internal/sgr.ts:68-72`)
- `Ansi.strikethrough` — renders as SGR code 9
- `Ansi.underlined` — renders as SGR code 4

`Ansi.combine` merges two `Ansi` values. It is dual-arity via `dual` (covered in [Chapter 04](../part-1-foundations/04-pipe-and-dual-api.md)), so both forms work:

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"

// data-first
const boldRed = Ansi.combine(Ansi.red, Ansi.bold)

// data-last (pipe-friendly)
const boldRed2 = Ansi.red.pipe(Ansi.combine(Ansi.bold))
```

`Ansi.combine` uses "first wins" per attribute via `getFirstSomeSemigroup` (`repos/effect/packages/printer-ansi/src/internal/ansi.ts:47-49`). When the same attribute appears in both arguments, the left argument wins. This gives inner annotations priority over outer ones: annotating a word with `Ansi.blue` inside a sentence annotated with `Ansi.red` leaves the word blue and the rest red.

### Color — the eight-color discriminated union

`Color` is a discriminated union of eight ANSI base colors — `repos/effect/packages/printer-ansi/src/Color.ts:15`:

```ts
export type Color = Black | Red | Green | Yellow | Blue | Magenta | Cyan | White
```

Each variant carries only a `_tag`. The `Color.toCode` destructor at `repos/effect/packages/printer-ansi/src/Color.ts:137-141` maps each variant to its ANSI offset 0-7, verified at `repos/effect/packages/printer-ansi/src/internal/color.ts:52-79`. You rarely need `Color` directly — `Ansi` provides pre-built values (`Ansi.red`, `Ansi.blue`, `Ansi.bgRed`, …) plus the parametric constructors `Ansi.color(c)`, `Ansi.brightColor(c)`, `Ansi.bgColor(c)`, and `Ansi.bgColorBright(c)` for when you have a `Color` value at hand (`repos/effect/packages/printer-ansi/src/Ansi.ts:74-96`).

### SGR — Select Graphic Rendition (internal detail)

`SGR` lives exclusively in `repos/effect/packages/printer-ansi/src/internal/sgr.ts` and is never re-exported. Its discriminated union has six variants (`repos/effect/packages/printer-ansi/src/internal/sgr.ts:29-36`): `Reset`, `SetBold`, `SetColor`, `SetItalicized`, `SetStrikethrough`, `SetUnderlined`. Each variant maps to a numeric escape code via `SGR.toCode`. The `stringify` function (`repos/effect/packages/printer-ansi/src/Ansi.ts:499-503`) always prepends a `Reset` before applying merged attributes, preventing style bleed between adjacent annotated regions.

### The render pass — annotation stack

`AnsiDoc.render` runs the printer's layout algorithm and then walks the resulting `DocStream<Ansi>` with a stack of active `Ansi` values (`repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:61-113`). On each `PushAnnotationStream` event, the incoming `Ansi` is combined with the top-of-stack and the merged result is stringified. On `PopAnnotationStream`, the prior stack entry is re-emitted, automatically restoring the outer style. Nesting `bold` inside `red` produces `\x1b[0;31;1m` for the inner span and `\x1b[0;31m` for the resumption of outer red — no global mutable state involved.

Like `@effect/printer`, the walk is stack-safe: each recursive call is wrapped in `Effect.suspend` and driven by `Effect.runSync` as a trampoline (`repos/effect/packages/printer-ansi/src/internal/ansiRender.ts:36-37`). The public API is fully synchronous.

### Dual ESM/CJS export pattern

`@effect/printer-ansi` is the canonical example of the **Dual ESM/CJS export pattern** in this tour. Open `repos/effect/packages/printer-ansi/package.json`:

```ts
// repos/effect/packages/printer-ansi/package.json:36-41
"exports": {
  "./package.json": "./package.json",
  ".": "./src/index.ts",
  "./*": "./src/*.ts",
  "./internal/*": null
}
```

Four entries do four distinct jobs.

**`"./package.json"`** — lets Node.js read metadata directly.

**`".": "./src/index.ts"`** — the package root maps to the barrel at dev time. At publish time the `build-utils pack-v3` step rewrites this to dual targets:

```ts
// dist/package.json after build
".": {
  "import": "./dist/esm/index.js",    // Node.js ESM, bundlers
  "require": "./dist/cjs/index.js"    // CommonJS: Jest, Webpack 4, older Next.js
}
```

The ESM build runs `tsc -b tsconfig.build.json`; the CJS build runs the ESM output through Babel's `@babel/plugin-transform-modules-commonjs` (`repos/effect/packages/printer-ansi/package.json:44-47`).

**`"./*": "./src/*.ts"`** — the deep-import wildcard. Every public module is individually addressable (`@effect/printer-ansi/Ansi`, `@effect/printer-ansi/Color`). At publish time each entry expands to the same `import`/`require` dual, giving both ESM and CJS consumers the right artifact without extra bundler config.

**`"./internal/*": null`** — the exclusion entry (`repos/effect/packages/printer-ansi/package.json:40`). Node.js throws `ERR_PACKAGE_PATH_NOT_EXPORTED` for any `@effect/printer-ansi/internal/...` import, enforcing `internal/` privacy at the module-system level rather than by convention alone.

The same four-entry structure appears in the core `effect` package (`repos/effect/packages/effect/package.json:34-39`), making it the standard across the Effect monorepo. The catalog entry — [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) — notes the anti-pattern it replaces: a `"main"` field pointing to a single CJS bundle, which forces ESM consumers to use dynamic `import()` and breaks tree-shaking.

---

## A production example

The following renders a colored CLI help screen. It composes `AnsiDoc` values using the combinators from Chapter 20 and uses `Ansi.annotate` to apply color and weight. The result illustrates why keeping layout and color separate matters: the two-column alignment logic uses `Doc.fill` and `Doc.align` — neither function knows or cares that the command names will be rendered in green.

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"
import * as Console from "effect/Console"
import * as Effect from "effect/Effect"

// ── Types ──────────────────────────────────────────────────────────────────

interface CommandEntry {
  readonly name: string
  readonly aliases: ReadonlyArray<string>
  readonly description: string
}

// ── Document builders ──────────────────────────────────────────────────────

const styledName = (cmd: CommandEntry): Doc.AnsiDoc =>
  Doc.text(cmd.name).pipe(Doc.annotate(Ansi.combine(Ansi.green, Ansi.bold)))

const styledAlias = (alias: string): Doc.AnsiDoc =>
  Doc.text(alias).pipe(Doc.annotate(Ansi.cyan))

const aliasSection = (cmd: CommandEntry): Doc.AnsiDoc =>
  cmd.aliases.length === 0
    ? Doc.empty
    : Doc.hsep([
        Doc.text("(aliases:"),
        Doc.hsep(cmd.aliases.map(styledAlias)),
        Doc.text(")")
      ])

const commandRow = (cmd: CommandEntry): Doc.AnsiDoc =>
  Doc.hsep([
    Doc.fill(
      20,
      Doc.hsep([styledName(cmd), aliasSection(cmd)])
    ),
    Doc.text(cmd.description).pipe(Doc.annotate(Ansi.white))
  ])

const sectionHeader = (title: string): Doc.AnsiDoc =>
  Doc.vsep([
    Doc.text(title).pipe(Doc.annotate(Ansi.combine(Ansi.yellow, Ansi.bold))),
    Doc.text("─".repeat(40)).pipe(Doc.annotate(Ansi.yellow))
  ])

const helpScreen = (
  title: string,
  commands: ReadonlyArray<CommandEntry>
): Doc.AnsiDoc =>
  Doc.vsep([
    Doc.text(title).pipe(Doc.annotate(Ansi.combine(Ansi.bold, Ansi.underlined))),
    Doc.empty,
    sectionHeader("Commands"),
    Doc.indent(
      Doc.vsep(commands.map(commandRow)),
      2
    )
  ])

// ── Entry point ────────────────────────────────────────────────────────────

const commands: ReadonlyArray<CommandEntry> = [
  { name: "build",   aliases: ["b"],      description: "Compile the project" },
  { name: "test",    aliases: ["t", "tst"], description: "Run the test suite" },
  { name: "publish", aliases: [],          description: "Publish to npm registry" },
  { name: "clean",   aliases: [],          description: "Remove build artifacts" }
]

const program = Effect.gen(function*() {
  const doc = helpScreen("my-tool v1.0.0", commands)
  const rendered = Doc.render(doc, { style: "pretty", options: { lineWidth: 80 } })
  yield* Console.log(rendered)
})

Effect.runSync(program)
```

Key observations. `Doc.fill(20, ...)` pads or wraps its content to occupy exactly 20 columns — the color annotations inside it do not affect that count because they are invisible to the layout pass. `Ansi.combine(Ansi.green, Ansi.bold)` stacks two attributes on the same annotation using the monoid structure described in the Tour section. The `Effect.gen` / `yield*` wrapping keeps the I/O side-effect (`Console.log`) inside the Effect system, consistent with the patterns from [Chapter 05](../part-1-foundations/05-effect-gen.md).

---

## Variations

**Bright colors.** Use `Ansi.greenBright`, `Ansi.redBright`, etc. for the high-intensity variants (`repos/effect/packages/printer-ansi/src/Ansi.ts:160-192`). These map to ANSI codes 90-97 (foreground) and 100-107 (background):

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"
const warning = Doc.text("WARNING").pipe(Doc.annotate(Ansi.yellowBright))
```

**Background colors.** `Ansi.bgRed`, `Ansi.bgBlue`, etc. set the cell background. Combine with a foreground color for contrast:

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"
const highlight = Doc.text(" ERROR ").pipe(
  Doc.annotate(Ansi.combine(Ansi.bgRed, Ansi.whiteBright))
)
```

**Conditional coloring — respecting `NO_COLOR`.** The [NO_COLOR](https://no-color.org) convention asks tools to suppress color when `process.env.NO_COLOR` is set. Pass through a plain `Doc<never>` when colors are disabled:

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const colorize = (doc: Doc.AnsiDoc, style: Ansi.Ansi): Doc.AnsiDoc =>
  process.env["NO_COLOR"] !== undefined ? doc : doc.pipe(Doc.annotate(style))

const label = colorize(Doc.text("status"), Ansi.green)
```

**Unstyled rendering for log files.** Use `{ style: "compact" }` when writing to a log file — `compact` strips all annotations, producing clean text with no escape codes:

```ts
import * as Doc from "@effect/printer-ansi/AnsiDoc"
import * as Ansi from "@effect/printer-ansi/Ansi"
const doc: Doc.AnsiDoc = Doc.text("done").pipe(Doc.annotate(Ansi.green))
const forLog  = Doc.render(doc, { style: "compact" })   // "done"
const forTTY  = Doc.render(doc, { style: "pretty" })    // "\x1b[0;32mdone\x1b[0m"
```

**Nested styles — inner wins.** Because `Ansi.combine` uses "first wins" per attribute, annotating an inner span overrides the outer annotation for that attribute:

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const inner = Doc.text("blue").pipe(Doc.annotate(Ansi.blue))
const outer = Doc.hsep([Doc.text("red"), inner, Doc.text("red")])
  .pipe(Doc.annotate(Ansi.red))
// "red" → red, "blue" → blue, trailing "red" → red
const output = Doc.render(outer, { style: "pretty" })
```

**Importing via the package root.** The barrel at `repos/effect/packages/printer-ansi/src/index.ts:1-14` re-exports all three public modules as namespaces. This is equivalent to individual deep imports:

```ts
import { Ansi, AnsiDoc, Color } from "@effect/printer-ansi"
// equivalent to:
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as AnsiDoc from "@effect/printer-ansi/AnsiDoc"
import * as Color from "@effect/printer-ansi/Color"
```

---

## Anti-patterns

**Wrong: raw escape strings alongside `@effect/printer-ansi`.**

```ts
// Anti-pattern — mixing raw escapes with AnsiDoc breaks width accounting
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const broken: Doc.AnsiDoc = Doc.text("\x1b[32mstatus: ok\x1b[0m")
// The printer measures "status: ok" as 22 chars including the escape codes
```

Use `Doc.annotate(Ansi.green)` — the escape sequence is injected by the render pass after layout, so the layout engine measures only "status: ok" (10 characters):

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const correct: Doc.AnsiDoc = Doc.text("status: ok").pipe(Doc.annotate(Ansi.green))
```

**Wrong: importing from the `internal/` path.**

```ts
// Anti-pattern — the internal path is explicitly excluded by package.json
import * as SGR from "@effect/printer-ansi/internal/sgr"  // ERR_PACKAGE_PATH_NOT_EXPORTED
```

The `"./internal/*": null` entry in `repos/effect/packages/printer-ansi/package.json:40` causes Node.js to throw at module resolution time. `SGR` is a private implementation detail; use `Ansi.*` constructors instead.

**Wrong: calling `chalk` on text that will be used in `Doc.fill` or `Doc.nest`.**

```ts
// Anti-pattern — chalk embeds escape codes into the string before layout
import chalk from "chalk"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const name = chalk.green("deploy")  // string, not AnsiDoc
const row = Doc.fill(20, Doc.text(name))  // measures 16 bytes, not 6 chars
```

`chalk.green("deploy")` returns a string with embedded escapes. When passed to `Doc.text`, the printer counts the escape bytes as visible characters. `Doc.fill(20, ...)` then pads for 20 minus 16 (wrong) instead of 20 minus 6 (correct). Annotate after constructing the `Doc`:

```ts
import * as Ansi from "@effect/printer-ansi/Ansi"
import * as Doc from "@effect/printer-ansi/AnsiDoc"

const row = Doc.fill(20, Doc.text("deploy").pipe(Doc.annotate(Ansi.green)))
```

**Wrong: re-defining `Ansi` or `AnsiDoc` as local types.**

```ts
// Anti-pattern — shadows the package's exported types
type Ansi = string                    // shadows Ansi.Ansi
type AnsiDoc = Doc.Doc<string>        // shadows the AnsiDoc type alias
```

Both `Ansi` and `AnsiDoc` are exported by the package. Shadowing them causes type errors when passing values between your code and the library. Rename local types to avoid collisions.

---

## See also

- [Chapter 20 — Pretty-printing with `@effect/printer`](20-printer.md) — the foundation for this chapter: `Doc<A>`, layout algorithms, `DocStream`, and the annotation mechanism that `@effect/printer-ansi` extends.
- [Chapter 19 — Building a CLI with `@effect/cli`](19-cli.md) — `@effect/cli` uses `@effect/printer` internally for all help rendering; understanding `AnsiDoc` unlocks custom help-text styling on top of the CLI scaffold.
- [Chapter 04 — The `pipe` function and the dual API style](../part-1-foundations/04-pipe-and-dual-api.md) — `Ansi.combine` and `AnsiDoc.render` are dual-arity via `dual`; the pipe style and data-first style both work.
- [Chapter 22 — Platform services — the abstract runtime layer](22-platform.md) — `@effect/platform` uses the same four-entry `exports` map shape (`"."`, `"./*"`, `"./internal/*": null`, `"./package.json"`) introduced by the Dual ESM/CJS pattern here.
- [Part III — Chapter 58 — Versioning, exports map, and dual ESM/CJS](../part-3-authoring/58-versioning-and-exports.md) — applies the dual ESM/CJS pattern to the worked-example package `@example/effect-cache`, showing how to set up the build pipeline from scratch.
- [Patterns catalog — Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) — full entry with when-to-use, when-not-to-use, and the anti-pattern it replaces.
- [Per-package note: printer-ansi](../../research/packages/printer-ansi.md) — covers the annotation-stack render algorithm, `Ansi` as a monoid, `Monoid.struct` for per-field composition, and the "concrete instantiation goes in `dependencies`" design decision.

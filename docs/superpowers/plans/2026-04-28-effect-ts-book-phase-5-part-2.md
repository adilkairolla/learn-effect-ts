# Effect TS Book — Phase 5 Part II (Package Tours) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write all 26 Package Tour chapters of the Effect TS Book — chapters 19 through 44 — landing them in `book/part-2-tour/` with a fixed Tour-shaped chapter template, every claim cited against `repos/`, and every named pattern linked back to `research/02-patterns-catalog.md`.

**Architecture:** One task per chapter; each task is self-contained (slug, package(s), patterns to introduce, key citations, size target, cross-references, special notes). All tasks share a single Tour Chapter Shape reference (Task 1 creates it). Chapters are ordered by **use-case interest** — quick wins first (CLI, printer), then platform → sql → rpc → cluster → workflow → ai → opentelemetry → effect-core deep-dives → typeclass → vitest → experimental. They are NOT ordered by strict dependency depth (see `research/04-dependency-graph.md` for the depth ordering we are deliberately not following). Subagent-driven execution: one implementer subagent per chapter, two-stage review (spec compliance + editorial quality), then commit.

**Tech Stack:** Markdown chapters with TypeScript code blocks. No build step. Citations are file paths into `repos/` (pinned at `effect@3.21.2`, SHA `39c934c1476be389f7469433910fdf30fc4dad82`). Cross-references use relative markdown links into `../../research/`, `../part-1-foundations/`, and within `../`.

**Out of scope for this plan:** Part III (authoring + worked example, chapters 45–60). Part III gets its own plan, written after Part II executes.

**Reader assumption:** Part II chapters assume the reader has finished Part I. When a Part I pattern (Effect.gen, Layer, Schema, Stream basics, Fibers, Cause, Data) appears in a Part II chapter, **reference back** rather than re-deriving. Use forward-reference links of the form `[Chapter 09 — Layer](../part-1-foundations/09-layer.md)`.

**Carry-forward lessons from Part I review loops** — every Part II chapter must comply:

- Cite real export lines AND include the JSDoc range — start cited range at the JSDoc opening, not the export signature line.
- No name collisions with library types (don't redefine `ParseError`, `Promise`, `Error`, `Schema`, `Effect`, `Layer`, etc.).
- Don't drop Effects in code examples (every `Effect.log` / `Console.log` / etc. must be yielded or piped, not orphan-called).
- Forward references must always name a chapter number AND what's covered. Every named forward chapter must appear in See also.
- Hedge `@experimental` APIs explicitly.
- Verify variance / parameter-order / overload-order claims against source before writing them.
- `Effect.fromOption` / `Effect.fromEither` / `Effect.getOrFail` DO NOT EXIST as named exports — Option and Either implement `EffectPrototype`, so the idiom is `yield* opt` directly in `Effect.gen`.
- `STM.atomically` does NOT exist — it's `STM.commit`.
- `Data.TaggedEnum` (PascalCase, type) vs `Data.taggedEnum` (camelCase, runtime constructor) — both exist, distinct.
- Schema migrated from `@effect/schema` package into core `effect` in v3.10.0 — mention this once when relevant (chapters that touch Schema).
- `Schema.transformOrFail` callback returns `Effect<A, ParseResult.ParseIssue, R>`, NOT `ParseError`. Callbacks take 4 positional params: `(input, options: ParseOptions, ast: AST.Transformation, encodedSelf)`.
- `Schema.decodeUnknownEither` returns `Either<A, ParseIssue>` (not `ParseError`) — Either / Option variants return raw `ParseIssue`.
- `Schema.ParseResult` does NOT exist — import `ParseResult` separately from `"effect"`.
- `Effect.runSync` throws `FiberFailure` wrapping `AsyncFiberException`, not bare `AsyncFiberException`.
- `runCallback` is NOT the primitive other runners build on — all four (`runPromise`, `runSync`, `runFork`, `runCallback`) call `unsafeFork` directly.
- `Cause.isInterruptedOnly` does NOT match `Effect.timeout` failures — timeout produces `Cause.Fail(TimeoutException)`, not `Cause.Interrupt`.
- `Data.Error` / `Data.TaggedError` do NOT inherit `StructuralPrototype` — they extend ES `Error` via `core.YieldableError`; no `Equal` / `Hash` via Structural.
- `Data.tuple` calls `unsafeArray` directly (no defensive copy), unlike `Data.array` which does `as.slice(0)` first.
- `Either<A, E>` is right-first / success-first — opposite of most fp-ts-style libraries (source even has a `TODO(4.0)` to flip it).
- `Layer<ROut, E, RIn>` — `ROut` is `in` (contravariant), `E` and `RIn` are `out` (covariant).
- `Effect.Service` is `@experimental` — hedge accordingly when chapters use it.
- For pure functions cited in JSDoc, distinguish JSDoc-example lines from real export lines.
- For grouped-package chapters (26 SQL drivers, 27 drizzle+kysely, 32 AI providers): the chapter must mention each grouped package by name in the body and cite at least one source location per package.

---

## File Structure

All Part II output lives under `book/part-2-tour/`:

```
book/part-2-tour/
├── _chapter-shape.md                 # Reference template every Part II chapter follows (Task 1)
├── 19-cli.md                         # Task 2
├── 20-printer.md                     # Task 3
├── 21-printer-ansi.md                # Task 4
├── 22-platform.md                    # Task 5
├── 23-platform-node.md               # Task 6
├── 24-platform-bun-browser.md        # Task 7
├── 25-sql-core.md                    # Task 8
├── 26-sql-drivers.md                 # Task 9
├── 27-sql-query-builders.md          # Task 10
├── 28-rpc.md                         # Task 11
├── 29-workflow.md                    # Task 12
├── 30-cluster.md                     # Task 13
├── 31-ai-core.md                     # Task 14
├── 32-ai-providers.md                # Task 15
├── 33-opentelemetry.md               # Task 16
├── 34-schedule.md                    # Task 17
├── 35-stm.md                         # Task 18
├── 36-concurrency-primitives.md      # Task 19
├── 37-fiber-ref-and-semaphore.md     # Task 20
├── 38-config-and-secrets.md          # Task 21
├── 39-match.md                       # Task 22
├── 40-immutable-collections.md       # Task 23
├── 41-stream-deep-dive.md            # Task 24
├── 42-typeclass.md                   # Task 25
├── 43-vitest.md                      # Task 26
└── 44-experimental.md                # Task 27
```

Each chapter file is one focused unit (~1800-3500 words, ~300-600 lines of markdown). Files are independent.

---

## Tour Chapter Shape (Part II)

Part II chapters share Part I's 7 sections, but **section 3 is reshaped from "How it works" into "Tour"** (an API-surface walkthrough), and **section 4 ("A production example") pulls from the per-package note's "if you were authoring something similar, copy this" guidance**. Task 1 writes the canonical reference doc; Tasks 2–27 each implement it for their chapter.

```markdown
# Chapter NN — <Title from book/00-toc.md>

> **Package(s):** `<package name(s)>`
> **Patterns introduced:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Part I chapters NN, NN, NN (always link back, don't re-derive)
> **Reads into:** Chapter NN+M (where this package's patterns get applied later, if any)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

## The problem (what this package solves)

<2-4 paragraphs, ~250-450 words. Concrete: the JS/TS pain point this PACKAGE removes. What did people do without it (Commander.js, raw pg client, raw OpenAI SDK, etc.)? What goes wrong without typed errors / Layers / Streams? Plain TS code to show the pain.>

## The minimal example

<1-2 paragraphs framing + the smallest runnable example that uses the package's main entry point. 15-40 lines of TS with imports. Show the API shape only — don't yet explain mechanics.>

\`\`\`ts
import { ... } from "@effect/<package>"
// minimal runnable example
\`\`\`

## Tour

<This is the Part II equivalent of Part I's "How it works". 800-1400 words. Walk the API surface — list the main exports the package offers and what each one is for. Group by responsibility, not alphabetical order. For each named export the chapter calls out, cite `repos/<repo>/packages/<pkg>/src/<file>.ts:<line-range>` (JSDoc-inclusive). The Tour answers: "if I'm reading the package's API docs, what's the mental model that organizes them?">

For grouped-package chapters (26, 27, 32), the Tour MUST cover the canonical package in depth AND mention each grouped package with at least one source citation.

## A production example

<1-2 paragraphs framing + a non-trivial example pulled from the package's `examples/` directory or the per-package note's "if you were authoring something similar, copy this" guidance. 40-100 lines of TS. Show composition with at least one Part I pattern (Layer, Effect.gen, Schema, Stream, Fiber).>

\`\`\`ts
// realistic example
\`\`\`

## Variations

<Bulleted list of 3-6 variants of the package's main pattern with one-line examples each. ~200-400 words. E.g., for `@effect/cli`: a flag-only CLI, a sub-command CLI, a CLI that reads stdin, a CLI with structured config.>

## Anti-patterns

<2-4 anti-pattern entries. Each shows the WRONG plain-TS or wrong-Effect-style code first, then the correct package idiom. Pull text from the per-package note's anti-pattern callouts where applicable. ~200-450 words.>

\`\`\`ts
// ❌ Anti-pattern
\`\`\`

\`\`\`ts
// ✅ Correct usage
\`\`\`

## See also

<5-10 cross-references. Format: bulleted list with one-line annotation for each.>

- [Chapter NN — Title](../part-1-foundations/NN-slug.md) — the Part I pattern this chapter builds on
- [Chapter NN — Title](NN-slug.md) — adjacent Part II chapter to read next
- [Patterns Catalog: Pattern Name](../../research/02-patterns-catalog.md#anchor) — formal pattern entry
- [Per-package note](../../research/packages/<name>.md) — research-level notes
```

**Hard constraints on every Part II chapter:**

- All code blocks are `ts`-tagged and include imports.
- Every behavioral claim about a package cites a `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` file:line range, with the range starting at the JSDoc opening (not the export signature line).
- "Patterns introduced" header line links to real anchors in `research/02-patterns-catalog.md`.
- "See also" section has at least 5 entries.
- File ends with the "See also" section.
- No invented APIs. If unsure about behavior, read the cited source. If still unsure, mark it as `> _Note: this is my interpretation; the source is silent on X._`
- Forward references to other Part II chapters or Part III always name the chapter number AND what's covered, AND appear in See also.
- `@experimental` APIs are hedged with explicit prose noting `@experimental` status.

---

## Task 1: Create Part II directory and the Tour Chapter Shape reference

**Files:**
- Create: `book/part-2-tour/_chapter-shape.md`
- Create: `book/part-2-tour/.gitkeep` (so the directory ships even if Tasks 2-27 are skipped)

- [ ] **Step 1: Create the directory**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
mkdir -p book/part-2-tour
touch book/part-2-tour/.gitkeep
```

- [ ] **Step 2: Write the Tour Chapter Shape reference**

Write to `book/part-2-tour/_chapter-shape.md`:

````markdown
# Tour Chapter Shape (Part II — Package Tours)

> Every chapter in Part II follows this template verbatim. Section headers are fixed; section bodies are tailored to the chapter's package(s).

## Header block

```
# Chapter NN — <Title from book/00-toc.md>

> **Package(s):** `<package name(s)>`
> **Patterns introduced:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Part I chapters NN, NN, NN
> **Reads into:** Chapter NN+M (if applicable)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)
```

## Sections (in order)

1. **The problem (what this package solves)** — 250-450 words. The pain this package removes. Plain TS code to show the pain (Commander.js, raw pg, raw OpenAI SDK, etc.). No Effect-flavored alternative yet.
2. **The minimal example** — 15-40 lines of TS with imports. Smallest runnable example using the package.
3. **Tour** — 800-1400 words. API-surface walkthrough. Walk the main exports grouped by responsibility. Every named export cited at `repos/<repo>/packages/<pkg>/src/<file>.ts:<line-range>` (JSDoc-inclusive). For grouped-package chapters, cover the canonical package in depth AND mention each grouped package with at least one source citation per package.
4. **A production example** — 40-100 lines of TS pulled from the package's `examples/` directory OR the per-package note's "if you were authoring something similar, copy this" guidance. Show composition with at least one Part I pattern.
5. **Variations** — 3-6 variants, one-line example each.
6. **Anti-patterns** — 2-4 entries. Wrong code, then correct usage.
7. **See also** — 5+ cross-references to Part I chapters, adjacent Part II chapters, patterns catalog, per-package notes.

## Hard constraints

- All code blocks tagged `ts` and include imports.
- Every behavioral claim cites `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive).
- Header `Patterns introduced:` line links to real anchors in `research/02-patterns-catalog.md`.
- File ends with the "See also" section.
- No invented APIs. Mark uncertainty as a quoted note.
- Forward refs to other chapters always name chapter number AND topic AND appear in See also.
- `@experimental` APIs explicitly hedged.
- Reader is assumed to have read Part I — reference Part I chapters back instead of re-deriving foundation patterns.

## Word target

1800-3500 words per chapter. Smaller is fine if the package is small (printer-ansi, match, typeclass); bigger only if the package genuinely needs it (sql-drivers grouped chapter, ai-providers grouped chapter, stream deep-dive).

## Differences from Part I chapter shape

| Section | Part I | Part II |
|---------|--------|---------|
| 3 | "How it works" — pattern mechanics | "Tour" — API surface walkthrough |
| 4 | "A production example" — pulled from `repos/effect/` | "A production example" — pulled from package `examples/` or per-package note guidance |
| Reader assumption | New to Effect | Has read Part I |

## Grouped-package chapters

Chapters 26 (SQL drivers), 27 (Drizzle + Kysely), and 32 (AI providers) cover multiple packages. For these chapters:
- The Package(s) header line lists ALL grouped packages.
- The Tour covers the canonical package in depth (sql-pg / sql-drizzle / ai-anthropic).
- Every grouped package is named in the body at least once and cited at `repos/...` at least once.
````

- [ ] **Step 3: Commit**

```bash
git add book/part-2-tour/_chapter-shape.md book/part-2-tour/.gitkeep
git commit -m "Scaffold Part II directory and tour chapter shape reference"
```

---

## Per-chapter task structure (Tasks 2–27)

Tasks 2 through 27 follow this identical 5-step structure. Only the parameters change. Each task block below contains the parameters; the steps are reproduced once here so engineers reading out of order have everything.

For each chapter task:

- [ ] **Step 1: Read context**

Read these files in this order:
1. `book/part-2-tour/_chapter-shape.md` (the template)
2. `book/00-toc.md` (the chapter's row, especially "Patterns introduced" links and the Package column)
3. Each linked pattern in `research/02-patterns-catalog.md` (read in full — Signature, Where it appears, When to use, Anti-pattern, Related)
4. The relevant per-package note(s) in `research/packages/<name>.md` — read in full, including the "if you were authoring something similar, copy this" section if present
5. The Part I chapter(s) listed under "Reads from" in this task's parameters — to anchor the cross-references and avoid re-deriving foundation patterns
6. The previous Part II chapter (`book/part-2-tour/<NN-1>-<slug>.md`) if it exists, to confirm cross-references and avoid repeating

- [ ] **Step 2: Open the source files cited in the patterns and per-package note**

For every `repos/...:line-range` citation in the patterns being introduced AND in the per-package note's source-pointers, open the file at those lines and read 30 lines of context. Confirm the signature, the surrounding code, and what the function ACTUALLY does. **Crucially, widen each cited range to start at the JSDoc opening, not the export signature line** — this was the #1 review issue in Part I.

For grouped-package chapters (26, 27, 32), open at least one source file per grouped package in the chapter's package list.

- [ ] **Step 3: Write the chapter file**

Write the chapter to its target path following the Tour Chapter Shape exactly. Constraints:
- Use the chapter's specific title, slug, package(s), patterns, size target (given in each task block below)
- Every behavioral claim cites a `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` file:line range, JSDoc-inclusive
- All code blocks tagged ` ```ts ` and include imports
- "See also" section has 5+ entries linking to Part I chapters, adjacent Part II chapters, patterns catalog, or per-package notes
- File ends with "See also"
- Reader is assumed to have read Part I — link back instead of re-deriving
- For grouped-package chapters, every grouped package is named in the body AND cited at least once
- `@experimental` APIs explicitly hedged

- [ ] **Step 4: Verify the chapter**

Run from `/Users/nosferatu/Projects/personal/effect-help`:

```bash
python3 - <<'PY'
import re, sys, os
chapter_path = '<TASK-SPECIFIC PATH>'
text = open(chapter_path).read()

issues = []

# Header check
if '> **Patterns introduced:**' not in text:
    issues.append('Missing "Patterns introduced" header line')
if '> **Source pinned at:**' not in text:
    issues.append('Missing "Source pinned at" header line')
if '> **Package(s):**' not in text:
    issues.append('Missing "Package(s)" header line')

# Required sections (Part II uses "Tour" instead of "How it works")
required_sections = [
    'The problem',
    'The minimal example',
    'Tour',
    'A production example',
    'Variations',
    'Anti-patterns',
    'See also',
]
for s in required_sections:
    if not re.search(rf'^## {re.escape(s)}', text, re.M):
        issues.append(f'Missing section: ## {s}')

# Code blocks must be ts-tagged
all_blocks = re.findall(r'^```([a-z]*)$', text, re.M)
non_ts = [b for b in all_blocks if b not in ('ts', '')]
if non_ts:
    issues.append(f'Non-ts code blocks: {non_ts}')

# At least one repos/ citation
if 'repos/' not in text:
    issues.append('No repos/ citation found')

# At least one ../../research/02-patterns-catalog.md link
if '../../research/02-patterns-catalog.md#' not in text:
    issues.append('No patterns-catalog cross-reference')

# At least one Part I reference (link back)
if '../part-1-foundations/' not in text:
    issues.append('No Part I cross-reference (chapters should reference back to Part I)')

# See also has at least 5 list items
see_also_match = re.search(r'^## See also\n(.*)$', text, re.M | re.S)
if see_also_match:
    see_also_body = see_also_match.group(1)
    bullet_count = len(re.findall(r'^- ', see_also_body, re.M))
    if bullet_count < 5:
        issues.append(f'See also has only {bullet_count} entries (need 5+)')

# Source pin SHA present
if '39c934c1' not in text:
    issues.append('Missing pinned SHA marker')

# Word count (rough)
word_count = len(re.findall(r'\b\w+\b', text))
if word_count < 1500:
    issues.append(f'Word count too low: {word_count} (target 1800-3500)')
if word_count > 5000:
    issues.append(f'Word count too high: {word_count} (target 1800-3500)')

if issues:
    print('FAIL:')
    for i in issues: print(' -', i)
    sys.exit(1)
print(f'OK. {word_count} words, {len(re.findall(r"^## ", text, re.M))} sections.')
PY
```

Replace `<TASK-SPECIFIC PATH>` with this chapter's file path.

Expected: `OK. <N> words, 7 sections.` (give or take 1 section if the chapter adds an extra subsection.) Fix any issues before committing.

- [ ] **Step 5: Commit**

```bash
git add <chapter-path>
git commit -m "Write Chapter NN — <Title>"
```

---

## Task 2: Chapter 19 — Building a CLI with @effect/cli

**Parameters:**
- File: `book/part-2-tour/19-cli.md`
- Title (from TOC): "Building a CLI with @effect/cli"
- Slug: `19-cli`
- Package: `@effect/cli`
- Patterns introduced: [`Config.string` / `integer` / `boolean` / `nested` / `all`](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all)
- Reads from: Chapter 02 (Effect as a value), Chapter 09 (Layer), Chapter 14 (Schema part 1)
- Reads into: Chapter 38 (Config and secrets)
- Per-package note: `research/packages/cli.md`
- Word target: 2200-3200 words
- Special note: First "quick win" chapter — readers want to BUILD something. Use the per-package note's example (the file-counter CLI from `repos/effect/packages/cli/examples/`). Show `Command.make`, `Args`, `Options`, sub-commands, the `--help` story. Cite `repos/effect/packages/cli/src/Command.ts`, `Args.ts`, `Options.ts`. The patterns-introduced is `Config` because @effect/cli is built on Config.

**Steps:** Follow the per-chapter task structure above (Steps 1–5).

---

## Task 3: Chapter 20 — Pretty-printing with @effect/printer

**Parameters:**
- File: `book/part-2-tour/20-printer.md`
- Title: "Pretty-printing with @effect/printer"
- Slug: `20-printer`
- Package: `@effect/printer`
- Patterns introduced: [Chunk — typed array container (Stream's element type)](../../research/02-patterns-catalog.md#chunk--typed-array-container-streams-element-type)
- Reads from: Chapter 16 (Stream — Chunk is Stream's element type)
- Reads into: Chapter 21 (printer-ansi), Chapter 41 (Stream deep-dive — Chunk in Stream context)
- Per-package note: `research/packages/printer.md`
- Word target: 1800-2600 words
- Special note: Wadler-style pretty-printer (a `Doc<A>` algebraic structure with `cat`, `nest`, `group`, `flatAlt`). Show `Doc.text`, `Doc.line`, `Doc.cat`, `Doc.group`, `Doc.indent`. Cite `repos/printer/packages/printer/src/Doc.ts`. The Chunk pattern shows up because the printer renders to a chunk of strings/bytes.

**Steps:** Follow the per-chapter task structure above.

---

## Task 4: Chapter 21 — ANSI colors and terminal rendering with @effect/printer-ansi

**Parameters:**
- File: `book/part-2-tour/21-printer-ansi.md`
- Title: "ANSI colors and terminal rendering with @effect/printer-ansi"
- Slug: `21-printer-ansi`
- Package: `@effect/printer-ansi`
- Patterns introduced: [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern)
- Reads from: Chapter 20 (printer)
- Reads into: Part III (the worked example's exports map will use this pattern)
- Per-package note: `research/packages/printer-ansi.md`
- Word target: 1800-2400 words
- Special note: smaller chapter — printer-ansi is a thin layer over printer that adds `Color`, `SGR`, `AnsiDoc`. Use the chapter to ALSO showcase the dual ESM/CJS export pattern (this is the catalog pattern for this chapter). Show how printer-ansi's `package.json` exports map is structured. Cite `repos/printer/packages/printer-ansi/src/AnsiDoc.ts`, `Color.ts`, `SGR.ts`, AND `repos/printer/packages/printer-ansi/package.json` for the exports pattern.

**Steps:** Follow the per-chapter task structure above.

---

## Task 5: Chapter 22 — Platform services — the abstract runtime layer

**Parameters:**
- File: `book/part-2-tour/22-platform.md`
- Title: "Platform services — the abstract runtime layer"
- Slug: `22-platform`
- Package: `@effect/platform`
- Patterns introduced: [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internalfolder-and-indexts-re-export-shape)
- Reads from: Chapter 09 (Layer), Chapter 14 (Schema part 1), Chapter 16 (Stream)
- Reads into: Chapter 23 (platform-node), Chapter 24 (platform-bun-browser), Chapter 25 (sql-core)
- Per-package note: `research/packages/platform.md`
- Word target: 2400-3500 words
- Special note: this is a foundational chapter for the rest of Part II — readers must understand the platform abstraction before sql, rpc, etc. Walk the main service tags: `HttpClient`, `HttpServer`, `FileSystem`, `Path`, `Command`, `Terminal`, `KeyValueStore`. The "internal/" pattern is the catalog pattern: show how `index.ts` re-exports from `internal/` modules. Cite `repos/effect/packages/platform/src/HttpClient.ts`, `FileSystem.ts`, `index.ts`, plus a sample `internal/` file.

**Steps:** Follow the per-chapter task structure above.

---

## Task 6: Chapter 23 — Platform on Node.js

**Parameters:**
- File: `book/part-2-tour/23-platform-node.md`
- Title: "Platform on Node.js — HTTP server, file system, and subprocess"
- Slug: `23-platform-node`
- Package: `@effect/platform-node`
- Patterns introduced: [`Pool.make` / `Pool.makeWithTTL` and `KeyedPool`](../../research/02-patterns-catalog.md#poolmake--poolmakewithttl-and-keyedpool)
- Reads from: Chapter 22 (platform), Chapter 09 (Layer), Chapter 10 (Layer.scoped)
- Reads into: Chapter 25 (sql-core), Chapter 33 (opentelemetry)
- Per-package note: `research/packages/platform-node.md` (and `research/packages/platform-node-shared.md` for shared bits)
- Word target: 2200-3200 words
- Special note: show how platform-node provides concrete `Layer`s for the abstract platform tags (`NodeHttpServer.layer`, `NodeFileSystem.layer`, `NodeContext.layer`). The Pool pattern fits because most platform-node services pool resources internally (HTTP connections, file descriptors). Cite `repos/effect/packages/platform-node/src/NodeHttpServer.ts`, `NodeFileSystem.ts`, `NodeContext.ts`, plus `repos/effect/packages/effect/src/Pool.ts` for the Pool pattern.

**Steps:** Follow the per-chapter task structure above.

---

## Task 7: Chapter 24 — Platform on Bun and the browser

**Parameters:**
- File: `book/part-2-tour/24-platform-bun-browser.md`
- Title: "Platform on Bun and the browser"
- Slug: `24-platform-bun-browser`
- Packages: `@effect/platform-bun`, `@effect/platform-browser`
- Patterns introduced: [RcRef and RcMap — reference-counted resources](../../research/02-patterns-catalog.md#rcref-and-rcmap--reference-counted-resources)
- Reads from: Chapter 22 (platform), Chapter 23 (platform-node — for contrast)
- Reads into: nothing (these are end-points in the platform tour)
- Per-package note: `research/packages/platform-bun.md`, `research/packages/platform-browser.md`
- Word target: 2000-3000 words
- Special note: **GROUPED-PACKAGE CHAPTER** — must mention both `@effect/platform-bun` and `@effect/platform-browser` by name and cite at least one source location per package. Bun: `BunHttpServer.ts`, `BunFileSystem.ts`. Browser: `BrowserHttpClient.ts`, `BrowserKeyValueStore.ts`, `BrowserClipboard.ts`. RcRef/RcMap fits as a pattern because browser code often shares a single resource (clipboard, indexedDB connection) across many fibers via reference counting.

**Steps:** Follow the per-chapter task structure above.

---

## Task 8: Chapter 25 — SQL part 1 — the @effect/sql abstraction layer

**Parameters:**
- File: `book/part-2-tour/25-sql-core.md`
- Title: "SQL part 1 — the @effect/sql abstraction layer"
- Slug: `25-sql-core`
- Package: `@effect/sql`
- Patterns introduced: [`Request.of` / `RequestResolver.make` / `Effect.request` — request batching](../../research/02-patterns-catalog.md#requestof--requestresolvermake--effectrequest--request-batching)
- Reads from: Chapter 14 (Schema part 1), Chapter 15 (Schema part 2 — for transformOrFail), Chapter 22 (platform)
- Reads into: Chapter 26 (sql-drivers), Chapter 27 (query builders), Chapter 28 (rpc)
- Per-package note: `research/packages/sql.md`
- Word target: 2400-3500 words
- Special note: walk the abstract `Client` tag and the `sql` template-literal API. Show `SqlClient.make`, `SqlSchema.findOne`, `SqlSchema.findAll`, `SqlSchema.insert`, `SqlSchema.update`, parameterized queries via `sql\`...\``. Request batching fits because sql uses `RequestResolver` under the hood for `findOne`-style helpers. Cite `repos/effect/packages/sql/src/SqlClient.ts`, `Statement.ts`, `SqlSchema.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 9: Chapter 26 — SQL part 2 — drivers (`sql-pg` canonical, with notes on 10 other drivers)

**Parameters:**
- File: `book/part-2-tour/26-sql-drivers.md`
- Title: "SQL part 2 — drivers: writing one (`sql-pg` as canonical, with notes on 10 other drivers)"
- Slug: `26-sql-drivers`
- Packages: `@effect/sql-pg` (canonical), `@effect/sql-mysql2`, `@effect/sql-mssql`, `@effect/sql-sqlite-node`, `@effect/sql-sqlite-bun`, `@effect/sql-sqlite-wasm`, `@effect/sql-sqlite-do`, `@effect/sql-sqlite-react-native`, `@effect/sql-clickhouse`, `@effect/sql-libsql`, `@effect/sql-d1`
- Patterns introduced: [Cache.make / ScopedCache.make — effect-based memoization](../../research/02-patterns-catalog.md#cachemake--scopedcachemake--effect-based-memoization)
- Reads from: Chapter 25 (sql-core), Chapter 09 (Layer), Chapter 23 (platform-node)
- Reads into: Chapter 27 (query builders)
- Per-package notes: `research/packages/sql-pg.md`, plus all 10 others listed in the Package column
- Word target: 3000-4500 words (BIGGER than usual — grouped chapter covering 11 packages)
- Special note: **GROUPED-PACKAGE CHAPTER**. Tour `@effect/sql-pg` in depth (canonical). Then a section "Other drivers" that covers each of the 10 others with one paragraph + at least one source citation each. Cache pattern fits because drivers heavily use `Cache.make` for prepared-statement caching. Cite `repos/effect/packages/sql-pg/src/PgClient.ts` plus one file per other driver (`MysqlClient.ts`, `MssqlClient.ts`, `SqliteClient.ts`, `ClickhouseClient.ts`, `LibsqlClient.ts`, `D1Client.ts`, etc.). For grouped variants (e.g., sqlite-node vs sqlite-bun vs sqlite-wasm vs sqlite-do vs sqlite-react-native), explain WHY there are multiple implementations and what differs.

**Steps:** Follow the per-chapter task structure above.

---

## Task 10: Chapter 27 — SQL part 3 — query builders: Drizzle and Kysely integrations

**Parameters:**
- File: `book/part-2-tour/27-sql-query-builders.md`
- Title: "SQL part 3 — query builders: Drizzle and Kysely integrations"
- Slug: `27-sql-query-builders`
- Packages: `@effect/sql-drizzle`, `@effect/sql-kysely`
- Patterns introduced: [Redacted — prevent secret values from leaking to logs/spans](../../research/02-patterns-catalog.md#redacted--prevent-secret-values-from-leaking-to-logsspans)
- Reads from: Chapter 25 (sql-core), Chapter 26 (sql-drivers)
- Reads into: Chapter 38 (config and secrets — Redacted lives there too)
- Per-package notes: `research/packages/sql-drizzle.md`, `research/packages/sql-kysely.md`
- Word target: 2200-3200 words
- Special note: **GROUPED-PACKAGE CHAPTER**. Drizzle and Kysely are competing TS query-builder ecosystems; this chapter shows how `@effect/sql-drizzle` and `@effect/sql-kysely` integrate each into the Effect SQL `Client` abstraction. Walk both packages' main exports. Mention by name and cite at least one source location per package: `repos/effect/packages/sql-drizzle/src/Pg.ts` (or similar), `repos/effect/packages/sql-kysely/src/Kysely.ts`. Redacted pattern fits because connection strings and DB credentials should be Redacted.

**Steps:** Follow the per-chapter task structure above.

---

## Task 11: Chapter 28 — Type-safe RPC with @effect/rpc

**Parameters:**
- File: `book/part-2-tour/28-rpc.md`
- Title: "Type-safe RPC with @effect/rpc"
- Slug: `28-rpc`
- Package: `@effect/rpc`
- Patterns introduced: [`ConfigProvider.fromEnv` / `fromMap` / `fromJson`](../../research/02-patterns-catalog.md#configproviderfromenv--frommap--fromjson)
- Reads from: Chapter 14 (Schema part 1), Chapter 15 (Schema part 2), Chapter 22 (platform — HttpServer/HttpClient)
- Reads into: Chapter 29 (workflow), Chapter 30 (cluster — both build on rpc)
- Per-package note: `research/packages/rpc.md`
- Word target: 2400-3500 words
- Special note: walk `Rpc.make`, `RpcGroup.make`, `RpcServer`, `RpcClient`, the schema-driven request/response model, streaming RPCs. Cite `repos/effect/packages/rpc/src/Rpc.ts`, `RpcGroup.ts`, `RpcServer.ts`, `RpcClient.ts`. ConfigProvider fits because RPC servers are typically configured from env (port, base URL, auth tokens).

**Steps:** Follow the per-chapter task structure above.

---

## Task 12: Chapter 29 — Durable workflows with @effect/workflow

**Parameters:**
- File: `book/part-2-tour/29-workflow.md`
- Title: "Durable workflows with @effect/workflow"
- Slug: `29-workflow`
- Package: `@effect/workflow`
- Patterns introduced: [Reloadable — hot-reload a service layer at runtime](../../research/02-patterns-catalog.md#reloadable--hot-reload-a-service-layer-at-runtime)
- Reads from: Chapter 14 (Schema), Chapter 28 (rpc), Chapter 09 (Layer), Chapter 06 (typed errors)
- Reads into: Chapter 30 (cluster — workflow integrates with cluster)
- Per-package note: `research/packages/workflow.md`
- Word target: 2200-3200 words
- Special note: **`@effect/workflow` is `@experimental`** — hedge explicitly throughout. Walk `Workflow.make`, `Activity.make`, `DurableClock`, `DurableDeferred`, the engine layers (`Workflow.layer`, in-memory engine for tests). Reloadable fits because durable workflows need to handle service replacement during long-running execution. Cite `repos/effect/packages/workflow/src/Workflow.ts`, `Activity.ts`, `DurableClock.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 13: Chapter 30 — Distributed actors with @effect/cluster

**Parameters:**
- File: `book/part-2-tour/30-cluster.md`
- Title: "Distributed actors with @effect/cluster"
- Slug: `30-cluster`
- Package: `@effect/cluster`
- Patterns introduced: [LayerMap — keyed map of layers (per-tenant / per-request)](../../research/02-patterns-catalog.md#layermap--keyed-map-of-layers-per-tenant--per-request)
- Reads from: Chapter 28 (rpc), Chapter 29 (workflow), Chapter 09 (Layer), Chapter 25 (sql-core)
- Reads into: Part III (cluster-style services as a worked-example variation in retrospective)
- Per-package note: `research/packages/cluster.md`
- Word target: 2400-3500 words
- Special note: **`@effect/cluster` is `@experimental`** — hedge explicitly throughout. Walk `Cluster.make`, `Entity.make`, `Sharding`, `Singleton`, `Persistence`. LayerMap fits because cluster needs a layer per shard / per entity. Cite `repos/effect/packages/cluster/src/ClusterSchema.ts`, `Entity.ts`, `Sharding.ts`, `Singleton.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 14: Chapter 31 — AI abstractions with @effect/ai

**Parameters:**
- File: `book/part-2-tour/31-ai-core.md`
- Title: "AI abstractions with @effect/ai"
- Slug: `31-ai-core`
- Package: `@effect/ai`
- Patterns introduced: [Supervisor — observe and react to fiber lifecycle](../../research/02-patterns-catalog.md#supervisor--observe-and-react-to-fiber-lifecycle)
- Reads from: Chapter 14 (Schema part 1), Chapter 15 (Schema part 2), Chapter 16 (Stream), Chapter 17 (Fibers), Chapter 09 (Layer)
- Reads into: Chapter 32 (AI providers), Chapter 33 (opentelemetry — AI calls are heavily traced)
- Per-package note: `research/packages/ai.md`
- Word target: 2400-3500 words
- Special note: walk the provider-agnostic AI abstractions: `Completions`, `Chat`, `Tokenizer`, `Embeddings`, `Tool`, `Toolkit`. Show how the same chat code runs against different providers by swapping the layer. Supervisor fits because agentic AI loops need fiber-lifecycle observation (cancellation, retry, child-fiber tracking). Cite `repos/ai/packages/ai/src/Chat.ts`, `Completions.ts`, `Tokenizer.ts`, `Tool.ts`, `Toolkit.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 15: Chapter 32 — AI providers — Anthropic deep-dive (OpenAI, Google, Bedrock, OpenRouter as variants)

**Parameters:**
- File: `book/part-2-tour/32-ai-providers.md`
- Title: "AI providers — Anthropic deep-dive (OpenAI, Google, Bedrock, OpenRouter as variants)"
- Slug: `32-ai-providers`
- Packages: `@effect/ai-anthropic` (canonical deep-dive), `@effect/ai-openai`, `@effect/ai-google`, `@effect/ai-amazon-bedrock`, `@effect/ai-openrouter`
- Patterns introduced: [Mailbox — ordered message inbox](../../research/02-patterns-catalog.md#mailbox--ordered-message-inbox)
- Reads from: Chapter 31 (ai-core)
- Reads into: nothing (this is an end-point in the AI tour)
- Per-package notes: `research/packages/ai-anthropic.md`, `research/packages/ai-openai.md`, `research/packages/ai-google.md`, `research/packages/ai-amazon-bedrock.md`, `research/packages/ai-openrouter.md`
- Word target: 3000-4500 words (BIGGER than usual — grouped chapter covering 5 packages)
- Special note: **GROUPED-PACKAGE CHAPTER**. Deep-dive `@effect/ai-anthropic` (canonical). Then "Other providers" section with one paragraph + at least one source citation per other provider. Mailbox pattern fits because streaming chat responses use `Mailbox` for ordered message delivery. Cite `repos/ai/packages/ai-anthropic/src/AnthropicLanguageModel.ts`, `AnthropicClient.ts`, plus one file per other provider: `repos/ai/packages/ai-openai/src/OpenAiLanguageModel.ts`, `repos/ai/packages/ai-google/src/GoogleAiLanguageModel.ts`, `repos/ai/packages/ai-amazon-bedrock/src/AmazonBedrockLanguageModel.ts`, `repos/ai/packages/ai-openrouter/src/OpenRouterLanguageModel.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 16: Chapter 33 — Observability with @effect/opentelemetry

**Parameters:**
- File: `book/part-2-tour/33-opentelemetry.md`
- Title: "Observability with @effect/opentelemetry"
- Slug: `33-opentelemetry`
- Package: `@effect/opentelemetry`
- Patterns introduced: [`Effect.withSpan` / `annotateCurrentSpan` — distributed tracing](../../research/02-patterns-catalog.md#effectwithspan--annotatecurrentspan--distributed-tracing), [`Metric.counter` / `gauge` / `histogram` / `summary`](../../research/02-patterns-catalog.md#metriccounter--gauge--histogram--summary), [`Logger.make` / `withMinimumLogLevel` and `Effect.log*` family](../../research/02-patterns-catalog.md#loggermake--withminimumloglevel-and-effectlog-family)
- Reads from: Chapter 23 (platform-node — opentelemetry layer typically depends on platform-node), Chapter 09 (Layer), Chapter 17 (Fibers — spans are fiber-scoped)
- Reads into: Part III (worked-example will use telemetry for the cache events stream)
- Per-package note: `research/packages/opentelemetry.md`
- Word target: 2400-3500 words
- Special note: three patterns introduced — tracing, metrics, logging. Walk how `@effect/opentelemetry` ties Effect's built-in `Effect.withSpan`, `Metric.*`, `Logger.*` to the OTLP exporter. Show `NodeSdk.layer`, `WebSdk.layer`. Cite `repos/effect/packages/opentelemetry/src/NodeSdk.ts`, `Resource.ts`, `Tracer.ts`, `Metrics.ts`, `Logger.ts`. Note: the pattern citations point to core `effect`, not opentelemetry — `Effect.withSpan` lives in `repos/effect/packages/effect/src/Effect.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 17: Chapter 34 — Schedule — declarative retry, repeat, and cron

**Parameters:**
- File: `book/part-2-tour/34-schedule.md`
- Title: "Schedule — declarative retry, repeat, and cron"
- Slug: `34-schedule`
- Package: `effect` (core package — Schedule module)
- Patterns introduced: [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](../../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs), [`Schedule.jittered` / `compose` — combinators](../../research/02-patterns-catalog.md#schedulejittered--compose--combinators), [`Cron.parse` / `make` and `DateTime.now` / `make` / `format`](../../research/02-patterns-catalog.md#cronparse--make-and-datetimenow--make--format)
- Reads from: Chapter 05 (Effect.gen — Schedule appears in retry/repeat operators), Chapter 06 (typed errors — retry filters by error tag)
- Reads into: Chapter 35 (STM), Part III (the worked-example's eviction loop is Schedule-driven)
- Per-package note: `research/packages/effect.md` (Schedule section)
- Word target: 2400-3500 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER** — assume reader has Part I's working knowledge of `Effect.retry` and `Effect.repeat`. Go deeper than Part I introduced: combinators (`andThen`, `union`, `intersect`, `tapOutput`, `whileInput`, `untilInput`), `Schedule.input` / `output`, `Cron.parse` for cron-driven schedules, `DateTime` integration. Cite `repos/effect/packages/effect/src/Schedule.ts`, `Cron.ts`, `DateTime.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 18: Chapter 35 — STM — software transactional memory

**Parameters:**
- File: `book/part-2-tour/35-stm.md`
- Title: "STM — software transactional memory"
- Slug: `35-stm`
- Package: `effect` (core package — STM module)
- Patterns introduced: [`STM.gen` / `STM.commit` — software transactional memory](../../research/02-patterns-catalog.md#stmgen--stmcommit--software-transactional-memory), [`TRef` / `TQueue` / `TMap` / `TSemaphore` — STM-aware variants](../../research/02-patterns-catalog.md#tref--tqueue--tmap--tsemaphore--stm-aware-variants)
- Reads from: Chapter 17 (Fibers — STM coordinates concurrent fibers), Chapter 36 (Concurrency primitives) — order note: Chapter 35 actually comes BEFORE 36 in the book; for understanding TRef/TQueue, the reader can skim ahead but the chapter is self-contained
- Reads into: Chapter 36 (concurrency primitives — STM variants), Chapter 37 (FiberRef/Semaphore)
- Per-package note: `research/packages/effect.md` (STM section)
- Word target: 2400-3500 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. Critical correction: **`STM.atomically` does NOT exist — it's `STM.commit`**. Walk `STM.gen`, `STM.commit`, retry semantics, `STM.check`, the STM monad. Show `TRef.make`, `TQueue.bounded`, `TMap.empty`, `TSemaphore.make`. Bank-transfer or producer-consumer example for production. Cite `repos/effect/packages/effect/src/STM.ts`, `TRef.ts`, `TQueue.ts`, `TMap.ts`, `TSemaphore.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 19: Chapter 36 — Concurrency primitives — Ref, Queue, PubSub, and friends

**Parameters:**
- File: `book/part-2-tour/36-concurrency-primitives.md`
- Title: "Concurrency primitives — Ref, Queue, PubSub, and friends"
- Slug: `36-concurrency-primitives`
- Package: `effect` (core package — Ref/Queue/PubSub/Deferred modules)
- Patterns introduced: [Ref — atomic mutable cell](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell), [Queue — unbounded / bounded / sliding / dropping](../../research/02-patterns-catalog.md#queue--unbounded--bounded--sliding--dropping), [PubSub — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast), [Deferred — one-shot async value](../../research/02-patterns-catalog.md#deferred--one-shot-async-value)
- Reads from: Chapter 17 (Fibers), Chapter 35 (STM — for context on the non-STM versions)
- Reads into: Chapter 37 (FiberRef/Semaphore — adjacent primitives), Chapter 41 (Stream deep-dive — Stream.fromPubSub / fromQueue)
- Per-package note: `research/packages/effect.md` (Ref/Queue/PubSub sections)
- Word target: 2400-3500 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. Four primitives in one chapter; each gets a Tour subsection. Show `Ref.make` / `Ref.update` / `Ref.modify`, `Queue.bounded` / `unbounded` / `sliding` / `dropping` and the back-pressure semantics, `PubSub.bounded` / `unbounded` / `sliding` / `dropping` with subscribers, `Deferred.make` / `Deferred.succeed` / `Deferred.await`. Cite `repos/effect/packages/effect/src/Ref.ts`, `Queue.ts`, `PubSub.ts`, `Deferred.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 20: Chapter 37 — FiberRef, Semaphore, and advanced concurrency patterns

**Parameters:**
- File: `book/part-2-tour/37-fiber-ref-and-semaphore.md`
- Title: "FiberRef, Semaphore, and advanced concurrency patterns"
- Slug: `37-fiber-ref-and-semaphore`
- Package: `effect` (core package — FiberRef/Semaphore/FiberSet/FiberMap/FiberHandle modules)
- Patterns introduced: [FiberRef — fiber-local state](../../research/02-patterns-catalog.md#fiberref--fiber-local-state), [Semaphore — async resource limiting](../../research/02-patterns-catalog.md#semaphore--async-resource-limiting), [FiberSet / FiberMap / FiberHandle — fiber lifecycle tracking](../../research/02-patterns-catalog.md#fiberset--fibermap--fiberhandle--fiber-lifecycle-tracking)
- Reads from: Chapter 17 (Fibers), Chapter 36 (concurrency primitives)
- Reads into: Chapter 41 (Stream deep-dive — Stream's mapEffect uses Semaphore internally), Part III (worked-example uses FiberSet to track eviction fibers)
- Per-package note: `research/packages/effect.md` (FiberRef/Semaphore sections)
- Word target: 2200-3200 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. FiberRef shows how request scopes propagate (logging context, tracing context). Semaphore shows async-aware mutex / resource limiting. FiberSet/FiberMap/FiberHandle for tracking child fibers. Cite `repos/effect/packages/effect/src/FiberRef.ts`, `Effect.ts` (for Semaphore — it's defined there as `Effect.makeSemaphore`), `FiberSet.ts`, `FiberMap.ts`, `FiberHandle.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 21: Chapter 38 — Config and secrets — typed environment loading

**Parameters:**
- File: `book/part-2-tour/38-config-and-secrets.md`
- Title: "Config and secrets — typed environment loading"
- Slug: `38-config-and-secrets`
- Package: `effect` (core package — Config/Secret/Encoding/Random modules)
- Patterns introduced: [Secret — memory-safe secret string](../../research/02-patterns-catalog.md#secret--memory-safe-secret-string), [Encoding — Base64 / hex / UTF-8 codecs](../../research/02-patterns-catalog.md#encoding--base64--hex--utf-8-codecs), [Random — testable seed-based RNG service](../../research/02-patterns-catalog.md#random--testable-seed-based-rng-service)
- Reads from: Chapter 19 (cli — Config used for CLI flags), Chapter 27 (sql-query-builders — Redacted introduced there), Chapter 09 (Layer)
- Reads into: Part III (worked-example uses Config for cache TTL/size, Random for jittered eviction)
- Per-package note: `research/packages/effect.md` (Config section)
- Word target: 2200-3200 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. Three patterns: Secret (memory-safe), Encoding (Base64/hex/UTF-8 — pure), Random (testable RNG service). Show `Config.string` / `integer` / `boolean` / `nested` / `all` / `redacted` / `secret`. Hedge: `Secret` was deprecated in favor of `Redacted` — clarify both exist and Redacted is preferred. Cite `repos/effect/packages/effect/src/Config.ts`, `Secret.ts`, `Redacted.ts`, `Encoding.ts`, `Random.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 22: Chapter 39 — Match — exhaustive pattern matching

**Parameters:**
- File: `book/part-2-tour/39-match.md`
- Title: "Match — exhaustive pattern matching"
- Slug: `39-match`
- Package: `effect` (core package — Match module)
- Patterns introduced: [`Match.value` / `Match.type` — starting a match](../../research/02-patterns-catalog.md#matchvalue--matchtype--starting-a-match)
- Reads from: Chapter 06 (typed errors — TaggedError unions are common Match targets), Chapter 18 (Data — TaggedEnum is a common Match target)
- Reads into: Chapter 44 (experimental — Machine uses Match for state transitions)
- Per-package note: `research/packages/effect.md` (Match section)
- Word target: 1800-2600 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. Match is small but powerful. Walk `Match.value`, `Match.type`, `Match.when`, `Match.tag`, `Match.tags`, `Match.exhaustive`, `Match.either`, `Match.option`. Show TaggedError discrimination, TaggedEnum discrimination, the data-first vs data-last (Pipeable) usage. Cite `repos/effect/packages/effect/src/Match.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 23: Chapter 40 — Immutable collections — HashMap, HashSet, Chunk, List, and trees

**Parameters:**
- File: `book/part-2-tour/40-immutable-collections.md`
- Title: "Immutable collections — HashMap, HashSet, Chunk, List, and trees"
- Slug: `40-immutable-collections`
- Package: `effect` (core package — HashMap/HashSet/List/RedBlackTree/Trie/SortedMap/SortedSet modules)
- Patterns introduced: [HashMap — structural-equality keyed map](../../research/02-patterns-catalog.md#hashmap--structural-equality-keyed-map), [HashSet — structural-equality set](../../research/02-patterns-catalog.md#hashset--structural-equality-set), [List — persistent linked list](../../research/02-patterns-catalog.md#list--persistent-linked-list), [RedBlackTree](../../research/02-patterns-catalog.md#redblacktree), [Trie](../../research/02-patterns-catalog.md#trie)
- Reads from: Chapter 18 (Data, Equal, Hash — collections rely on structural equality), Chapter 12 (Option/Either — collection lookups return Option)
- Reads into: Chapter 42 (typeclass — collections implement many typeclasses)
- Per-package note: `research/packages/effect.md` (HashMap/HashSet/List sections)
- Word target: 2400-3500 words
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER**. Five immutable collection types in one chapter; each gets a Tour subsection. Show structural-equality semantics (HashMap with Data.struct keys), persistent updates, the Chunk/List/Array spectrum (when to use each). Cite `repos/effect/packages/effect/src/HashMap.ts`, `HashSet.ts`, `List.ts`, `RedBlackTree.ts`, `Trie.ts`, `SortedMap.ts`, `SortedSet.ts`. Note: the SortedMap/SortedSet pattern listed in the TOC for Chapter 42 is also relevant here — clarify but don't double-cover.

**Steps:** Follow the per-chapter task structure above.

---

## Task 24: Chapter 41 — Stream deep-dive — Channel, Sink, GroupBy, and back-pressure

**Parameters:**
- File: `book/part-2-tour/41-stream-deep-dive.md`
- Title: "Stream deep-dive — Channel, Sink, GroupBy, and back-pressure"
- Slug: `41-stream-deep-dive`
- Package: `effect` (core package — Stream/Channel/Sink/GroupBy modules)
- Patterns introduced: [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](../../research/02-patterns-catalog.md#streamfrompubsub--fromqueue--fromschedule--groupby), [Channel — bidirectional stream primitive (Stream's underlying type)](../../research/02-patterns-catalog.md#channel--bidirectional-stream-primitive-streams-underlying-type), [Sink — Stream consumer / aggregator](../../research/02-patterns-catalog.md#sink--stream-consumer--aggregator)
- Reads from: Chapter 16 (Stream — Part I introduced Stream basics; this chapter goes deeper), Chapter 36 (concurrency primitives — Stream.fromPubSub/fromQueue), Chapter 37 (FiberRef/Semaphore — Stream's mapEffect uses Semaphore)
- Reads into: nothing (this is the end of the core-effect deep-dive section)
- Per-package note: `research/packages/effect.md` (Stream/Channel/Sink sections)
- Word target: 2800-4000 words (BIGGER — Stream is the densest core module)
- Special note: **CORE-EFFECT DEEP-DIVE CHAPTER** — explicitly assumes Chapter 16 (Stream basics) is done. Walk `Channel<...>` (the underlying primitive — bidirectional stream with input + output + done), `Sink<...>` (the consumer abstraction), `GroupBy` (the grouping primitive), back-pressure via bounded queues, `Stream.fromPubSub` / `fromQueue` / `fromSchedule`. Cite `repos/effect/packages/effect/src/Channel.ts`, `Sink.ts`, `Stream.ts` (for fromPubSub/fromQueue/fromSchedule/groupBy), `GroupBy.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 25: Chapter 42 — Algebraic typeclasses with @effect/typeclass

**Parameters:**
- File: `book/part-2-tour/42-typeclass.md`
- Title: "Algebraic typeclasses with @effect/typeclass"
- Slug: `42-typeclass`
- Package: `@effect/typeclass`
- Patterns introduced: [SortedMap / SortedSet (with Order)](../../research/02-patterns-catalog.md#sortedmap--sortedset-with-order)
- Reads from: Chapter 18 (Data, Equal, Hash — typeclass instances live on Data types), Chapter 40 (immutable collections — collections implement Foldable/Traversable)
- Reads into: nothing (typeclass is a self-contained reference)
- Per-package note: `research/packages/typeclass.md`
- Word target: 1800-2800 words
- Special note: walk the algebraic vocabulary: `Equivalence`, `Order`, `Semigroup`, `Monoid`, `Functor`, `Applicative`, `Monad`, `Foldable`, `Traversable`, `Bounded`. Show how Effect's collections (HashMap, List, Chunk) implement these, and how `Order` drives `SortedMap` / `SortedSet`. Cite `repos/effect/packages/typeclass/src/Order.ts`, `Semigroup.ts`, `Monoid.ts`, `Functor.ts`, `Applicative.ts`, `Monad.ts`, `Foldable.ts`, `Traversable.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 26: Chapter 43 — Testing Effect programs with @effect/vitest

**Parameters:**
- File: `book/part-2-tour/43-vitest.md`
- Title: "Testing Effect programs with @effect/vitest"
- Slug: `43-vitest`
- Package: `@effect/vitest`
- Patterns introduced: [Runtime — pre-built runtime for executing Effects](../../research/02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects), [RuntimeFlags — concurrency, tracing, interruption controls](../../research/02-patterns-catalog.md#runtimeflags--concurrency-tracing-interruption-controls)
- Reads from: Chapter 03 (running effects), Chapter 09 (Layer), Chapter 10 (Layer.scoped), Chapter 17 (Fibers — TestClock controls fiber time)
- Reads into: Part III (worked-example tests use it.effect / it.scoped / it.live)
- Per-package note: `research/packages/vitest.md`
- Word target: 2200-3200 words
- Special note: walk `it.effect`, `it.scoped`, `it.live`, `it.layer`, `it.flakyTest`, `expect.fail` integration with TaggedError. Show `TestClock.adjust` for time-control tests. Cite `repos/effect/packages/vitest/src/index.ts`, `internal.ts`, plus `repos/effect/packages/effect/src/TestClock.ts`. Runtime/RuntimeFlags fit because vitest sets up a fresh runtime per test.

**Steps:** Follow the per-chapter task structure above.

---

## Task 27: Chapter 44 — Experimental patterns — Machine, PersistedCache, EventLog

**Parameters:**
- File: `book/part-2-tour/44-experimental.md`
- Title: "Experimental patterns — Machine, PersistedCache, EventLog"
- Slug: `44-experimental`
- Package: `@effect/experimental`
- Patterns introduced: [SynchronizedRef — atomic effectful update](../../research/02-patterns-catalog.md#synchronizedref--atomic-effectful-update), [SubscriptionRef — observable Ref](../../research/02-patterns-catalog.md#subscriptionref--observable-ref), [RateLimiter — token-bucket rate limiting](../../research/02-patterns-catalog.md#ratelimiter--token-bucket-rate-limiting)
- Reads from: Chapter 36 (concurrency primitives — Ref family), Chapter 39 (Match — Machine uses Match), Chapter 26 (sql-drivers — PersistedCache backs onto SQL)
- Reads into: nothing (this is the last Part II chapter)
- Per-package note: `research/packages/experimental.md`
- Word target: 2200-3200 words
- Special note: **WHOLE PACKAGE IS `@experimental`** — hedge throughout. Walk `Machine` (state-machine primitive), `PersistedCache` (SQL-backed cache), `EventLog` (event-sourcing primitive), `Reactivity`, `RequestResolver` extensions. The three patterns introduced (SynchronizedRef, SubscriptionRef, RateLimiter) live in core `effect`, not experimental — link them out and show how Machine/PersistedCache build on them. Cite `repos/effect/packages/experimental/src/Machine.ts`, `PersistedCache.ts`, `EventLog.ts`, plus `repos/effect/packages/effect/src/SynchronizedRef.ts`, `SubscriptionRef.ts`, `RateLimiter.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Self-Review

Coverage check against `book/00-toc.md`:

- ✅ Tasks 2–27 cover chapters 19–44 in TOC order; Part II has 26 chapters total (44 − 19 + 1 = 26).
- ✅ Every Part II chapter row in the TOC has a matching task.
- ✅ Every "Patterns introduced" link in the TOC is forwarded to the task parameters.
- ✅ Every chapter's Package column value is forwarded to the task parameters; grouped-package chapters list ALL grouped packages.
- ✅ Cross-references between chapters are explicit in each task's "Reads from" / "Reads into".
- ✅ Per-package note(s) referenced in each task to ground the "production example" section.
- ✅ Pinned SHA `39c934c1...` referenced consistently.
- ✅ Out-of-scope (Part III) clearly deferred.
- ✅ Setup task (Task 1) creates the directory + Tour Chapter Shape reference before any chapter task.
- ✅ All carry-forward lessons from Part I are documented in the plan header and reinforced in the verifier (JSDoc-inclusive citations, hedge `@experimental`, no name collisions, etc.).
- ✅ Grouped-package chapters (24, 26, 27, 32) are flagged with **GROUPED-PACKAGE CHAPTER** and have explicit instructions to mention each grouped package by name and cite at least one source location per package.
- ✅ Core-effect deep-dive chapters (34, 35, 36, 37, 38, 39, 40, 41) are flagged with **CORE-EFFECT DEEP-DIVE CHAPTER** and have explicit instruction to reference Part I rather than re-derive.
- ✅ `@experimental` packages (workflow ch. 29, cluster ch. 30, experimental ch. 44) are flagged with explicit hedge requirements.

Type / name consistency:
- File paths consistent: `book/part-2-tour/<NN>-<slug>.md` everywhere.
- Slugs match the TOC exactly (`19-cli`, `20-printer`, ..., `44-experimental`).
- Task numbering: Task 1 = scaffold; Tasks 2–27 = chapters 19–44 (Task N covers Chapter N+17).
- Verifier section name updated from Part I's `How it works` to Part II's `Tour`.
- Verifier additionally checks for `> **Package(s):**` header line and `../part-1-foundations/` cross-reference (Part II–specific).

Use-case ordering verified against TOC:
- Quick wins: 19 cli → 20 printer → 21 printer-ansi
- Platform tour: 22 platform → 23 platform-node → 24 platform-bun-browser
- Data services: 25 sql-core → 26 sql-drivers → 27 sql-query-builders → 28 rpc → 29 workflow → 30 cluster
- AI: 31 ai-core → 32 ai-providers
- Observability: 33 opentelemetry
- Core-effect deep-dives: 34 schedule → 35 stm → 36 concurrency-primitives → 37 fiber-ref-and-semaphore → 38 config-and-secrets → 39 match → 40 immutable-collections → 41 stream-deep-dive
- Tooling / advanced: 42 typeclass → 43 vitest → 44 experimental

Order matches the user's locked decision: NOT strict dep depth.

No placeholders: every task has its specific title, slug, package(s), patterns list, size target, per-package note pointer, and special note. The per-chapter steps reference a verifier that uses the chapter's specific path; the engineer substitutes `<TASK-SPECIFIC PATH>` with the path given at the top of the task block. Every grouped-package chapter explicitly lists the source files to cite per grouped package.

Pacing recommendation (for execution): write chapters strictly in numerical order. Many Part II chapters cross-reference earlier Part II chapters (e.g., 26 references 25, 27 references 26, 32 references 31). Two-stage review per chapter is fast given the file is one self-contained markdown document. Expect grouped chapters (24, 26, 27, 32) and Stream deep-dive (41) to take ~2x as long as standard chapters due to the wider source coverage.

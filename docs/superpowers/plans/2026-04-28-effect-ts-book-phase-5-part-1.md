# Effect TS Book — Phase 5 Part I (Foundations) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write all 18 Foundation chapters of the Effect TS Book — chapters 01 through 18 — landing them in `book/part-1-foundations/` with the fixed chapter shape, every claim cited against `repos/effect/`, and every named pattern linked back to `research/02-patterns-catalog.md`.

**Architecture:** One task per chapter; each task is self-contained (slug, patterns to introduce, key citations, size target, cross-references). All tasks share a single Chapter Shape reference (Task 1 creates it). Chapters are written sequentially because each one builds the vocabulary the next one assumes — Chapter 09 (Layer) cannot be written before Chapter 08 (Context) is committed, since 09 cross-links into 08. Subagent-driven execution: one implementer subagent per chapter, two-stage review (spec compliance + editorial quality), then commit.

**Tech Stack:** Markdown chapters with TypeScript code blocks. No build step. Citations are file paths into `repos/effect/` (pinned at `effect@3.21.2`, SHA `39c934c1476be389f7469433910fdf30fc4dad82`). Cross-references use relative markdown links into `../../research/` and within `../`.

**Out of scope for this plan:** Part II (package tours, chapters 19–44) and Part III (authoring + worked example, chapters 45–60). Each gets its own plan, written after Part I executes. Lessons from Part I (writing patterns, voice, problems) feed into the Part II plan.

---

## File Structure

All Part I output lives under `book/part-1-foundations/`:

```
book/part-1-foundations/
├── _chapter-shape.md              # Reference template every chapter follows (Task 1)
├── 01-why-effect.md               # Task 2
├── 02-effect-as-a-value.md        # Task 3
├── 03-running-effects.md          # Task 4
├── 04-pipe-and-dual-api.md        # Task 5
├── 05-effect-gen.md               # Task 6
├── 06-typed-errors.md             # Task 7
├── 07-cause-model.md              # Task 8
├── 08-context-and-tags.md         # Task 9
├── 09-layer.md                    # Task 10
├── 10-layer-scoped-and-scope.md   # Task 11
├── 11-constructors.md             # Task 12
├── 12-option-and-either.md        # Task 13
├── 13-branded-types.md            # Task 14
├── 14-schema-part-1.md            # Task 15
├── 15-schema-part-2.md            # Task 16
├── 16-stream.md                   # Task 17
├── 17-fibers-and-concurrency.md   # Task 18
└── 18-data-equal-hash.md          # Task 19
```

Each chapter file is one focused unit (~1500-3000 words, ~250-500 lines of markdown). Files that change together don't exist in this part — chapters are independent text files.

---

## Chapter Shape

Every Part I chapter follows this fixed structure. Task 1 writes the canonical reference doc; Tasks 2–19 each implement it for their chapter.

```markdown
# Chapter NN — <Title from TOC>

> **Patterns introduced:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Chapters NN-1, NN-2 (if any prerequisites)
> **Reads into:** Chapters NN+M (forward references where helpful)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1...`)

## The problem (what JS/TS lacks)

<2-4 paragraphs, ~250-400 words. Concrete: the JS/TS pain point this chapter's pattern removes. Use plain TS code to show the pain. No mention of Effect yet — set up the gap that Effect fills.>

## The minimal example

<1-2 paragraphs framing + the smallest runnable example using the pattern. Typically 10-30 lines of TS with imports. Show the API shape only — don't yet explain mechanics.>

\`\`\`ts
import { Effect } from "effect"
// minimal runnable example
\`\`\`

## How it works

<3-6 paragraphs, ~600-1000 words. Mechanics. Why does this work? What is the shape of the API and why is it shaped that way? Cite `repos/effect/packages/effect/src/<file>.ts:<line-range>` for every behavioral claim.>

## A production example

<1-2 paragraphs framing + a non-trivial example pulled from real Effect source or a realistic application. ~30-80 lines of TS. Cite the source location if pulled from `repos/`. Show the pattern composing with at least one OTHER pattern from earlier chapters.>

\`\`\`ts
// realistic example
\`\`\`

## Variations

<Bulleted or numbered list of 3-6 variants of the pattern with one-line examples each. E.g., for `Effect.gen`: yielding Options, yielding Eithers, returning early, conditional branches. ~200-400 words.>

## Anti-patterns

<2-4 anti-pattern entries. Each shows the WRONG plain-JS-or-naive-TS code first, then the Effect alternative. Pull text from the patterns catalog's "Anti-pattern it replaces" field where applicable. ~200-400 words.>

\`\`\`ts
// ❌ Anti-pattern
\`\`\`

\`\`\`ts
// ✅ Effect alternative
\`\`\`

## See also

<5-10 cross-references to other chapters and patterns. Format: bulleted list with one-line annotation for each.>

- [Chapter NN — Title](../part-X-name/NN-slug.md) — why this is the natural next read
- [Patterns Catalog: Pattern Name](../../research/02-patterns-catalog.md#anchor) — formal pattern entry with full schema
- [Per-package note: package.md](../../research/packages/<name>.md) — where this pattern lives in the ecosystem
```

**Hard constraints on every chapter:**
- All code blocks are `ts`-tagged and include imports.
- Every behavioral claim about Effect cites a `repos/effect/packages/effect/src/<file>.ts:<line>-<line>` file:line range.
- "Patterns introduced" header line links to real anchors in `research/02-patterns-catalog.md`.
- "See also" section has at least 5 entries.
- File ends with the "See also" section.
- No invented APIs. If unsure about behavior, read the cited source. If still unsure, mark it as `> _Note: this is my interpretation; the source is silent on X._`

---

## Task 1: Create Part I directory and the Chapter Shape reference

**Files:**
- Create: `book/part-1-foundations/_chapter-shape.md`
- Create: `book/part-1-foundations/.gitkeep` (so the directory ships even if Tasks 2-19 are skipped)

- [ ] **Step 1: Create the directory**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
mkdir -p book/part-1-foundations
touch book/part-1-foundations/.gitkeep
```

- [ ] **Step 2: Write the Chapter Shape reference**

Write to `book/part-1-foundations/_chapter-shape.md`:

```markdown
# Chapter Shape (Part I — Foundations)

> Every chapter in Part I follows this template verbatim. Section headers are fixed; section bodies are tailored to the chapter's pattern.

## Header block

```
# Chapter NN — <Title from book/00-toc.md>

> **Patterns introduced:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Chapters NN-1, NN-2 (if any prerequisites)
> **Reads into:** Chapters NN+M (forward references where helpful)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)
```

## Sections (in order)

1. **The problem (what JS/TS lacks)** — 250-400 words. Set up the pain that the pattern removes. Plain TS code to show the pain. No mention of Effect.
2. **The minimal example** — 10-30 lines of TS with imports. The smallest example using the pattern.
3. **How it works** — 600-1000 words. Mechanics. Cite `repos/effect/packages/effect/src/<file>.ts:<line-range>` for every behavioral claim.
4. **A production example** — 30-80 lines of TS, ideally pulled from real Effect source. Show composition with at least one earlier-chapter pattern.
5. **Variations** — 3-6 variants of the pattern, one-line example each.
6. **Anti-patterns** — 2-4 entries. Show wrong code, then the Effect alternative.
7. **See also** — 5+ cross-references to chapters, patterns catalog, per-package notes.

## Hard constraints

- All code blocks tagged `ts` and include imports.
- Every behavioral claim cites `repos/effect/packages/effect/src/<file>.ts:<line>-<line>`.
- Header `Patterns introduced:` line links to real anchors in `research/02-patterns-catalog.md`.
- File ends with the "See also" section.
- No invented APIs. If unsure, read source; if still unsure, mark as a quoted note about uncertainty.

## Word target

1500-3000 words per chapter. Smaller is fine if the pattern is small; bigger only if the pattern genuinely needs it.
```

- [ ] **Step 3: Commit**

```bash
git add book/part-1-foundations/_chapter-shape.md book/part-1-foundations/.gitkeep
git commit -m "Scaffold Part I directory and chapter shape reference"
```

---

## Per-chapter task structure (Tasks 2–19)

Tasks 2 through 19 follow this identical 5-step structure. Only the parameters change. Each task block below contains the parameters; the steps are reproduced inside each task block so engineers reading out of order have everything.

For each chapter task:

- [ ] **Step 1: Read context**

Read these files in this order:
1. `book/part-1-foundations/_chapter-shape.md` (the template)
2. `book/00-toc.md` (the chapter's row, especially the "Patterns introduced" links)
3. Each linked pattern in `research/02-patterns-catalog.md` (read in full — Signature, Where it appears, When to use, Anti-pattern, Related)
4. The previous chapter (`book/part-1-foundations/<NN-1>-<slug>.md`) if it exists, to confirm cross-references and avoid repeating
5. The relevant per-package note (`research/packages/effect.md` for most Part I chapters; for chapters that involve Stream, also `research/packages/effect.md` Stream section)
6. `research/03-conventions.md` if the chapter touches conventions (Chapter 04 dual API; Chapter 11 constructors; etc.)

- [ ] **Step 2: Open the source files cited in the patterns**

For every `repos/...:line-range` citation in the patterns being introduced, open the file at those lines and read 30 lines of context. Confirm the signature, the surrounding code, and what the function ACTUALLY does. Do not write the chapter from the patterns catalog summary alone — the catalog points at source; the chapter must be grounded in source.

- [ ] **Step 3: Write the chapter file**

Write the chapter to its target path following the Chapter Shape exactly. Constraints:
- Use the chapter's specific title, slug, patterns, size target (given in each task block below)
- Every behavioral claim cites a `repos/effect/packages/effect/src/<file>.ts:<line>-<line>` file:line range
- All code blocks tagged ` ```ts ` and include imports (`import { X } from "effect"`)
- "See also" section has 5+ entries linking to other chapters, patterns catalog entries, or per-package notes
- File ends with "See also"

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

# Required sections
required_sections = [
    'The problem',
    'The minimal example',
    'How it works',
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
if 'repos/effect/' not in text:
    issues.append('No repos/effect/ citation found')

# At least one ../../research/02-patterns-catalog.md link
if '../../research/02-patterns-catalog.md#' not in text:
    issues.append('No patterns-catalog cross-reference')

# See also has at least 5 list items
see_also_match = re.search(r'^## See also\n(.*)$', text, re.M | re.S)
if see_also_match:
    see_also_body = see_also_match.group(1)
    bullet_count = len(re.findall(r'^- ', see_also_body, re.M))
    if bullet_count < 5:
        issues.append(f'See also has only {bullet_count} entries (need 5+)')

# Word count (rough)
word_count = len(re.findall(r'\b\w+\b', text))
if word_count < 1000:
    issues.append(f'Word count too low: {word_count} (target 1500-3000)')
if word_count > 4500:
    issues.append(f'Word count too high: {word_count} (target 1500-3000)')

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

## Task 2: Chapter 01 — Why Effect

**Parameters:**
- File: `book/part-1-foundations/01-why-effect.md`
- Title (from TOC): "Why Effect — the problem with Promise, throw, and async"
- Slug: `01-why-effect`
- Patterns introduced: [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors)
- Reads from: nothing (this is the opener)
- Reads into: every subsequent chapter
- Word target: 2000-3000 words (this chapter sets up the entire book; it gets a bit more space)
- Special note: this is the only Part I chapter that's allowed to not show a `repos/` citation in EVERY paragraph — its job is to motivate Effect by showing JS/TS pain. But it must still cite `repos/` at least once when introducing the pattern.

**Steps:** Follow the per-chapter task structure above (Steps 1–5).

---

## Task 3: Chapter 02 — Effect as a value

**Parameters:**
- File: `book/part-1-foundations/02-effect-as-a-value.md`
- Title: "Effect as a value — `Effect<A, E, R>` and the three type parameters"
- Slug: `02-effect-as-a-value`
- Patterns introduced: [`Effect.succeed` / `fail` / `sync` / `promise` / `tryPromise`](../../research/02-patterns-catalog.md#effectsucceed--fail--sync--promise--trypromise)
- Reads from: Chapter 01
- Reads into: 03 (running), 06 (errors), 08 (R parameter)
- Word target: 1500-2500 words
- Special note: this chapter explains the three type parameters of `Effect<A, E, R>`. The reader should leave knowing what each slot means and why a value-of-a-computation is different from `Promise<A>`. Cite `repos/effect/packages/effect/src/Effect.ts` constructors.

**Steps:** Follow the per-chapter task structure above.

---

## Task 4: Chapter 03 — Running Effects

**Parameters:**
- File: `book/part-1-foundations/03-running-effects.md`
- Title: "Running Effects — `runPromise`, `runSync`, `runFork`, `runCallback`"
- Slug: `03-running-effects`
- Patterns introduced: [`Effect.runPromise` / `runSync` / `runFork`](../../research/02-patterns-catalog.md#effectrunpromise--runsync--runfork)
- Reads from: 01, 02
- Reads into: 06 (errors at runtime), 17 (forking)
- Word target: 1500-2500 words
- Special note: emphasize the "run* at the edge, not in business logic" anti-pattern. Cite `repos/effect/packages/effect/src/Runtime.ts` and `repos/effect/packages/effect/src/Effect.ts` run helpers.

**Steps:** Follow the per-chapter task structure above.

---

## Task 5: Chapter 04 — The pipe function and the dual API style

**Parameters:**
- File: `book/part-1-foundations/04-pipe-and-dual-api.md`
- Title: "The `pipe` function and the dual API style"
- Slug: `04-pipe-and-dual-api`
- Patterns introduced: [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait), [`pipe` vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining)
- Reads from: 02, 03
- Reads into: every subsequent chapter (this is the Effect API style every later chapter uses)
- Word target: 1500-2500 words
- Special note: Cite `repos/effect/packages/effect/src/Function.ts` for `dual` and `pipe`, `repos/effect/packages/effect/src/Pipeable.ts` for the trait. Show the same operation written both ways and explain when each shape is preferable.

**Steps:** Follow the per-chapter task structure above.

---

## Task 6: Chapter 05 — Effect.gen and generator-based composition

**Parameters:**
- File: `book/part-1-foundations/05-effect-gen.md`
- Title: "`Effect.gen` and generator-based composition"
- Slug: `05-effect-gen`
- Patterns introduced: [`Effect.gen` + `yield*`](../../research/02-patterns-catalog.md#effectgen--yield), [`Effect.fn` (named effect functions with auto-tracing)](../../research/02-patterns-catalog.md#effectfn-named-effect-functions-with-auto-tracing), [`Effect.all` / `Effect.repeat` / `Effect.retry` — combinators](../../research/02-patterns-catalog.md#effectall--effectrepeat--effectretry--combinators)
- Reads from: 02, 03, 04
- Reads into: every subsequent chapter (this is the primary composition style)
- Word target: 2000-3000 words (three patterns + extensive examples)
- Special note: this is one of the longest Part I chapters because `Effect.gen` is THE composition primitive. Show conditional branches, early returns, error short-circuiting via `yield*`. Cite `repos/effect/packages/effect/src/Effect.ts` for `gen`, `fn`, `all`, `repeat`, `retry`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 7: Chapter 06 — Typed errors

**Parameters:**
- File: `book/part-1-foundations/06-typed-errors.md`
- Title: "Typed errors — `Data.TaggedError` and the error channel"
- Slug: `06-typed-errors`
- Patterns introduced: [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror), [`Effect.catchTag` / `catchTags` / `sandbox` — error handling](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
- Reads from: 02 (the E parameter), 05 (gen)
- Reads into: 07 (Cause), 12 (Option/Either), 18 (Data)
- Word target: 1800-2800 words
- Special note: this chapter sets up the typed-error story. Show how `_tag`-discriminated errors compose. Cite `repos/effect/packages/effect/src/Data.ts` for `TaggedError` and `repos/effect/packages/effect/src/Effect.ts` for `catchTag`/`catchTags`/`sandbox`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 8: Chapter 07 — The Cause model

**Parameters:**
- File: `book/part-1-foundations/07-cause-model.md`
- Title: "The `Cause` model — Fail, Die, Interrupt, and their composition"
- Slug: `07-cause-model`
- Patterns introduced: [`Cause` — `fail` / `die` / `interrupt` variants](../../research/02-patterns-catalog.md#cause--fail--die--interrupt-variants), [Exit — Effect outcome value (Success / Failure of Cause)](../../research/02-patterns-catalog.md#exit--effect-outcome-value-success--failure-of-cause)
- Reads from: 06
- Reads into: 17 (interruption); referenced throughout Part II
- Word target: 1500-2500 words
- Special note: explain why `Cause` is richer than a simple `Error`. The Sequential/Parallel composition matters because Effect can run things concurrently. Cite `repos/effect/packages/effect/src/Cause.ts` and `repos/effect/packages/effect/src/Exit.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 9: Chapter 08 — Context and Tags

**Parameters:**
- File: `book/part-1-foundations/08-context-and-tags.md`
- Title: "Context, Tags, and the R type parameter"
- Slug: `08-context-and-tags`
- Patterns introduced: [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants), [`Effect.Service` class](../../research/02-patterns-catalog.md#effectservice-class)
- Reads from: 02 (R parameter), 05 (gen)
- Reads into: 09 (Layer), 10 (scoped layers), every Part II chapter
- Word target: 2000-3000 words
- Special note: This is the chapter where the reader meets dependency injection. Show all three Tag styles and explain when to use each. Note `Effect.Service` is `@experimental` — hedge appropriately. Cite `repos/effect/packages/effect/src/Context.ts` and `repos/effect/packages/effect/src/Effect.ts` for `Service`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 10: Chapter 09 — Layer

**Parameters:**
- File: `book/part-1-foundations/09-layer.md`
- Title: "Layer — building, merging, and providing services"
- Slug: `09-layer`
- Patterns introduced: [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors), [`Layer.merge` / `provide` / `fresh` — Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition)
- Reads from: 08 (Tags)
- Reads into: 10 (scoped resources), every Part II + Part III chapter
- Word target: 2000-3000 words
- Special note: this chapter is the heart of Effect's dependency injection story. Show building a service from primitives, merging multiple layers, providing a layer to satisfy R. Cite `repos/effect/packages/effect/src/Layer.ts` exhaustively.

**Steps:** Follow the per-chapter task structure above.

---

## Task 11: Chapter 10 — Layer.scoped and Scope

**Parameters:**
- File: `book/part-1-foundations/10-layer-scoped-and-scope.md`
- Title: "`Layer.scoped` and Scope — resource lifecycles"
- Slug: `10-layer-scoped-and-scope`
- Patterns introduced: [`Layer.scoped` (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers), [`Effect.acquireRelease` / `acquireUseRelease`](../../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease), [`Scope.make` / `Scope.fork` / `Scope.close`](../../research/02-patterns-catalog.md#scopemake--scopefork--scopeclose)
- Reads from: 09 (Layer), 05 (gen)
- Reads into: 17 (forking + scope), Part III (worked-example uses Layer.scoped for eviction fiber)
- Word target: 1800-2800 words
- Special note: scope is the resource-lifetime primitive. Show the bracket pattern (`acquireRelease`), the scoped layer pattern, and how forking inside a scope ties resource lifetimes to the scope. Cite `repos/effect/packages/effect/src/Scope.ts` and `repos/effect/packages/effect/src/Effect.ts` for `acquireRelease`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 12: Chapter 11 — Constructors

**Parameters:**
- File: `book/part-1-foundations/11-constructors.md`
- Title: "Constructors — `.make`, `.of`, `.from*` and the naming conventions"
- Slug: `11-constructors`
- Patterns introduced: [`.from*` family](../../research/02-patterns-catalog.md#from-family), [`ManagedRuntime.make`](../../research/02-patterns-catalog.md#managedruntimemake)
- Reads from: 02 (succeed/fail/sync), 09 (Layer constructors)
- Reads into: Part III (the worked example heavily uses these conventions)
- Word target: 1500-2500 words
- Special note: catalog ALL the constructor naming conventions in Effect. `.make`, `.of`, `.from*` is one family — but also `.makeWith`, `.fromIterable`, `.fromAsyncIterable`, etc. Explain the naming logic. Cross-reference the conventions doc. Cite a wide sample of `repos/effect/packages/effect/src/` files.

**Steps:** Follow the per-chapter task structure above.

---

## Task 13: Chapter 12 — Option and Either

**Parameters:**
- File: `book/part-1-foundations/12-option-and-either.md`
- Title: "Option and Either — null-safety and result types without exceptions"
- Slug: `12-option-and-either`
- Patterns introduced: [Option — Some / None and combinators](../../research/02-patterns-catalog.md#option--some--none-and-combinators), [Either — Left / Right and combinators](../../research/02-patterns-catalog.md#either--left--right-and-combinators), [Bridging Option/Either ↔ Effect (yield*, option, either)](../../research/02-patterns-catalog.md#bridging-optioneither--effect-yield-option-either)
- Reads from: 05 (gen), 06 (errors)
- Reads into: 13 (Brand), 14 (Schema)
- Word target: 1800-2800 words
- Special note: critical chapter to dispel the "Effect.fromOption doesn't exist" confusion. Option and Either implement `EffectPrototype` so they're directly `yield*`-able in `Effect.gen` — show this with examples. Cite `repos/effect/packages/effect/src/Option.ts` and `repos/effect/packages/effect/src/Either.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 14: Chapter 13 — Branded types

**Parameters:**
- File: `book/part-1-foundations/13-branded-types.md`
- Title: "Branded types — nominal typing with `Brand`"
- Slug: `13-branded-types`
- Patterns introduced: [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all)
- Reads from: 12 (Option/Either for refinements)
- Reads into: 14, 15 (Schema brand integration), Part III (CacheKey)
- Word target: 1300-2200 words
- Special note: Brand is small but important — explain the structural-vs-nominal divide and why Effect uses brands. Show `nominal`, `refined`, and `all` (the brand combiner). Cite `repos/effect/packages/effect/src/Brand.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 15: Chapter 14 — Schema part 1

**Parameters:**
- File: `book/part-1-foundations/14-schema-part-1.md`
- Title: "Schema part 1 — declaring shapes with `Struct`, `Class`, and `TaggedClass`"
- Slug: `14-schema-part-1`
- Patterns introduced: [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct), [`Schema.Class` and `Schema.TaggedClass`](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass), [`Schema.decode` / `encode` / `is` entry points](../../research/02-patterns-catalog.md#schemadecode--encode--is-entry-points)
- Reads from: 06 (typed errors — schema produces ParseError), 13 (brands integrate with schema)
- Reads into: 15 (Schema part 2), Part II (every package uses Schema)
- Word target: 2000-3000 words
- Special note: this chapter introduces Schema as a separate first-class system. Note that Schema migrated from `@effect/schema` to core `effect` in v3.10.0. Show the difference between `Schema.Struct` (data) and `Schema.Class` / `TaggedClass` (data + identity). Cite `repos/effect/packages/effect/src/Schema.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 16: Chapter 15 — Schema part 2

**Parameters:**
- File: `book/part-1-foundations/15-schema-part-2.md`
- Title: "Schema part 2 — transforms, refinements, and brand integration"
- Slug: `15-schema-part-2`
- Patterns introduced: [`Schema.transform` / `transformOrFail`](../../research/02-patterns-catalog.md#schematransform--transformorfail), [`Schema.brand` / `filter` — constraints](../../research/02-patterns-catalog.md#schemabrand--filter--constraints)
- Reads from: 14 (Schema part 1), 13 (Brand)
- Reads into: Part II (Schema is core to platform/cli/sql/rpc)
- Word target: 1800-2800 words
- Special note: `transformOrFail` callback signature is critical — uses `ParseResult.ParseIssue` (not `ParseError`) and takes 4 positional parameters. The catalog has the corrected signature; mirror it here. Cite `repos/effect/packages/effect/src/Schema.ts:3831-3896`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 17: Chapter 16 — Stream

**Parameters:**
- File: `book/part-1-foundations/16-stream.md`
- Title: "Stream — pull-based async iteration"
- Slug: `16-stream`
- Patterns introduced: [`Stream.make` / `fromIterable` / `fromEffect`](../../research/02-patterns-catalog.md#streammake--fromiterable--fromeffect), [`Stream.async*` family (`asyncPush`, `fromAsyncIterable`)](../../research/02-patterns-catalog.md#streamasync-family-asyncpush-fromasynciterable), [`Stream.paginate`](../../research/02-patterns-catalog.md#streampaginate)
- Reads from: 05 (gen), 09 (Layer for resource-bound streams)
- Reads into: 17 (forking streams), Part II ch. 41 (Stream deep-dive)
- Word target: 2000-3000 words
- Special note: Stream is huge; this chapter only covers the basics (creating streams, consuming with `runCollect`/`runForEach`). Channel and Sink are deferred to Part II ch. 41. Cite `repos/effect/packages/effect/src/Stream.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 18: Chapter 17 — Fibers and structured concurrency

**Parameters:**
- File: `book/part-1-foundations/17-fibers-and-concurrency.md`
- Title: "Fibers and structured concurrency"
- Slug: `17-fibers-and-concurrency`
- Patterns introduced: [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin), [Fiber — joining, interrupting, racing (Effect.fork return type)](../../research/02-patterns-catalog.md#fiber--joining-interrupting-racing-effectfork-return-type), [Structured concurrency via `Scope`](../../research/02-patterns-catalog.md#structured-concurrency-via-scope)
- Reads from: 07 (Cause for interruption), 10 (Scope)
- Reads into: Part II ch. 36, 37 (advanced concurrency)
- Word target: 2000-3000 words
- Special note: explain the four fork variants and what scope each is bound to. Show join / interrupt / race / `Fiber.all`. Tie back to chapter 10's Scope discussion. Cite `repos/effect/packages/effect/src/Effect.ts` for fork variants and `repos/effect/packages/effect/src/Fiber.ts` for joining/interrupting.

**Steps:** Follow the per-chapter task structure above.

---

## Task 19: Chapter 18 — Data, Equal, Hash

**Parameters:**
- File: `book/part-1-foundations/18-data-equal-hash.md`
- Title: "Data, Equal, Hash — structural equality, case classes, and collections"
- Slug: `18-data-equal-hash`
- Patterns introduced: [`Data.struct` / `tuple` / `array` / `Class` / `TaggedClass`](../../research/02-patterns-catalog.md#datastruct--tuple--array--class--taggedclass), [`Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors), [`Equal.equals` interface and `Hash` — structural equality](../../research/02-patterns-catalog.md#equalequals-interface-and-hash--structural-equality)
- Reads from: 06 (TaggedError is also Data-based)
- Reads into: Part II ch. 40 (immutable collections — they use Equal/Hash)
- Word target: 1800-2800 words
- Special note: `Data.TaggedEnum` (PascalCase, type-level) vs `Data.taggedEnum` (camelCase, runtime constructor) is a critical distinction — show both forms. Cite `repos/effect/packages/effect/src/Data.ts`, `repos/effect/packages/effect/src/Equal.ts`, `repos/effect/packages/effect/src/Hash.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Self-Review

Coverage check against `book/00-toc.md`:

- ✅ Tasks 2–19 cover chapters 01–18 in order; Part I has 18 chapters total.
- ✅ Every Part I chapter row in the TOC has a matching task.
- ✅ Every "Patterns introduced" link in the TOC is forwarded to the task parameters.
- ✅ Cross-references between chapters are explicit in each task's "Reads from" / "Reads into".
- ✅ Pinned SHA `39c934c1...` referenced consistently.
- ✅ Out-of-scope (Part II/III) clearly deferred.
- ✅ Setup task (Task 1) creates the directory + Chapter Shape reference before any chapter task.

Type/name consistency:
- File paths consistent: `book/part-1-foundations/<NN>-<slug>.md` everywhere.
- Slugs match the TOC exactly (`01-why-effect`, `02-effect-as-a-value`, etc.).
- Pattern catalog anchor links match what was tested by the corrected verifier in the Phase 1–4 plan.

No placeholders: every task has its specific title, slug, patterns list, size target, and special note. The per-chapter steps reference a verifier that uses the chapter's specific path; the engineer substitutes `<TASK-SPECIFIC PATH>` with the path given at the top of the task block.

Pacing recommendation (for execution): write chapters strictly in numerical order. Chapter N+1 frequently cross-references Chapter N's content; if Chapter N hasn't been committed yet, the cross-reference link will be broken. Two-stage review per chapter is fast given the file is one self-contained markdown document.

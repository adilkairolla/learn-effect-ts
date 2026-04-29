# Effect TS Book — Phase 5 Part III (Authoring + Worked Example) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write all 16 Authoring chapters of the Effect TS Book — chapters 45 through 60 — landing them in `book/part-3-authoring/` with a Walkthrough-shaped chapter template, AND build the corresponding worked example `@example/effect-cache` (a TTL cache with pluggable storage layers) inside a fresh sibling git repo at `worked-example/`. Each chapter maps to **exactly one commit** in `worked-example/`, so the reader can `git log` through the teaching history alongside the prose.

**Architecture:** One task per chapter. Each chapter task produces **two outputs** in two distinct git repos:

1. The chapter prose at `book/part-3-authoring/<NN>-<slug>.md` (committed in the book repo)
2. The "What gets committed" code change applied inside `worked-example/<files>` (committed in the worked-example repo)

`worked-example/` is its own git repo (initialized in Task 1 via `git init` inside `worked-example/`), NOT a submodule of the book repo. The book repo's root `.gitignore` excludes `worked-example/` so the two histories stay independent. Subagent-driven execution: one implementer subagent per chapter, two-stage review (spec compliance + code/editorial quality), then commit to BOTH repos.

**Tech Stack:** Markdown chapters with TypeScript code blocks. The worked example is a real Effect package — TypeScript with `tsc` compilation, `pnpm` workspace conventions matching `repos/effect/`, vitest for tests, changesets for release management. Citations are file paths into `repos/` (pinned at `effect@3.21.2`, SHA `39c934c1476be389f7469433910fdf30fc4dad82`) AND into `worked-example/` (paths only — no SHA references because the worked-example history is built up by these same chapters).

**Out of scope for this plan:** None. Part III is the last phase. After Part III executes, the book is complete (all 60 chapters + worked example).

**Reader assumption:** Part III chapters assume the reader has finished Parts I AND II. When a Part I or Part II pattern is demonstrated in the worked example, **reference back** rather than re-explaining mechanics. Use forward-reference links of the form `[Chapter NN — Title](../part-1-foundations/NN-slug.md)` or `[Chapter NN — Title](../part-2-tour/NN-slug.md)`.

**Worked-example git repo specifics:**

- The repo lives at `<root>/worked-example/` (sibling to `book/`, `docs/`, `repos/`, `research/`).
- It is initialized once in Task 1: `cd worked-example && git init -b main`.
- The book repo's `.gitignore` (at `<root>/.gitignore`) lists `worked-example/` so the parent repo never tracks it.
- The worked-example repo has its OWN `.gitignore` (committed in Ch 46) for `node_modules/`, `dist/`, `.tsbuildinfo`, `*.log`.
- Each Part III chapter task makes **one commit** in the worked-example repo (except Ch 60 — retrospective, no code commit).
- Commit messages in worked-example follow conventional-commits style: `feat: <thing>`, `chore: <thing>`, `docs: <thing>`, `test: <thing>`. The chapter's "Commit" section in prose shows the exact commit message.
- The chapter prose references the worked-example state by relative path (`worked-example/src/Cache.ts`), NOT by SHA. The reader is expected to `git checkout` chapter-tagged commits in `worked-example/` if they want to follow along. Tagging is optional but recommended; if implemented, tag format is `chapter-NN`.

**Carry-forward lessons from Part I + Part II review loops** — every Part III chapter must comply, AND the worked-example code must demonstrate them correctly:

**Citation discipline:**
- Cite real export lines AND include the JSDoc range — start cited range at the JSDoc opening (`/**` line), not the export signature line. The #1 review issue across both Parts.
- For module-overview citations, line 1 of the file is acceptable. For specific-export claims, point at the export's own JSDoc.
- For pure functions cited in JSDoc, distinguish JSDoc-example lines from real export lines.
- Worked-example code citations: paths only (e.g., `worked-example/src/Cache.ts:12-30`); the file is in this repo, so line numbers are stable across the chapter.

**API correctness — these do NOT exist (do not use them in worked-example code):**
- `Effect.fromOption` / `Effect.fromEither` / `Effect.getOrFail` — Option/Either implement `EffectPrototype`; idiom is `yield* opt` directly in `Effect.gen`.
- `STM.atomically` — it's `STM.commit`.
- `Schema.ParseResult` — import `ParseResult` separately from `"effect"`.
- `Rpc.annotate` at module level — instance method only.
- `Ansi.annotate` — use `Doc.annotate` (Ansi is the annotation type).
- `Prompt.number` — use `Prompt.integer` / `Prompt.float`.
- `HttpClientRequest.uint8ArrayBody` — it's `bodyUint8Array` (`body*` prefix convention).
- `Metric.linearBoundaries` — it's `MetricBoundaries.linear` (separate import).
- `Schedule.upTo` as standalone — use `Schedule.recurs(5).pipe(Schedule.upTo("30 seconds"))`.
- Module-level `Semaphore` value — `Semaphore` is a type; create via `Effect.makeSemaphore(n)`.

**Type accuracy:**
- `Schema.transformOrFail` callback returns `Effect<A, ParseResult.ParseIssue, R>`, NOT `ParseError`. Callbacks take 4 positional params: `(input, options: ParseOptions, ast: AST.Transformation, encodedSelf)`.
- `Schema.decodeUnknownEither` returns `Either<A, ParseIssue>` (not `ParseError`).
- `Effect.runSync` throws `FiberFailure` wrapping `AsyncFiberException`, not bare `AsyncFiberException`.
- `Cause.isInterruptedOnly` does NOT match `Effect.timeout` failures — timeout produces `Cause.Fail(TimeoutException)`.
- `Either<A, E>` is right-first / success-first.
- `Layer<ROut, E, RIn>` — `ROut` is `in` (contravariant), `E` and `RIn` are `out` (covariant).
- `Doc.fill` is data-first: `fill(self, w)` or `doc.pipe(Doc.fill(w))`.
- `Match.tag` reads `_tag` only; for non-`_tag` discriminants use `Match.discriminator("field")`.
- `Effect.supervised` wraps `Effect`, NOT `Stream`.
- Schema migrated from `@effect/schema` to core `effect` in v3.10.0 — import from `"effect"`.
- `Data.TaggedEnum` (PascalCase, type) vs `Data.taggedEnum` (camelCase, runtime constructor) — both exist, distinct.
- `Data.Error` / `Data.TaggedError` extend ES `Error` via `core.YieldableError`; no `Equal`/`Hash` via Structural.
- `Effect.Service` is `@experimental` — hedge accordingly when used.

**Worked-example specific demands (the cache must be CORRECT Effect code):**
- Use `Schema.Class` for `CacheConfig`, `Schema.Struct` for nested shapes.
- Use `Brand.nominal` for `CacheKey` (Ch 50).
- Use `Data.TaggedError` for every error variant, with the `_tag` field auto-set by the constructor.
- Use `Layer.succeed` for the in-memory storage layer (Ch 51) and `Layer.scoped` for the eviction-fiber layer (Ch 52). Eviction fiber must be forked into the scope via `Effect.forkScoped` so it interrupts on layer release.
- Use `Ref.make` for the in-memory map. (Or `SynchronizedRef.make` if there is genuine read-modify-write contention — explain the choice in Ch 51.)
- Use `dual(...)` from `effect/Function` for `get`/`set`/`delete`/`invalidate` (Ch 53). The data-first arity must match the data-last after-pipe arity.
- Use `PubSub.unbounded` (or `bounded`) and `Stream.fromPubSub` for the events stream (Ch 55).
- Use `Data.TaggedEnum` for `CacheEvent` variants (Hit / Miss / Set / Evict).
- Use `Redacted` for any secret-string config field if introduced.
- Use `JSDoc` `@since` / `@category` / `@example` tags on every public export (Ch 57).
- Test via `it.effect` (effects only) and `it.scoped` (scope-required, e.g., the eviction layer) from `@effect/vitest` (Ch 56).
- `package.json` exports map: dual ESM/CJS via the canonical Effect monorepo pattern (Ch 58); model after `repos/effect/packages/effect/package.json`.
- Changesets (`.changeset/config.json`) modeled after `repos/effect/.changeset/config.json` (Ch 59).

**Pattern discipline:**
- Every claim about an Effect API must cite a `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` range, JSDoc-inclusive.
- No invented APIs. If unsure, read source; if still unsure, mark uncertainty as `> _Note: ..._`.
- Don't drop Effects in code examples — every `Effect.log` / `Console.log` / `Random.next` must be yielded or piped.
- Forward references must always name a chapter number AND topic; every named forward chapter appears in See also.
- See also entries are markdown links `[text](path)`, not bare prose.

---

## File Structure

Two output trees, two git repos:

```
<root>/                                                # the BOOK git repo
├── .gitignore                                         # MUST include worked-example/
├── book/
│   └── part-3-authoring/
│       ├── _chapter-shape.md                          # Walkthrough Chapter Shape (Task 1)
│       ├── 45-overview.md                             # Task 2
│       ├── 46-build-setup.md                          # Task 3
│       ├── 47-public-api.md                           # Task 4
│       ├── 48-error-channel.md                        # Task 5
│       ├── 49-schema-config.md                        # Task 6
│       ├── 50-branded-keys.md                         # Task 7
│       ├── 51-layer-memory.md                         # Task 8
│       ├── 52-layer-scoped-eviction.md                # Task 9
│       ├── 53-dual-api.md                             # Task 10
│       ├── 54-internal-modules.md                     # Task 11
│       ├── 55-cache-events-stream.md                  # Task 12
│       ├── 56-testing.md                              # Task 13
│       ├── 57-jsdoc.md                                # Task 14
│       ├── 58-versioning-and-exports.md               # Task 15
│       ├── 59-publishing.md                           # Task 16
│       └── 60-retrospective.md                        # Task 17
└── worked-example/                                    # the WORKED-EXAMPLE git repo (sibling, gitignored from book repo)
    └── (effect-cache package, populated by Task 1 init + commits in Tasks 2–17)
```

Each chapter file is one focused unit (~1500-3000 words, ~250-450 lines of markdown). Files are independent in the book repo. Inside `worked-example/`, files build cumulatively across chapters (each chapter's commit is a delta on the previous).

---

## Walkthrough Chapter Shape (Part III)

Part III chapters are **narrated commit walkthroughs**, not API tours. The reader is meant to read the chapter alongside `git diff` of the corresponding commit in `worked-example/`. The shape differs from Part I ("How it works") and Part II ("Tour"):

```markdown
# Chapter NN — <Title from book/00-toc.md>

> **Worked-example commit:** `worked-example/` chapter NN — see commit message below
> **Patterns demonstrated:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Part I chapters NN, NN; Part II chapters NN, NN; Part III chapters NN-1, NN-2
> **Reads into:** Chapter NN+M (where this design decision matters later)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

## The goal of this chapter

<1-2 paragraphs, ~150-300 words. What we aim to add to `effect-cache` and why it belongs HERE in the chapter sequence. What design tension does this chapter resolve?>

## What we already have

<1-2 paragraphs + optional `tree`-style listing of `worked-example/` after the previous chapter's commit. Recap the prior state so the reader can dip in mid-book. ~100-250 words. Skip for Ch 45 (start of repo).>

## What we're adding

<1-2 paragraphs naming the files we'll create or modify in this chapter's commit. Maps directly to the TOC's "What gets committed" column. ~100-200 words.>

## The code

<The actual code being committed, broken across the files we touch. For each file:
- File header: `**`worked-example/<path>`** (new)` or `**`worked-example/<path>`** (modified)`
- The full file (or the diff in code blocks) — `ts` tagged, with imports
- Every Effect API used in the code is cited at `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive) at first appearance
- For files that already existed, only show the changed regions but be explicit which lines

500-1000 words of prose interleaved between blocks, explaining what each section does and which pattern it demonstrates. Inline links to Part I/II chapters where the pattern was introduced.>

## Why this design choice

<1-2 paragraphs, ~200-400 words. Justify the decision against alternatives. Where in `repos/effect/` does the same pattern appear? Why pick `Layer.succeed` over `Layer.effect`? Why `Brand.nominal` over a plain type alias? This is where authoring judgement gets transferred. Cite at least one comparable example in `repos/effect/`.>

## What's still missing

<Bulleted list of things this chapter intentionally leaves for later, with forward references to the chapter numbers that fix them. ~100-200 words. Forces the reader to see the cumulative arc.>

## Commit

The change in this chapter is committed inside `worked-example/`:

```bash
cd worked-example
git add <files>
git commit -m "<conventional-commit message>"
```

Tag (optional): `git tag chapter-NN`

## See also

<5+ cross-references. Format: bulleted markdown list with one-line annotation each.>

- [Chapter NN — Title](../part-1-foundations/NN-slug.md) — the Part I pattern this chapter applies
- [Chapter NN — Title](../part-2-tour/NN-slug.md) — the Part II package whose API the worked-example mimics
- [Chapter NN — Title](NN-slug.md) — adjacent Part III chapter (next or previous)
- [Patterns Catalog: Pattern Name](../../research/02-patterns-catalog.md#anchor) — formal pattern entry
- [Per-package note](../../research/packages/<name>.md) — research-level notes
```

**Hard constraints on every Part III chapter:**

- All code blocks are `ts`-tagged (or `bash` for shell, `json` for JSON, `jsonc` if comments) and include imports.
- Every claim about an Effect API cites `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive), at first appearance of the API in this chapter.
- Code in `worked-example/` cited by relative path with line range (`worked-example/src/Cache.ts:12-30`).
- "Patterns demonstrated" header line links to real anchors in `research/02-patterns-catalog.md`.
- "See also" section has at least 5 entries.
- File ends with the "See also" section.
- No invented APIs. Mark uncertainty as `> _Note: ..._`.
- Forward references name chapter number AND topic AND appear in See also.
- `@experimental` APIs explicitly hedged when used.
- Reader is assumed to have read Parts I and II — link back instead of re-deriving.
- Every chapter except Ch 45 has a "What we already have" recap section.
- Every chapter except Ch 60 produces a real commit in `worked-example/` matching the TOC's "What gets committed" column verbatim.

**Word target:** 1500-3000 words per chapter. Smaller is fine if the commit is small (Ch 46 build setup, Ch 50 branded keys); bigger only if the chapter genuinely needs it (Ch 56 testing, Ch 60 retrospective).

**Differences from Part I / Part II shape:**

| Section | Part I | Part II | Part III |
|---|---|---|---|
| 1 | The problem | The problem | The goal of this chapter |
| 2 | The minimal example | The minimal example | What we already have |
| 3 | How it works | Tour | What we're adding |
| 4 | A production example | A production example | The code |
| 5 | Variations | Variations | Why this design choice |
| 6 | Anti-patterns | Anti-patterns | What's still missing |
| 7 | See also | See also | Commit + See also |
| Reader | New to Effect | Has read Part I | Has read Parts I & II |
| Code source | `repos/effect/` | Package `examples/` | `worked-example/` (this chapter's commit) |

---

## Subagent two-repo commit protocol

**The subagent-driven workflow has one new wrinkle in Part III:** every implementer subagent commits to TWO git repos per task. Spec reviewer and quality reviewer must verify both repos' state before approval.

For each chapter task:

1. The implementer first applies code changes inside `worked-example/`, builds (`pnpm build` if applicable from Ch 46 onward), runs tests (`pnpm test` from Ch 56 onward), then commits inside `worked-example/`:
   ```bash
   cd worked-example
   git add <files>
   git commit -m "<conventional message>"
   ```
2. The implementer then writes the chapter prose at `book/part-3-authoring/<NN>-<slug>.md` (book repo working tree).
3. The implementer runs the chapter verifier (Step 4 below).
4. The implementer commits the chapter file in the book repo:
   ```bash
   git add book/part-3-authoring/<NN>-<slug>.md
   git commit -m "Write Chapter NN — <Title>"
   ```
   (NOT inside `worked-example/`. The book repo is the parent working directory.)

**Spec reviewer and quality reviewer subagents** must:
- Verify the worked-example commit by `cd worked-example && git log -1` and `git show HEAD` (or `git diff HEAD~1 HEAD`).
- Verify the chapter file via the standard verifier script (Step 4 below).
- Check that the chapter's "The code" section accurately reflects what was committed in `worked-example/` (file paths, code shown, what's elided).

**Fix subagents** must apply fixes to BOTH repos when applicable. If a fix is purely prose (chapter file only), commit only in the book repo. If a fix is purely code (worked-example only), commit only there. Many fixes will touch both — keep them as separate commits so each repo's history stays clean.

---

## Task 1: Scaffold Part III directory, initialize worked-example git repo, and write the Walkthrough Chapter Shape reference

**Files:**
- Create: `book/part-3-authoring/_chapter-shape.md`
- Create: `book/part-3-authoring/.gitkeep`
- Create: `worked-example/` directory (sibling of `book/`)
- Modify: `<root>/.gitignore` (add `worked-example/` line)
- Inside `worked-example/`: run `git init -b main` (this is a fresh, empty repo at this stage; Ch 45–60 commits populate it)

- [ ] **Step 1: Create the book directory and the Walkthrough Chapter Shape**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
mkdir -p book/part-3-authoring
touch book/part-3-authoring/.gitkeep
```

Write to `book/part-3-authoring/_chapter-shape.md`:

````markdown
# Walkthrough Chapter Shape (Part III — Authoring with Worked Example)

> Every chapter in Part III follows this template verbatim. Section headers are fixed; section bodies are tailored to the chapter's commit in `worked-example/`.

## Header block

```
# Chapter NN — <Title from book/00-toc.md>

> **Worked-example commit:** `worked-example/` chapter NN — see commit message below
> **Patterns demonstrated:** [Pattern A](../../research/02-patterns-catalog.md#anchor), [Pattern B](...)
> **Reads from:** Part I chapters NN, NN; Part II chapters NN, NN; Part III chapters NN-1, NN-2
> **Reads into:** Chapter NN+M (if applicable)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)
```

## Sections (in order)

1. **The goal of this chapter** — 150-300 words. What we aim to add to `effect-cache`, why it belongs here in the sequence, what design tension it resolves.
2. **What we already have** — 100-250 words. Recap of `worked-example/` after the previous chapter's commit (skip for Ch 45 — start of repo).
3. **What we're adding** — 100-200 words. Names the files we'll create or modify; maps directly to the TOC's "What gets committed" column.
4. **The code** — 500-1000 words. The actual code being committed, broken across files. Each file marked `(new)` or `(modified)`. Every Effect API used cited at `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive) at first appearance. Inline links to Part I/II chapters for each pattern.
5. **Why this design choice** — 200-400 words. Justify against alternatives. Cite a comparable example in `repos/effect/`.
6. **What's still missing** — 100-200 words. Bulleted list of intentional omissions with forward references to the chapter that fixes each.
7. **Commit** — Show the exact `cd worked-example && git add ... && git commit -m "..."` invocation.
8. **See also** — 5+ markdown-link entries.

## Hard constraints

- All code blocks are `ts`-tagged (or `bash`, `json`, `jsonc` where appropriate) and include imports.
- Every Effect-API claim cites `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive).
- Worked-example code cited by relative path: `worked-example/src/Cache.ts:12-30`.
- Header `Patterns demonstrated:` line links to real anchors in `research/02-patterns-catalog.md`.
- File ends with the "See also" section.
- No invented APIs. Mark uncertainty as `> _Note: ..._`.
- Forward references name chapter number AND topic AND appear in See also.
- `@experimental` APIs explicitly hedged when used.
- Reader is assumed to have read Parts I and II — link back instead of re-deriving.
- Every chapter except Ch 45 has a "What we already have" recap.
- Every chapter except Ch 60 produces a real commit in `worked-example/` matching the TOC's "What gets committed" column verbatim.

## Word target

1500-3000 words per chapter.

## Differences from Part I / Part II shape

| Section | Part I | Part II | Part III |
|---|---|---|---|
| 1 | The problem | The problem | The goal of this chapter |
| 2 | The minimal example | The minimal example | What we already have |
| 3 | How it works | Tour | What we're adding |
| 4 | A production example | A production example | The code |
| 5 | Variations | Variations | Why this design choice |
| 6 | Anti-patterns | Anti-patterns | What's still missing |
| 7 | See also | See also | Commit + See also |
| Reader | New to Effect | Has read Part I | Has read Parts I & II |
| Code source | `repos/effect/` | Package `examples/` | `worked-example/` (this chapter's commit) |

## Two-repo commit protocol

Every Part III chapter task makes commits in **two repos**:

1. `worked-example/` — the actual code change (run `cd worked-example && git commit ...`).
2. The book repo (parent working directory) — the chapter prose at `book/part-3-authoring/<NN>-<slug>.md`.

Always commit the worked-example change first, then write/verify/commit the prose. The chapter's "The code" section must accurately reflect what was committed in `worked-example/`.

Ch 60 (retrospective) is the only chapter without a code commit (the TOC says "no code changes" — only `DESIGN.md` updated, but that lives inside `worked-example/`, so Ch 60 still produces ONE worked-example commit, just a docs-only one).
````

- [ ] **Step 2: Add `worked-example/` to the book repo's .gitignore**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
# If .gitignore exists, append; otherwise create
if [ -f .gitignore ]; then
  grep -qxF 'worked-example/' .gitignore || echo 'worked-example/' >> .gitignore
else
  echo 'worked-example/' > .gitignore
fi
```

- [ ] **Step 3: Create the worked-example directory and initialize its git repo**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
mkdir -p worked-example
cd worked-example
git init -b main
git config user.name "$(cd .. && git config user.name)"
git config user.email "$(cd .. && git config user.email)"
```

This creates an empty repo with no commits. Ch 45 (Task 2) will produce the first commit (README.md + DESIGN.md).

- [ ] **Step 4: Verify the scaffold**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
test -f book/part-3-authoring/_chapter-shape.md || { echo 'FAIL: _chapter-shape.md missing'; exit 1; }
test -d worked-example/.git || { echo 'FAIL: worked-example/.git missing'; exit 1; }
grep -q 'worked-example/' .gitignore || { echo 'FAIL: .gitignore missing entry'; exit 1; }
echo OK
```

Expected: `OK`.

- [ ] **Step 5: Commit the book-repo scaffold**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
git add .gitignore book/part-3-authoring/.gitkeep book/part-3-authoring/_chapter-shape.md
git commit -m "Scaffold Part III directory, walkthrough chapter shape, and worked-example gitignore"
```

(No commit in `worked-example/` yet — it's an empty repo until Task 2.)

---

## Per-chapter task structure (Tasks 2–17)

Tasks 2 through 17 follow this identical 6-step structure. Only the parameters change. Each task block below contains the parameters; the steps are reproduced once here so engineers reading out of order have everything.

For each chapter task:

- [ ] **Step 1: Read context**

Read these files in this order:
1. `book/part-3-authoring/_chapter-shape.md` (the template)
2. `book/00-toc.md` (the chapter's row, especially the "What gets committed" column — copy verbatim)
3. Each linked pattern in `research/02-patterns-catalog.md` listed under "Patterns demonstrated" (read in full — Signature, Where it appears, When to use, Anti-pattern, Related)
4. The relevant Part I and Part II chapters listed under "Reads from" — to anchor cross-references and avoid re-deriving
5. The previous Part III chapter (`book/part-3-authoring/<NN-1>-<slug>.md`) if it exists, to confirm cross-references
6. The current state of `worked-example/`: `cd worked-example && git log --oneline && git ls-files`. This is "What we already have."

- [ ] **Step 2: Open the source files cited in the patterns**

For every `repos/...:line-range` citation in the patterns being demonstrated, open the file at those lines and read 30 lines of context. Confirm the signature, the surrounding code, and what the function ACTUALLY does. **Widen each cited range to start at the JSDoc opening (`/**` line), not the export signature line** — this was the #1 review issue in Parts I and II.

- [ ] **Step 3: Apply the code change inside `worked-example/` and commit there**

Working in `<root>/worked-example/`:

1. Create or modify the files listed in the chapter's "What gets committed" column (copy verbatim from the TOC row).
2. If the chapter is past Ch 46 (build setup), run `pnpm build` (or whatever the chapter introduced) to confirm compilation.
3. If the chapter is past Ch 56 (testing), run `pnpm test` to confirm tests pass.
4. Commit:
   ```bash
   cd /Users/nosferatu/Projects/personal/effect-help/worked-example
   git add <files>
   git commit -m "<conventional-commit message specified in the per-task block below>"
   ```
5. Optionally tag: `git tag chapter-NN`.
6. Capture the commit SHA: `git rev-parse HEAD` — record this for the chapter prose if useful (the chapter does not need to embed the SHA, but the implementer subagent should know the worked-example commit was made).

Special cases:
- Ch 45 (Task 2): worked-example repo is empty — this is the FIRST commit (`git commit -m "Initial: README and DESIGN notes"`).
- Ch 60 (Task 17): "no code changes" per TOC — but `DESIGN.md` IS updated, so there is still ONE commit, a docs-only one (`git commit -m "docs: retrospective notes"`).

- [ ] **Step 4: Write the chapter file and verify**

Write the chapter prose to `book/part-3-authoring/<NN>-<slug>.md` following the Walkthrough Chapter Shape exactly. Constraints:
- Use the chapter's specific title, slug, patterns demonstrated, size target (given in each task block below).
- Every Effect-API claim cites `repos/<repo>/packages/<pkg>/src/<file>.ts:<line>-<line>` (JSDoc-inclusive).
- Worked-example code cited by relative path with line range.
- All code blocks `ts`-tagged (or `bash`/`json`/`jsonc` where appropriate) and include imports.
- "See also" section has 5+ entries linking to Part I chapters, Part II chapters, adjacent Part III chapters, patterns catalog, or per-package notes.
- File ends with "See also".
- Reader is assumed to have read Parts I and II — link back.
- `@experimental` APIs explicitly hedged.

Then run the verifier from `/Users/nosferatu/Projects/personal/effect-help`:

```bash
python3 - <<'PY'
import re, sys
chapter_path = '<TASK-SPECIFIC PATH>'
text = open(chapter_path).read()

issues = []

# Header check
if '> **Patterns demonstrated:**' not in text:
    issues.append('Missing "Patterns demonstrated" header line')
if '> **Source pinned at:**' not in text:
    issues.append('Missing "Source pinned at" header line')
if '> **Worked-example commit:**' not in text:
    issues.append('Missing "Worked-example commit" header line')

# Required sections (Part III shape)
required_sections = [
    'The goal of this chapter',
    'What we\'re adding',
    'The code',
    'Why this design choice',
    'What\'s still missing',
    'Commit',
    'See also',
]
# "What we already have" required for all chapters except 45
if '45-overview.md' not in chapter_path:
    required_sections.insert(1, 'What we already have')

for s in required_sections:
    if not re.search(rf'^## {re.escape(s)}', text, re.M):
        issues.append(f'Missing section: ## {s}')

# Code blocks must be ts/bash/json/jsonc-tagged or untagged (untagged allowed for tree listings)
all_blocks = re.findall(r'^```([a-z]*)$', text, re.M)
allowed = {'ts', 'bash', 'json', 'jsonc', 'sh', 'diff', ''}
non_allowed = [b for b in all_blocks if b not in allowed]
if non_allowed:
    issues.append(f'Disallowed code-block tags: {non_allowed}')

# At least one repos/ citation (Ch 45 overview is allowed to skip if no Effect API mentioned;
# but most chapters cite at least one)
if 'repos/' not in text and '45-overview.md' not in chapter_path:
    issues.append('No repos/ citation found')

# At least one ../../research/02-patterns-catalog.md link
if '../../research/02-patterns-catalog.md#' not in text:
    issues.append('No patterns-catalog cross-reference')

# At least one Part I or Part II reference (link back)
if '../part-1-foundations/' not in text and '../part-2-tour/' not in text:
    issues.append('No Part I/II cross-reference (Part III should reference back)')

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

# Word count
word_count = len(re.findall(r'\b\w+\b', text))
if word_count < 1200:
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

Expected: `OK. <N> words, 7 sections.` (or 8 — Ch 45 has 7 if "What we already have" is omitted, others have 8 sections counting "Commit"). Fix any issues before committing the chapter.

- [ ] **Step 5: Verify worked-example state matches the prose**

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git log --oneline -5
git show --stat HEAD
```

Confirm:
- The most recent commit message matches what the chapter says under "Commit".
- The files changed in the worked-example commit match the chapter's "What we're adding" section verbatim.
- Optional: `git diff HEAD~1 HEAD -- <file>` to confirm the prose's "The code" section matches the actual diff.

- [ ] **Step 6: Commit the chapter file in the book repo**

```bash
cd /Users/nosferatu/Projects/personal/effect-help
git add book/part-3-authoring/<NN>-<slug>.md
git commit -m "Write Chapter NN — <Title>"
```

---

## Task 2: Chapter 45 — Overview

**Parameters:**
- File: `book/part-3-authoring/45-overview.md`
- Title (from TOC): "Overview — what we are building and why"
- Slug: `45-overview`
- What gets committed: `worked-example/README.md`, `worked-example/DESIGN.md` (design notes only; no code yet)
- Patterns demonstrated: [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors) (foreshadowed — the API surface is sketched in DESIGN.md)
- Reads from: Chapter 11 (Constructors); Part II chapters that informed the choice of `effect-cache` as the worked-example domain — Chapter 22 (platform — abstract service tag), Chapter 26 (sql-drivers — `Cache.make` for prepared statements as inspiration)
- Reads into: every later Part III chapter
- Word target: 1500-2200 words
- Worked-example commit message: `chore: initial README and design notes`
- Special notes: This is the orientation chapter and the FIRST commit in the worked-example repo. README.md introduces `@example/effect-cache` (one paragraph + a code-shape sketch). DESIGN.md contains:
  - The intended public API surface (Cache tag, `make`, `get`, `set`, `delete`, `invalidate`, `events` stream)
  - Layer composition plan (in-memory layer, eviction-fiber layer)
  - Error variants (CacheError.Missing, CacheError.Backend)
  - Storage plug points (in-memory now, foreshadow Redis/SQL backends)
  - Patterns used (linked to catalog anchors)
  - Explicit non-goals (LRU eviction, multi-tier cache, distributed coherence)
  
  This chapter has NO "What we already have" section (worked-example repo was empty before). Override the verifier accordingly (the verifier already excludes Ch 45). The "What we're adding" section is the README + DESIGN files. The "The code" section shows the markdown content in fenced code blocks (with the surrounding `\`\`\`md` outer block — but use `\`\`\`` un-tagged inside the chapter's "The code" section since the verifier allows untagged blocks). The "Why this design choice" section justifies effect-cache as the worked-example domain (small enough to fit in 16 chapters, large enough to demonstrate Layer composition + Stream + dual API + Brand + Schema).

**Steps:** Follow the per-chapter task structure above (Steps 1–6).

---

## Task 3: Chapter 46 — Project layout and build setup

**Parameters:**
- File: `book/part-3-authoring/46-build-setup.md`
- Title: "Project layout and build setup — matching Effect monorepo conventions"
- Slug: `46-build-setup`
- What gets committed: `package.json`, `tsconfig.json`, `tsconfig.src.json`, `tsconfig.build.json`, `vitest.config.ts`, `.gitignore`
- Patterns demonstrated: [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) (build setup that supports it; the exports MAP itself is finalized in Ch 58), [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internalfolder-and-indexts-re-export-shape) (foreshadowed in `tsconfig.src.json` rootDir)
- Reads from: Chapter 21 (printer-ansi — first encounter with dual ESM/CJS pattern), Chapter 22 (platform — `internal/` shape)
- Reads into: Chapter 47 (the first source file lands), Chapter 58 (final exports map), Chapter 56 (vitest config used)
- Word target: 1800-2600 words
- Worked-example commit message: `chore: initial package.json, tsconfig, vitest.config, gitignore`
- Special notes: Mirror the `repos/effect/packages/effect/` shape closely. Cite that package's `package.json` and `tsconfig*.json` as the model. Show the three-tsconfig pattern (`tsconfig.json` for the workspace root with `references`, `tsconfig.src.json` for IDE/typecheck, `tsconfig.build.json` for the actual emit). `package.json` contains: name `@example/effect-cache`, `"type": "module"`, peerDependencies on `effect`, devDependencies on `@effect/vitest`, `vitest`, `typescript`. NO `exports` map yet — that's Ch 58. NO published `main`/`types` yet (placeholder OK). `worked-example/.gitignore`: `node_modules/`, `dist/`, `.tsbuildinfo`, `*.log`, `coverage/`. `vitest.config.ts`: minimal, points to `test/` directory, uses `@effect/vitest` reporter (cite `repos/effect/packages/vitest/src/index.ts` JSDoc). NO source files yet — that's Ch 47.

**Steps:** Follow the per-chapter task structure above.

---

## Task 4: Chapter 47 — Designing the public API

**Parameters:**
- File: `book/part-3-authoring/47-public-api.md`
- Title: "Designing the public API — the `.make` constructor and the service `Tag`"
- Slug: `47-public-api`
- What gets committed: `src/index.ts` (barrel, empty for now), `src/Cache.ts` (`Cache` tag, `CacheService` interface, `.make` stub)
- Patterns demonstrated: [`.make` / `.of` constructors](../../research/02-patterns-catalog.md#make--of-constructors), [`Context.GenericTag` / `Tag` class / `Reference` — tag variants](../../research/02-patterns-catalog.md#contextgenerictag--tag-class--reference--tag-variants)
- Reads from: Chapter 08 (Context and Tags), Chapter 09 (Layer), Chapter 11 (Constructors)
- Reads into: Chapter 51 (the first Layer implements this Tag), Chapter 53 (dual API exposes the methods on this Tag)
- Word target: 2000-3000 words
- Worked-example commit message: `feat: define Cache tag and CacheService interface`
- Special notes: Use the `class Cache extends Context.Tag("Cache")<Cache, CacheService>() {}` form (see `repos/effect/packages/effect/src/Context.ts` JSDoc for `Tag` class). Discuss the choice of `Tag` class vs `GenericTag` vs `Effect.Service` (Effect.Service is `@experimental` — hedge). The `CacheService` interface defines `get`, `set`, `delete`, `invalidate`, `events` as method signatures returning `Effect`/`Stream`; the `.make` stub returns an Effect of `CacheService` but throws "not implemented" inside (or returns a sentinel). The `src/index.ts` is currently a placeholder barrel — `export * from "./Cache.js"` only. Cite the Tag class JSDoc range fully. "Why this design choice": justify Tag class over GenericTag (better TS inference, no manual TypeId), justify keeping interface separate from class so it's easy to mock.

**Steps:** Follow the per-chapter task structure above.

---

## Task 5: Chapter 48 — Defining the error channel

**Parameters:**
- File: `book/part-3-authoring/48-error-channel.md`
- Title: "Defining the error channel — `CacheError` and typed failures"
- Slug: `48-error-channel`
- What gets committed: `src/CacheError.ts` (`Data.TaggedError` variants), `src/index.ts` (re-export errors)
- Patterns demonstrated: [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror), [`Effect.catchTag` / `catchTags` / `sandbox` — error handling](../../research/02-patterns-catalog.md#effectcatchtag--catchtags--sandbox--error-handling)
- Reads from: Chapter 06 (Typed errors), Chapter 07 (Cause model)
- Reads into: Chapter 51 (memory layer raises `CacheError.Missing`), Chapter 52 (eviction emits `Backend` errors), Chapter 56 (tests assert on tagged errors)
- Word target: 1800-2600 words
- Worked-example commit message: `feat: define CacheError variants with Data.TaggedError`
- Special notes: Define error variants:
  - `CacheError.Missing` — key not found (one field: `key: string`)
  - `CacheError.Backend` — storage failed (fields: `cause: unknown`, `operation: "get" | "set" | "delete" | "invalidate"`)
  - `CacheError.Encoding` — Schema decode/encode failure (one field: `parseIssue: ParseResult.ParseIssue`)
  
  Use the namespace pattern: `export class Missing extends Data.TaggedError("Missing")<{ readonly key: string }>{}`. Note: `Data.TaggedError` extends ES `Error` via `core.YieldableError`; no `Equal`/`Hash` via Structural — clarify in the prose. Update `src/Cache.ts` `CacheService` interface error channel to `CacheError.Missing | CacheError.Backend | CacheError.Encoding`. Update `src/index.ts` to re-export the error namespace. `ParseResult.ParseIssue` import: from `"effect"` (not `"@effect/schema"` — Schema is in core since 3.10.0). "Why this design choice": justify multiple variants over one omnibus error (catchTag-friendly, narrows in Effect.gen). Cite `repos/effect/packages/effect/src/Data.ts` for TaggedError JSDoc range.

**Steps:** Follow the per-chapter task structure above.

---

## Task 6: Chapter 49 — Schema-driven config

**Parameters:**
- File: `book/part-3-authoring/49-schema-config.md`
- Title: "Schema-driven config — `CacheConfig` and environment loading"
- Slug: `49-schema-config`
- What gets committed: `src/CacheConfig.ts` (`Schema.Struct` and/or `Schema.Class`, `Config` integration), `src/index.ts` (re-export config)
- Patterns demonstrated: [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct), [`Schema.Class` and `Schema.TaggedClass`](../../research/02-patterns-catalog.md#schemaclass-and-schemataggedclass), [`Config.string` / `integer` / `boolean` / `nested` / `all`](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all)
- Reads from: Chapter 14 (Schema part 1), Chapter 15 (Schema part 2), Chapter 38 (Config and secrets)
- Reads into: Chapter 51 (memory layer reads `CacheConfig`), Chapter 52 (eviction reads TTL from config)
- Word target: 2000-3000 words
- Worked-example commit message: `feat: schema-driven CacheConfig with Config integration`
- Special notes: `CacheConfig` fields: `defaultTtlMillis: number`, `maxEntries: number`, `evictionIntervalMillis: number`. Use `Schema.Class` (PascalCase, includes `_tag` only if you call `TaggedClass`; here use plain `Class`). Wire to `Config` via `Config.all({ defaultTtlMillis: Config.integer("CACHE_DEFAULT_TTL_MS"), ... })` — this returns an Effect that loads from env. Then `Schema.decode` to validate. Note: `Schema.decodeUnknownEither` returns `Either<A, ParseIssue>` (NOT ParseError) — important. `Schema.transformOrFail` callback returns `Effect<A, ParseResult.ParseIssue, R>` — important if any field uses transform. Import `ParseResult` separately from `"effect"` (NOT `Schema.ParseResult`). "Why this design choice": justify Schema.Class over Schema.Struct (gives a real class for `instanceof` and method extension), justify wiring Config + Schema (Schema validation runs as a transformOrFail combinator that converts string env vars to typed values). Cite `repos/effect/packages/effect/src/Schema.ts` and `Config.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 7: Chapter 50 — Branded types for cache keys

**Parameters:**
- File: `book/part-3-authoring/50-branded-keys.md`
- Title: "Branded types for cache keys — `CacheKey`"
- Slug: `50-branded-keys`
- What gets committed: `src/CacheKey.ts` (`Brand.nominal`), `src/Cache.ts` (updated `.make` signature to use `CacheKey` instead of `string`)
- Patterns demonstrated: [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all)
- Reads from: Chapter 13 (Branded types)
- Reads into: every later chapter that touches keys (51, 52, 53, 55)
- Word target: 1500-2200 words
- Worked-example commit message: `feat: brand CacheKey for nominal typing`
- Special notes: Define `CacheKey = string & Brand.Brand<"CacheKey">` and a constructor `CacheKey = Brand.nominal<CacheKey>()`. Update `CacheService.get`/`set`/etc. to take `CacheKey` not `string`. Update `CacheError.Missing.key` field type from `string` to `CacheKey`. Discuss `Brand.refined` as a richer alternative if we wanted runtime validation (e.g., key length limits) — and explain why we go with `nominal` for now (simpler; runtime validation belongs at the boundary, e.g., a Schema for keys). "Why this design choice": justify Brand over plain string (callers can't accidentally pass an unbranded string; type-level invariant). Cite `repos/effect/packages/effect/src/Brand.ts` JSDoc range.

**Steps:** Follow the per-chapter task structure above.

---

## Task 8: Chapter 51 — The first Layer (in-memory)

**Parameters:**
- File: `book/part-3-authoring/51-layer-memory.md`
- Title: "The first Layer — `Layer.succeed` for the in-memory implementation"
- Slug: `51-layer-memory`
- What gets committed: `src/internal/MemoryStorage.ts` (in-memory map keyed by `CacheKey`), `src/Cache.ts` (`Cache.layerMemory`)
- Patterns demonstrated: [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors), [`Ref` — atomic mutable cell](../../research/02-patterns-catalog.md#ref--atomic-mutable-cell)
- Reads from: Chapter 09 (Layer), Chapter 36 (Concurrency primitives — Ref)
- Reads into: Chapter 52 (eviction wraps this layer), Chapter 53 (dual API surfaces these methods), Chapter 54 (storage interface refactored from this), Chapter 56 (tests use this layer)
- Word target: 2200-3000 words
- Worked-example commit message: `feat: in-memory storage layer with Ref-backed map`
- Special notes: `MemoryStorage.ts` defines an internal helper that returns the `CacheService` implementation given a `Ref<HashMap<CacheKey, { value: unknown; expiresAt: number }>>`. `Cache.layerMemory` is a `Layer.effect(Cache, ...)` (NOT `Layer.succeed` directly — we need to construct the Ref via `Ref.make` which is an Effect; but the chapter title still says `Layer.succeed` per TOC; use the prose to clarify that the simplest case is `Layer.succeed` with a pre-built service, and we use `Layer.effect` because Ref construction is effectful). Discuss why `HashMap` from `effect` (structural equality; CacheKey is branded string so `===` works fine in this case but HashMap is the general idiom). Use `Ref.make`, `Ref.get`, `Ref.update`. The `events` stream returns `Stream.empty` for now (real PubSub-backed implementation lands in Ch 55). NO eviction yet (Ch 52). NO `SynchronizedRef` — discuss why plain `Ref` is enough here (atomic single-step updates only; if we needed multi-step read-modify-write across awaits, we'd need `SynchronizedRef`). "Why this design choice": justify `Layer.effect` over `Layer.succeed` here, justify `Ref<HashMap>` over a JS `Map` (Ref gives atomicity in concurrent fibers). Cite `repos/effect/packages/effect/src/Layer.ts`, `Ref.ts`, `HashMap.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 9: Chapter 52 — The second Layer (eviction fiber)

**Parameters:**
- File: `book/part-3-authoring/52-layer-scoped-eviction.md`
- Title: "The second Layer — `Layer.scoped` for the eviction fiber"
- Slug: `52-layer-scoped-eviction`
- What gets committed: `src/internal/eviction.ts` (TTL eviction fiber), `src/Cache.ts` (`Cache.layerMemoryWithEviction`)
- Patterns demonstrated: [`Layer.scoped` (resource layers)](../../research/02-patterns-catalog.md#layerscoped-resource-layers), [`Effect.acquireRelease` / `acquireUseRelease`](../../research/02-patterns-catalog.md#effectacquirerelease--acquireuserelease), [`Effect.fork` / `forkDaemon` / `forkScoped` / `forkIn`](../../research/02-patterns-catalog.md#effectfork--forkdaemon--forkscoped--forkin), [`Schedule.spaced` / `exponential` / `fixed` / `recurs`](../../research/02-patterns-catalog.md#schedulespaced--exponential--fixed--recurs)
- Reads from: Chapter 10 (Layer.scoped and Scope), Chapter 17 (Fibers), Chapter 34 (Schedule)
- Reads into: Chapter 53 (dual API includes `invalidate` triggered by eviction), Chapter 55 (eviction fiber publishes events to PubSub), Chapter 56 (tests use `it.scoped` for this layer)
- Word target: 2400-3200 words
- Worked-example commit message: `feat: eviction fiber layer with Layer.scoped and Schedule`
- Special notes: `eviction.ts` defines `runEviction(ref: Ref<...>): Effect<never, never, Scope>` that uses `Effect.forkScoped(loop)` where `loop = pipe(sweep(ref), Effect.repeat(Schedule.spaced(config.evictionIntervalMillis)))`. The fiber is forked into the scope of `Cache.layerMemoryWithEviction = Layer.scoped(Cache, Effect.gen(...))`. On layer release, the fiber interrupts. Sweep removes entries where `expiresAt < Date.now()`. Use `Schedule.spaced` (NOT `Schedule.upTo` standalone — Schedule.upTo only composes; cite `repos/effect/packages/effect/src/Schedule.ts`). Use `Clock.currentTimeMillis` from `Clock` service for testability — explain why `Date.now()` is wrong (untestable; `Clock` is a swappable service that `@effect/vitest` mocks). Discuss `Effect.forkScoped` vs `Effect.fork` (forkScoped attaches to the enclosing Scope; fork attaches to the runtime — would leak). `Layer.scoped` over `Layer.effect`: scoped gives the Scope dependency required to fork; effect doesn't. "Why this design choice": justify `forkScoped` over `forkDaemon` (we want the fiber to die with the layer), justify Schedule.spaced over a manual `setTimeout` loop (interruption-aware, testable). Cite `repos/effect/packages/effect/src/Layer.ts`, `Effect.ts` (forkScoped), `Schedule.ts`, `Clock.ts`.

**Steps:** Follow the per-chapter task structure above.

---

## Task 10: Chapter 53 — The dual API surface

**Parameters:**
- File: `book/part-3-authoring/53-dual-api.md`
- Title: "The dual API surface — data-first and data-last overloads"
- Slug: `53-dual-api`
- What gets committed: `src/Cache.ts` (`dual(...)` for `get`, `set`, `delete`, `invalidate`)
- Patterns demonstrated: [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait), [`pipe` vs method chaining](../../research/02-patterns-catalog.md#pipe-vs-method-chaining)
- Reads from: Chapter 04 (pipe and dual API)
- Reads into: Chapter 56 (tests exercise both call shapes)
- Word target: 1800-2600 words
- Worked-example commit message: `feat: dual data-first/data-last API for Cache.{get,set,delete,invalidate}`
- Special notes: Up to this point, callers used `Cache.use((s) => s.get(key))`. Now we expose top-level `Cache.get`, `Cache.set`, `Cache.delete`, `Cache.invalidate` with dual signatures. Use `dual` from `effect/Function`:
  ```ts
  export const get: {
    (key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError.Backend, Cache>
    (cache: CacheService, key: CacheKey): Effect.Effect<Option.Option<unknown>, CacheError.Backend>
  } = dual(2, (cache: CacheService, key: CacheKey) => cache.get(key))
  ```
  Discuss the arity-checking trick (`dual` accepts an arity number OR a predicate `(args) => boolean`). Discuss when to use the arity-number form vs the predicate form. Pipeable: `Cache.get` is callable as `Cache.get(key)` (data-last, used via `pipe(cache, Cache.get(key))`) OR `Cache.get(cache, key)` (data-first). The Effect-returning convention puts the resource arg LAST in the data-first form (so it's first to be partially applied). "Why this design choice": justify dual API for libraries (matches Effect's house style). Cite `repos/effect/packages/effect/src/Function.ts` `dual` JSDoc range.

**Steps:** Follow the per-chapter task structure above.

---

## Task 11: Chapter 54 — Internal modules and the `internal/` convention

**Parameters:**
- File: `book/part-3-authoring/54-internal-modules.md`
- Title: "Internal modules and the `internal/` convention — the `index.ts` re-export shape"
- Slug: `54-internal-modules`
- What gets committed: `src/internal/storage.ts` (abstract storage interface), re-exports refactored
- Patterns demonstrated: [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internalfolder-and-indexts-re-export-shape)
- Reads from: Chapter 22 (platform — first encounter with internal/ convention)
- Reads into: Chapter 58 (exports map respects internal/ as private)
- Word target: 1800-2600 words
- Worked-example commit message: `refactor: extract Storage interface to internal/, refactor MemoryStorage`
- Special notes: Define `internal/storage.ts` with an abstract `Storage` interface (`get`, `set`, `delete`, `entries`, `clear` — operating on raw key/value/expiry). Refactor `MemoryStorage.ts` to implement this interface. `Cache.layerMemory` and `layerMemoryWithEviction` now compose `MemoryStorage` + the public Cache façade (which adds Schema decoding, error mapping, branding). The reader can now imagine implementing `RedisStorage`, `SqliteStorage`, etc. without touching the public Cache module. The `internal/` folder is NOT exported from `src/index.ts` — only public symbols are. Discuss why the convention (Effect's monorepo uses it everywhere; cite `repos/effect/packages/effect/src/internal/`). "Why this design choice": justify the storage abstraction NOW vs Ch 51 (we wanted to ship a working version first; refactoring after the API stabilizes is the discipline of "pattern emerges from need"). Cite at least one `repos/effect/packages/effect/src/internal/<file>.ts` JSDoc and the corresponding public `<file>.ts` re-export shape.

**Steps:** Follow the per-chapter task structure above.

---

## Task 12: Chapter 55 — Streams of cache events

**Parameters:**
- File: `book/part-3-authoring/55-cache-events-stream.md`
- Title: "Streams of cache events — eviction and hit/miss telemetry"
- Slug: `55-cache-events-stream`
- What gets committed: `src/CacheEvent.ts` (`Data.TaggedEnum`), `src/Cache.ts` (`.events` stream via `PubSub`)
- Patterns demonstrated: [`Data.TaggedEnum` — discriminated union constructors](../../research/02-patterns-catalog.md#datataggedenum--discriminated-union-constructors), [`PubSub` — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast), [`Stream.fromPubSub` / `fromQueue` / `fromSchedule` / `groupBy`](../../research/02-patterns-catalog.md#streamfrompubsub--fromqueue--fromschedule--groupby)
- Reads from: Chapter 16 (Stream), Chapter 18 (Data.TaggedEnum), Chapter 36 (Concurrency primitives — PubSub)
- Reads into: Chapter 56 (tests subscribe to events stream), Chapter 60 (retrospective on observability hooks)
- Word target: 2200-3000 words
- Worked-example commit message: `feat: PubSub-backed events stream with Data.TaggedEnum`
- Special notes: Define `CacheEvent` via `Data.taggedEnum<{ Hit: { key: CacheKey }; Miss: { key: CacheKey }; Set: { key: CacheKey }; Evict: { key: CacheKey } }>()` — note `Data.taggedEnum` lowercase (runtime constructor); `Data.TaggedEnum` PascalCase is the type. Both exist, distinct (carry-forward lesson). Add `events: Stream.Stream<CacheEvent>` to `CacheService`. Backed by `PubSub.unbounded<CacheEvent>()` constructed in `layerMemory`. `Stream.fromPubSub(pubsub)` to get the read end. Discuss `unbounded` vs `bounded`/`sliding`/`dropping` (cite Pattern catalog: Queue and PubSub variants). MemoryStorage now publishes events on each operation. Eviction fiber publishes `Evict` events. "Why this design choice": justify PubSub over Queue (multi-subscriber semantics; consumers don't drain each other). Justify Data.taggedEnum over hand-written discriminated union (free constructors, exhaustive matching with `Match.tag`). Cite `repos/effect/packages/effect/src/PubSub.ts`, `Data.ts` (taggedEnum JSDoc), `Stream.ts` (fromPubSub JSDoc).

**Steps:** Follow the per-chapter task structure above.

---

## Task 13: Chapter 56 — Testing with @effect/vitest

**Parameters:**
- File: `book/part-3-authoring/56-testing.md`
- Title: "Testing with @effect/vitest — `it.effect`, `it.scoped`, and layer management"
- Slug: `56-testing`
- What gets committed: `test/Cache.test.ts` (`it.effect` for memory layer, `it.scoped` for eviction layer)
- Patterns demonstrated: [Runtime — pre-built runtime for executing Effects](../../research/02-patterns-catalog.md#runtime--pre-built-runtime-for-executing-effects), [`Layer.merge` / `provide` / `fresh` — Layer composition](../../research/02-patterns-catalog.md#layermerge--provide--fresh--layer-composition)
- Reads from: Chapter 09 (Layer), Chapter 17 (Fibers), Chapter 43 (vitest)
- Reads into: Chapter 60 (retrospective discusses test maturity)
- Word target: 2200-3200 words
- Worked-example commit message: `test: it.effect and it.scoped tests for Cache layers`
- Special notes: Tests cover:
  - `it.effect` — basic get/set/delete on `Cache.layerMemory` (no eviction, no scope required beyond runtime)
  - `it.scoped` — eviction triggers under `Cache.layerMemoryWithEviction` using `TestClock.adjust` (vitest's TestClock helper) — important: `Schedule.spaced` is testable via TestClock advances; `Date.now()` would not be (carry-forward justification for Ch 52's Clock choice)
  - Tagged-error assertions: `Effect.flip` to invert success/failure channel, then assert `_tag === "Missing"` (cite `Effect.flip` JSDoc range)
  - PubSub events stream consumption: `Stream.take(n).runCollect` from `events` stream, assert sequence
  
  Cite `repos/effect/packages/vitest/src/index.ts` for `it.effect` / `it.scoped` JSDoc — IMPORTANT: cite the public `index.ts` JSDoc, NOT `internal.ts` (this was a Part II review issue in Ch 43). Cite `repos/effect/packages/effect/src/TestClock.ts` (or wherever TestClock lives) for the time-advancing helper. "Why this design choice": justify `it.effect` over plain `it` + `Effect.runPromise` (it.effect manages the runtime + interruption automatically). Justify per-test-fresh layer via `Layer.fresh` if used — note that `it.effect`/`it.scoped` accept a layer arg that gets fresh-built per test by default.

**Steps:** Follow the per-chapter task structure above.

---

## Task 14: Chapter 57 — Documenting with JSDoc

**Parameters:**
- File: `book/part-3-authoring/57-jsdoc.md`
- Title: "Documenting with JSDoc — `@since`, `@category`, `@example` tags"
- Slug: `57-jsdoc`
- What gets committed: All public `.ts` files (JSDoc added), `docgen.json`
- Patterns demonstrated: [`JSDoc` `@since`, `@category`, `@example` tags](../../research/02-patterns-catalog.md#jsdoc-since-category-example-tags)
- Reads from: Chapter 21 (printer-ansi — first encounter with monorepo conventions), Chapter 22 (platform — internal/ shape)
- Reads into: Chapter 58 (exports map), Chapter 59 (publishing — docs site is generated from JSDoc)
- Word target: 2000-2800 words
- Worked-example commit message: `docs: JSDoc tags on public exports + docgen config`
- Special notes: Add `/** @since 0.1.0 @category constructors */` and similar to every public export in `src/Cache.ts`, `src/CacheConfig.ts`, `src/CacheError.ts`, `src/CacheKey.ts`, `src/CacheEvent.ts`, `src/index.ts`. `@since` for ALL exports (initially `0.1.0`). `@category` taxonomy: `constructors`, `getters`, `combinators`, `models`, `errors`, `utilities` — match `repos/effect/packages/effect/src/Cache.ts` (the real Cache module) JSDoc taxonomy. `@example` blocks on the most important exports (`Cache.layerMemory`, `Cache.get`, `Cache.set`, `events` stream). `docgen.json` (or `docs.json` — match Effect's config name) configures `@effect/docgen` to emit markdown docs from JSDoc. Cite `repos/effect/packages/effect/src/Cache.ts` for taxonomy, `repos/effect/packages/effect/package.json` for any docgen invocation, and `repos/effect/docgen.json` (root) for a shared config example. "Why this design choice": justify the discipline (downstream tooling, IDE hover docs, the docs site). Note: `@since` is NOT a requirement enforced by tsc — it's enforced by docgen lint rules.

**Steps:** Follow the per-chapter task structure above.

---

## Task 15: Chapter 58 — Versioning, exports map, and dual ESM/CJS

**Parameters:**
- File: `book/part-3-authoring/58-versioning-and-exports.md`
- Title: "Versioning, exports map, and dual ESM/CJS"
- Slug: `58-versioning-and-exports`
- What gets committed: `package.json` (full exports map, `"type": "module"`, version policy)
- Patterns demonstrated: [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern)
- Reads from: Chapter 21 (printer-ansi — first dual ESM/CJS encounter), Chapter 46 (build setup)
- Reads into: Chapter 59 (publishing reads version)
- Word target: 1800-2600 words
- Worked-example commit message: `chore: finalize exports map for dual ESM/CJS`
- Special notes: Update `package.json`:
  - `"version": "0.1.0"` (initial)
  - `"type": "module"`
  - `"main": "./dist/cjs/index.js"`, `"module": "./dist/esm/index.js"`, `"types": "./dist/dts/index.d.ts"`
  - `"exports"` map: per-module exports for `.`, `./Cache`, `./CacheConfig`, `./CacheError`, `./CacheKey`, `./CacheEvent`. Each entry has `import`, `require`, `types` keys. `internal/*` is NOT exported (private).
  - `"files"`: `dist/`, `src/`, `README.md`, `LICENSE`, `package.json`
  - `"sideEffects": false`
  
  Mirror `repos/effect/packages/effect/package.json` exports map structure. The build setup in Ch 46 already supports this (tsconfig.build.json emits both cjs and esm). Discuss versioning policy: 0.x means breaking changes allowed in minor; 1.0+ follows semver strictly; `@since` tags in JSDoc track the version a symbol was added (so consumers can spot risk). "Why this design choice": justify the exports map over plain `main`/`module` (Node 18+ honors exports; older bundlers fall back to main). Cite `repos/effect/packages/effect/package.json` exports map directly (JSON path notation, not line range — JSON has no JSDoc).

**Steps:** Follow the per-chapter task structure above.

---

## Task 16: Chapter 59 — Publishing checklist

**Parameters:**
- File: `book/part-3-authoring/59-publishing.md`
- Title: "Publishing checklist — peer deps, changesets, and release"
- Slug: `59-publishing`
- What gets committed: `.changeset/config.json`, `.changeset/initial.md`, `package.json` (peerDependencies finalized), `CHANGELOG.md` (initial entry)
- Patterns demonstrated: (No new pattern — process chapter. Header line: "Patterns demonstrated: this chapter applies the [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) to a release.")
- Reads from: Chapter 58 (exports map)
- Reads into: Chapter 60 (retrospective)
- Word target: 1800-2600 words
- Worked-example commit message: `chore: changesets config, peer deps, initial CHANGELOG`
- Special notes: `.changeset/config.json`: model after `repos/effect/.changeset/config.json` (root of effect monorepo). Settings: `baseBranch: "main"`, access `public`, ignore none. `.changeset/initial.md`: a sample changeset entry showing the markdown frontmatter (`"@example/effect-cache": minor`) and a body describing the initial release. `package.json` peerDependencies: pin `effect` at `^3.21.0` (range based on the SHA we're pinned at). dependencies and devDependencies stay as before. `CHANGELOG.md`: initial entry "## 0.1.0 — <date>" with the bullet list of features (cite back to Part III chapters that introduced each). The "publishing checklist" in prose enumerates: (1) `pnpm changeset` to record changes, (2) `pnpm changeset version` to bump, (3) `pnpm build` to compile, (4) `pnpm test` to verify, (5) `pnpm publish --access public`, (6) `git tag v0.1.0`, (7) push tags. Cite `repos/effect/.changeset/config.json` and the root `repos/effect/package.json` `release` script if present. "Why this design choice": justify changesets over manual `npm version` (works in monorepos; downstream consumers see structured changelog entries; CI can release on PR-merge).

**Steps:** Follow the per-chapter task structure above.

---

## Task 17: Chapter 60 — Retrospective

**Parameters:**
- File: `book/part-3-authoring/60-retrospective.md`
- Title: "Retrospective — re-reading `effect-cache` against the patterns catalog"
- Slug: `60-retrospective`
- What gets committed: `DESIGN.md` (updated retrospective notes). NO src/ changes.
- Patterns demonstrated: ALL patterns used by `@example/effect-cache` are revisited; the chapter's "Patterns demonstrated" header line links to a representative selection (5-7 anchors):
  - [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../../research/02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors)
  - [`Data.TaggedError`](../../research/02-patterns-catalog.md#datataggederror)
  - [`Brand.nominal` / `refined` / `all`](../../research/02-patterns-catalog.md#brandnominal--refined--all)
  - [`Schema.Struct`](../../research/02-patterns-catalog.md#schemastruct)
  - [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../../research/02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait)
  - [`PubSub` — multi-subscriber broadcast](../../research/02-patterns-catalog.md#pubsub--multi-subscriber-broadcast)
  - [The `internal/` folder and `index.ts` re-export shape](../../research/02-patterns-catalog.md#the-internalfolder-and-indexts-re-export-shape)
- Reads from: every Part III chapter (45–59)
- Reads into: Reader's own future Effect package authoring
- Word target: 2400-3500 words
- Worked-example commit message: `docs: retrospective notes`
- Special notes: This is the closing chapter of the book. STRUCTURE differs slightly from the canonical shape — the chapter is reflective rather than constructive. Adapt the sections:
  - "The goal of this chapter" — "look back at `effect-cache` and ask: which patterns landed cleanly, which ones we'd revisit, and what we'd do differently"
  - "What we already have" — full file tree of `worked-example/` after Ch 59 (use `tree` or hand-listed)
  - "What we're adding" — only `DESIGN.md` updates (a "Retrospective" section appended)
  - "The code" — the appended DESIGN.md content (markdown inside markdown — use unfenced or quadruple-fenced)
  - "Why this design choice" — section becomes "Patterns we'd reach for again" — list 5-7 patterns that pulled their weight, with paragraph each citing where in the worked-example they appear AND a comparable example in `repos/effect/`.
  - "What's still missing" — section becomes "What we'd revisit" — bulleted list of design decisions we'd reconsider on a v0.2 (LRU eviction, Redis backend, structured logging via Effect.log, distributed coherence).
  - "Commit" — `cd worked-example && git add DESIGN.md && git commit -m "docs: retrospective notes"`. (This IS a commit — the TOC says "no code changes" meaning no `src/` change, but DESIGN.md inside `worked-example/` IS committed in the worked-example repo.)
  - "See also" — link to every Part III chapter, plus the patterns catalog, plus the brainstorming spec at `docs/superpowers/specs/2026-04-28-effect-ts-book-design.md`, plus the per-package research notes for any package the worked-example would naturally extend toward (`research/packages/sql.md` for a SQL backend).
  
  This chapter explicitly does NOT add `src/` code. The verifier will pass because there's still a `worked-example/` commit (DESIGN.md update). Word target is the highest in Part III because retrospectives benefit from breadth.

**Steps:** Follow the per-chapter task structure above.

---

## Self-review checklist (run after writing all tasks above)

After completing this plan, run through this checklist before commit:

1. **Spec coverage:** Every chapter 45–60 from `book/00-toc.md` has exactly one task. Each task block names the file path, title, slug, "What gets committed" (verbatim from TOC), patterns demonstrated, reads from, reads into, word target, and special notes. ✓
2. **Placeholder scan:** Search the plan for "TBD", "TODO", "implement later", "fill in details", "similar to Task N" (without code). Nothing of that shape should appear. Each task block must contain enough information for an implementer who hasn't read other tasks. ✓
3. **Type/name consistency:** `CacheService` named consistently. `CacheKey` (not `Key`, not `CacheId`). `CacheError.Missing`/`Backend`/`Encoding` (named consistently across Ch 48, 49, 51, 52, 56). `Cache.layerMemory` and `Cache.layerMemoryWithEviction` (named consistently across Ch 51, 52, 56). `events` stream (NOT `eventStream`, NOT `cacheEvents`). ✓
4. **Two-repo commit protocol** documented at the top and in each task. Each task explicitly says "commit in worked-example/" AND "commit in book repo". ✓
5. **Carry-forward lessons** from Parts I and II are listed in the header AND the worked-example code is required to demonstrate them correctly. ✓
6. **Verifier script** is in the per-chapter task structure (Step 4) and is parameterized correctly. ✓
7. **Forward references in chapter prose** are required to name a chapter number AND topic AND appear in See also — stated in the chapter shape. ✓

---

## Execution Handoff

After saving this plan, the user chooses one of two execution paths.

**1. Subagent-Driven (recommended)** — Use `superpowers:subagent-driven-development`. Fresh subagent per chapter task. Two-stage review (spec compliance + code quality). Two-repo commit protocol enforced by reviewer subagents (verifier scripts MUST pass; both repos checked).

**2. Inline Execution** — Use `superpowers:executing-plans`. Same session, batch execution with checkpoints between chapters.

Either way, Tasks 2–17 must execute in **strict numerical order** because each chapter's `worked-example/` commit depends on the previous chapter's commit. Do not parallelize Part III chapter tasks.

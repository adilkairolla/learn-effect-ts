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

Ch 60 (retrospective) is the only chapter without `src/` changes — but `DESIGN.md` IS updated, so Ch 60 still produces ONE worked-example commit (a docs-only one).

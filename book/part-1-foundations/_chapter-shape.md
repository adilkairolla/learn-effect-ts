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

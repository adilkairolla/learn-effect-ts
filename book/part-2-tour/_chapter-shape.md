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

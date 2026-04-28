# Effect TS — From Beginner to Package Author

A research-backed book that takes a senior JS/TS engineer from Effect beginner to confident author of ecosystem-quality Effect packages.

## Goals

- **Primary goal:** Reader can author production-grade Effect packages that match the conventions of the official `Effect-TS` org (constructors, layers, errors, schemas, exports, tests, docs).
- **Secondary goals:**
  - Reader develops *pattern vocabulary* — can name and recognize ~40–60 recurring Effect idioms.
  - Reader has a complete map of the official package ecosystem (what each package does, how they compose).
  - Reader has a worked-example package they built alongside the book that demonstrates every authoring pattern.

## Non-goals

- Teaching JavaScript, TypeScript, async, or generics. Reader is a principal engineer.
- Comparing Effect to fp-ts, ZIO, cats-effect, or other ecosystems beyond brief framing.
- Covering community packages (`@effect-aws/*`, etc.) — official Effect-TS org packages only.
- Writing a "cookbook" of recipes. The book is structured around patterns and packages, not tasks.

## Audience

Single reader profile: principal engineer, deep JS/TS, Effect beginner. End goal is package authoring.

## Architecture: 5 Phases

```
Phase 1: Research setup     →  ./repos/                    (cloned source)
Phase 2: Pattern extraction →  ./research/                 (analysis notes)
Phase 3: Per-package analysis → ./research/packages/<name>.md
Phase 4: Book outline + TOC →  ./book/00-toc.md            ← USER REVIEW GATE
Phase 5: Write the book     →  ./book/part-1..3/
                             +  ./worked-example/          (its own git repo)
```

**Why phased with a review gate before Phase 5:** writing 60 chapters before agreeing on the outline makes restructuring expensive. The TOC review gate is the cheapest place to push back on chapter ordering, scope, and inclusion.

**Why three artifact directories instead of one:** `repos/` is read-only reference material. `research/` is terse machine-friendly notes. `book/` is polished prose for the reader. Mixing them either bloats the book with research minutiae or loses research when chapters get rewritten.

## Phase 1 — Research setup

**Repos to clone into `./repos/`:**

- `Effect-TS/effect` — the monorepo (~25 packages: `effect`, `@effect/platform*`, `@effect/sql*`, `@effect/rpc`, `@effect/cluster`, `@effect/cli`, `@effect/printer`, `@effect/opentelemetry`, `@effect/experimental`, `@effect/vitest`, `@effect/typeclass`, etc.)
- `Effect-TS/website` — docs source
- `Effect-TS/examples` — example apps
- Any other `effect-*` repos under the Effect-TS org (enumerated via `gh api orgs/Effect-TS/repos` first, then pulled if relevant)

**Pinning policy:** at clone time, `repos/effect` is pinned to a specific commit. The commit SHA is recorded in `book/00-toc.md`. The book remains internally consistent against that snapshot. Re-syncing is the reader's decision after the fact.

**Tier policy:** experimental packages (`@effect/experimental`, anything alpha) **are included** in the inventory and tour, with explicit churn warnings.

## Phase 2 — Pattern extraction

Three artifacts in `./research/`:

### `research/01-package-inventory.md`

One entry per package across the org. Fields:
- name
- one-line purpose
- public exports (top-level modules only)
- dependencies (which other Effect packages it imports)
- dependents
- novelty (what this package teaches that others don't)
- tier (core / platform / domain / tooling / experimental)

### `research/02-patterns-catalog.md` — primary research artifact

One entry per recurring pattern. Fixed schema:
- **Name** (e.g., "Tagged constructor / `.make`", "Layer.scoped", "Dual API", "Tag class with `Effect.Service`")
- **Signature** (TypeScript shape)
- **Where it appears** (file paths into `./repos/`, e.g., `repos/effect/packages/effect/src/Layer.ts:1234-1278`)
- **When to use / when not to**
- **Anti-pattern it replaces**
- **Related patterns** (links to other entries)

Target: 40–60 patterns. This is the spine of Part I and the vocabulary for Parts II and III. Phase 2 is optimized to make this catalog excellent even if per-package notes are terser.

### `research/03-conventions.md`

Team house style: file layout, `internal/` folder convention, JSDoc tags, version policy, dual export pattern, branded type naming, etc.

### `research/04-dependency-graph.md`

The actual edges between packages, used to plan Part II (though final ordering will be use-case interest, not dep depth).

## Phase 3 — Per-package analysis

`research/packages/<name>.md` — one file per package, ~500–1500 words each. Fields:
- API surface walk
- patterns used (links into `02-patterns-catalog.md`)
- conventions (file layout, naming, test structure, `index.ts` re-export style)
- what's *unique* about this package's design
- "if you were authoring something similar, copy this" section

## Phase 4 — Book outline & TOC

Synthesize Phases 1–3 into:
- `book/00-toc.md` — full chapter list, slugs, and locations
- `book/00-glossary.md` — every term and pattern with one-line def + chapter link
- `book/00-cheatsheet.md` — single-page reference

**Review gate:** user reviews `book/00-toc.md` before any chapter is written. Restructuring is cheap here, expensive after Phase 5 begins.

## Phase 5 — Write the book

Three parts, ~60 chapters, ~250k words total. Files at `book/part-N-<name>/<NN>-<slug>.md` with global numbering for stable cross-refs.

### Part I — Foundations (Ch. 01–18)

Goal: install the vocabulary. Tentative chapters (refined at TOC review):

1. Why Effect — the problem with Promise/throw/async
2. Effect as a value (`Effect<A, E, R>` — the three type parameters)
3. Running Effects (`runSync`, `runPromise`, `runFork`, `runCallback`)
4. The `pipe` function & dual API style
5. `Effect.gen` and generator-based composition
6. Error channel: typed errors with `Data.TaggedError`
7. The `Cause` model — why errors are richer than `Error`
8. Context, Tags, and the `R` type parameter
9. `Layer` — building, merging, providing
10. `Layer.scoped` and `Scope` — resource lifecycles
11. Constructors: `.make`, `.of`, `.from*` — the conventions
12. Branded types and `Brand`
13. `Schema` part 1 — declaring shapes
14. `Schema` part 2 — transforms, refinements, brand integration
15. `Stream` — pull-based async iteration
16. Fibers and structured concurrency
17. `Match` — exhaustive pattern matching
18. The `Data` module — equality, hashing, case classes

### Part II — Package tours (Ch. 19–~45), ordered by use-case interest

Order favors quick wins and reader engagement over strict dep depth. One chapter per package; sub-chapters for the big ones (`Schema`, `Stream`, `Layer` get expanded here beyond what Part I introduced). Each tour answers: *what does this package do, what's its public API surface, what new patterns does it teach beyond what we've seen, and what would break if you tried to write it yourself naively?*

Tentative grouping (refined at TOC review):
- `@effect/cli` (early, simple, satisfying)
- `@effect/printer`
- `@effect/platform` + `@effect/platform-node` + `@effect/platform-bun`
- `@effect/sql` + drivers (pg, sqlite, mysql, mssql, libsql, kysely)
- `@effect/rpc`
- `@effect/cluster`
- `@effect/opentelemetry`
- `effect` core deep-dives (Schedule, STM, Ref, Queue, PubSub, Metric, etc.) — placed where they reinforce a tour
- `@effect/typeclass`
- `@effect/experimental` (with churn warning)
- `@effect/vitest`

### Part III — Authoring with worked example (Ch. ~46–60)

**Worked example: `@example/effect-cache`** — a TTL cache with pluggable storage layers.

Why this example: it exercises exactly the patterns needed to author anything — `Layer` composition (memory vs. redis storage), `Scope` (background eviction fiber), branded types (`CacheKey`), `Schema` (config validation), `Effect.Service` (the cache as a service), `Stream` (eviction events), tagged errors, dual API, `index.ts` re-export conventions, `internal/` folder, vitest setup. Small enough to ship, big enough to teach.

**`worked-example/` is its own fresh git repo.** Each Part III chapter corresponds to one commit, so the reader has a real package *plus* a teaching git history they can `git log` through.

Chapters (one chapter = one design decision = one commit):
46. Designing the public API (the `.make` and the service Tag)
47. Project layout & build setup (matching Effect's monorepo conventions)
48. Defining the error channel
49. Schema-driven config
50. The first Layer (`Layer.succeed` for in-memory)
51. The second Layer (`Layer.scoped` for the eviction fiber)
52. Branded types for keys
53. The dual API surface (data-first vs. data-last)
54. Internal modules and the `internal/` convention
55. Streams of cache events
56. Testing with `@effect/vitest`
57. Documenting with JSDoc tags the team uses
58. Versioning, exports map, dual ESM/CJS
59. Publishing checklist
60. Retrospective — re-reading the package against the patterns catalog

## Per-chapter quality gates

Every chapter must pass before being marked done:

1. **Source citations.** Every claim about Effect's behavior cites a file path inside `./repos/` with line range, e.g., `repos/effect/packages/effect/src/Layer.ts:412-438`. No hand-wavy "Effect does X." If it can't be cited, it hasn't been verified.
2. **Runnable examples.** Every code block is either copied verbatim from a cited source location, or a snippet that's been type-checked. Part III's chapters are stronger: each ends with a real commit to `worked-example/` that compiles and tests pass.
3. **Pattern catalog cross-refs.** Every pattern named in a chapter links back to its entry in `research/02-patterns-catalog.md`. Keeps vocabulary consistent across 60 chapters.
4. **No invention.** If docs and source disagree, source wins and the discrepancy is noted. If neither covers something, the chapter says "this is my interpretation" explicitly.

## Cross-chapter conventions

- **Fixed chapter shape:** intro / problem-it-solves / minimal example / production example / variations / anti-patterns / cross-refs (see-also). Predictability supports skimming.
- **Code blocks are full TS** (with imports), not pseudo-code. Copy-paste-runnable.
- **Every chapter has a "see also" section** with forward and backward links.

## Directory layout

```
/Users/nosferatu/Projects/personal/effect-help/
├── docs/superpowers/specs/2026-04-28-effect-ts-book-design.md   (this file)
├── repos/                       # cloned source, not committed (treated as build cache)
│   ├── effect/                  # Effect-TS/effect monorepo (pinned commit)
│   ├── website/
│   ├── examples/
│   └── ...
├── research/
│   ├── 01-package-inventory.md
│   ├── 02-patterns-catalog.md   # primary artifact
│   ├── 03-conventions.md
│   ├── 04-dependency-graph.md
│   └── packages/
│       ├── effect.md
│       ├── platform.md
│       └── ...
├── book/
│   ├── 00-toc.md
│   ├── 00-glossary.md
│   ├── 00-cheatsheet.md
│   ├── part-1-foundations/
│   │   ├── 01-why-effect.md
│   │   └── ...
│   ├── part-2-tour/
│   │   └── ...
│   └── part-3-authoring/
│       └── ...
└── worked-example/              # its own fresh git repo, one commit per chapter
    └── (effect-cache package)
```

## Open items deferred to TOC review

- Final ordering of Part II by use-case interest (current grouping is tentative).
- Final chapter list of Part I (current list is tentative).
- Whether any Part I chapters should be split or merged based on what Phase 2 surfaces.
- Whether any package warrants more than one Part II chapter beyond the noted big-three (`Schema`, `Stream`, `Layer`).

## Success criteria

- All Phase 1–3 artifacts exist and every claim in `02-patterns-catalog.md` cites a file path in `./repos/`.
- `book/00-toc.md` is approved by the user before Phase 5 begins.
- All ~60 chapters pass the four quality gates.
- `worked-example/` is a real git repo with one commit per Part III chapter, and `pnpm test` (or equivalent) passes at every commit.
- Reader, after reading the book and following the worked example, can sketch the public API of a new Effect package and explain which patterns they're using and why.

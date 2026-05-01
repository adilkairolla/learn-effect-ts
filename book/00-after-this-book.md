# After This Book

You have read 60 chapters and built a publish-ready Effect package end-to-end. Here is where to go next.

## Stay current with the moving parts

The book is pinned to `effect@3.21.2` (see `00-toc.md`). Effect ships frequently — features, bugfixes, and the occasional API tweak. Track the source of truth, not blog posts.

- **Official docs:** [effect.website](https://effect.website) — searchable, version-tracked, and authoritative for current API.
- **Release notes:** read each new release in [`packages/effect/CHANGELOG.md`](https://github.com/Effect-TS/effect/blob/main/packages/effect/CHANGELOG.md) inside the [`Effect-TS/effect`](https://github.com/Effect-TS/effect) monorepo. Most entries are one line; ten minutes per release keeps you current.
- **Source:** the same monorepo. Reading the source for the module you are using is faster than reading docs about it. The book's whole research method (citations into `packages/effect/src/<file>.ts:<line>-<line>`) is something you can keep doing on your own.

## Where the community lives

- **Discord:** [discord.gg/effect-ts](https://discord.gg/effect-ts) — the active channel for questions, design discussion, and early-warning on breaking changes. The maintainers (Michael Arnaldi, Tim Smart, Mirko Mancin, etc.) read it and answer.
- **Effect Days talks:** the annual conference. Past videos cover topics this book glosses (cluster internals, schema deep-dives, runtime fundamentals). Search YouTube for `"Effect Days"` plus the topic.
- **Tim Smart's blog and streams:** Tim writes much of `@effect/platform`, `@effect/sql`, `@effect/cluster`, and `@effect/ai`. His public material previews where those packages are heading.

## What to build next

You have a worked example (`effect-cache`) that demonstrates every authoring pattern. Use it as a template:

- **Ship it.** The `worked-example/` package is real code with real tests. Copy it, rename it, replace the cache logic with your own domain, follow the same `internal/` discipline, the same `Schema.Class` config layer, the same dual API surface. The publishing checklist in Chapter 59 is the actual checklist; you do not need a different one.
- **Extend it.** Chapter 60's retrospective lists six concrete extensions for a v0.2 (LRU, Schema-typed values, metrics, structured logging, Redis backend, distributed coherence). Each one is a self-contained learning project: pick one, implement it against the existing `Storage` interface, write the tests, ship the changeset.
- **Read a real Effect package end-to-end.** Pick one whose domain you already know — `@effect/cli` if you have built CLIs, `@effect/sql-pg` if you know Postgres, `@effect/printer` if you have written formatters. Read every public file. The patterns catalog gives you the vocabulary; the source gives you the variations.

## Things this book deliberately did not cover

So you know where to look when you need them:

- **`@effect/cluster` internals.** Chapter 30 toured the package; the actual sharding protocol, leader election, and persistence formats are documented in the package's own `docs/` folder and the Effect Days "Cluster" talk.
- **`@effect/ai` provider authoring.** Chapter 32 covers the user side. Authoring a new provider (a `LanguageModel.Service` implementation for an unsupported API) is its own project; the existing providers in `packages/ai-*/src/` are the best reference.
- **Effect-Schema migration from `@effect/schema`.** Anything pre-v3.10.0 used the separate `@effect/schema` package. Chapter 14 notes this; the migration guide lives in the v3.10 release notes.
- **fp-ts → Effect migration.** Many readers come from fp-ts. There is no canonical guide; the closest thing is the Effect Discord `#fp-ts` channel and Michael Arnaldi's talks on the rationale for Effect's design.
- **Community packages.** This book is scoped to the Effect-TS GitHub org. The wider ecosystem (`effect-aws`, community CLI helpers, framework integrations) is real and active — track it via npm, the Discord, and the [Awesome Effect](https://github.com/Effect-TS/community) list (when the org publishes one).

## When the book is wrong

It will be — Effect ships, conventions evolve, the patterns catalog gets new entries. When you find a gap or a stale citation, the most useful response is to file an issue or PR against this book's repo with the chapter and the line range. The book's value is in the citations being correct against the pinned source; the citations are the part most likely to drift.

## Closing

The pattern vocabulary is the durable part of what you have learned. APIs will change; the underlying ideas — typed errors, layers as recipes, structured concurrency, schema as the source of truth, dual APIs — will not. When you read a new Effect package three years from now, you will recognize the same primitives composing in new ways. That is the point.

---

[← Back to Table of Contents](00-toc.md) · [Patterns Catalog](../research/02-patterns-catalog.md)

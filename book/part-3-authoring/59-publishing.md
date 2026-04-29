# Chapter 59 — Publishing checklist — peer deps, changesets, and release

> **Worked-example commit:** `worked-example/` chapter 59 — `chore: changesets config, peer deps, initial CHANGELOG`
> **Patterns demonstrated:** [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) (the published artifact)
> **Reads from:** Chapter 58 (exports map and version 0.1.0)
> **Reads into:** Chapter 60 (retrospective — what we would do differently)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The goal of this chapter

Chapter 58 set `"version": "0.1.0"` and wrote an `"exports"` map. Technically, `npm publish` would work right now — but it would work badly. There is no record of what changed, no declared minimum peer version, and no tooling in place to handle version bumps for future releases. Consumers who install the package today would have no idea what was in the initial release. Maintainers who need to cut a patch for a bug fix tomorrow would be back to hand-editing version fields.

This chapter adds the infrastructure that turns a technically publishable tarball into a properly managed release:

1. A changesets configuration file that tells `@changesets/cli` how to behave.
2. An initial changeset entry that records the `minor` bump that produced `0.1.0`.
3. A `CHANGELOG.md` that gives consumers a human-readable summary of every release.
4. A finalized `peerDependencies` range and a `devDependency` on `@changesets/cli`.

The goal is not to actually publish to the npm registry — this is a worked example that lives in a book repo, not a real package. The goal is to demonstrate every step a maintainer would take before hitting `pnpm publish`, so that readers can apply the same checklist to their own libraries.

---

## What we already have

After Chapter 58, `worked-example/` is in its most complete state so far:

```
worked-example/
  src/
    Cache.ts, CacheConfig.ts, CacheError.ts, CacheKey.ts, CacheEvent.ts
    index.ts
    internal/
      storage.ts, MemoryStorage.ts, eviction.ts
  test/
    Cache.test.ts
  package.json        — version 0.1.0, full exports map, sideEffects: false
  docgen.json         — @effect/docgen config
  README.md, DESIGN.md
  tsconfig.json, tsconfig.src.json, tsconfig.build.json
  vitest.config.ts
```

What is still missing before a first release:

- No `.changeset/` directory — so `pnpm changeset` has nowhere to write change records and `pnpm changeset version` does not know what bumps to apply.
- No `CHANGELOG.md` — consumers cannot see what was in the initial release.
- `@changesets/cli` is not listed as a `devDependency`, so a fresh `pnpm install` on a clean machine would leave the `changeset` binary absent.

---

## What we're adding

Four files are created or modified in this chapter:

| File | Status | Purpose |
|---|---|---|
| `.changeset/config.json` | new | Changesets runtime configuration |
| `.changeset/initial.md` | new | First changeset entry (minor bump) |
| `CHANGELOG.md` | new | Human-readable release history |
| `package.json` | modified | Adds `@changesets/cli` to `devDependencies` |

The `peerDependencies` range (`"effect": "^3.21.0"`) is confirmed as-is. No additional peer deps are required because `effect/Schema` is part of the `effect` package since 3.10.0 — we do not depend on `@effect/schema` separately.

---

## The code

### `.changeset/config.json` (new)

```json
{
  "$schema": "https://unpkg.com/@changesets/config@2.0.0/schema.json",
  "changelog": "@changesets/cli/changelog",
  "commit": false,
  "fixed": [],
  "linked": [],
  "access": "public",
  "baseBranch": "main",
  "updateInternalDependencies": "patch",
  "ignore": []
}
```

This is the default configuration for a single-package public library. Each field has a specific role:

- `"changelog"` — which changelog generator to use. `"@changesets/cli/changelog"` is the built-in formatter that writes plain markdown. Effect uses `["@changesets/changelog-github", { "repo": "Effect-TS/effect" }]` (see `repos/effect/.changeset/config.json`) to generate GitHub PR links in its changelog entries. For a worked example without a real GitHub remote, the built-in formatter is the right choice.
- `"commit": false` — do not auto-commit after `pnpm changeset version`. We prefer explicit commits so that the version bump appears in the git log with a clear message.
- `"access": "public"` — needed for scoped packages (`@example/effect-cache`). npm treats scoped packages as `restricted` by default; this override is what makes `pnpm publish` work without passing `--access public` on the command line every time. Effect sets `"access": "restricted"` because it publishes to a private registry for some packages; we set `"public"` because our package is open source.
- `"baseBranch": "main"` — the branch that changesets diffs against to decide which changes are new. This affects `pnpm changeset status` and the automated release PR workflow.
- `"updateInternalDependencies": "patch"` — relevant in a monorepo: if package A depends on package B and B gets a patch bump, A's dependency on B is also bumped as a patch. For a single-package repo this field is inert but harmless.
- `"fixed"` and `"linked"` — grouping and linking mechanisms for monorepos. Both empty here.

### `.changeset/initial.md` (new)

```md
---
"@example/effect-cache": minor
---

Initial release of `@example/effect-cache` — a TTL cache with pluggable storage layers.

This release ships:

- `Cache` service tag and `CacheService` interface (Chapter 47)
- `CacheError.Missing` / `Backend` / `Encoding` typed errors (Chapter 48)
- `CacheConfig` schema and `Config` integration (Chapter 49)
- `CacheKey` branded type (Chapter 50)
- `Cache.layerMemory` — in-memory implementation (Chapter 51)
- `Cache.layerMemoryWithEviction` — with TTL eviction fiber (Chapter 52)
- Dual data-first / data-last API for `get`, `set`, `delete`, `invalidate` (Chapter 53)
- Internal `Storage` interface for backend extensibility (Chapter 54)
- `Cache.events` stream of cache lifecycle events (Chapter 55)
- Test suite via `@effect/vitest` (Chapter 56)
- JSDoc tags for `@effect/docgen` (Chapter 57)
- Dual ESM/CJS exports map (Chapter 58)
```

The frontmatter is YAML and uses three-dash delimiters. The package name key (`"@example/effect-cache"`) must exactly match the `"name"` field in `package.json`. The value (`minor`) is the semver bump type.

Why `minor` and not `major`? The semver convention for a package in the `0.x` range is that any new feature ships as a `minor` bump (moving from `0.0.x` to `0.1.0`). A `major` bump in `0.x` is reserved for breaking changes. Since this is the initial public release, there is nothing to break — `minor` is correct.

When `pnpm changeset version` runs, it reads all pending `.changeset/*.md` files, resolves the highest bump type across all entries (here: `minor`), writes the new version to `package.json`, appends an entry to `CHANGELOG.md`, and deletes the consumed `.md` files. The `initial.md` file is therefore a one-time artifact: it will be consumed and removed the first time someone runs `pnpm changeset version` on a fresh checkout.

### `CHANGELOG.md` (new)

```md
# @example/effect-cache

## 0.1.0

### Minor Changes

Initial release. See `.changeset/initial.md` for the full feature list.

- Cache service with `Tag` class form
- `Data.TaggedError` variants for typed failures
- `Schema.Class` config + `Config` env loading
- `Brand.nominal` keys
- `Layer.effect` (in-memory) and `Layer.scoped` (with eviction)
- Dual API surface
- PubSub-backed events stream
- Test coverage via `@effect/vitest`
```

In a live project `CHANGELOG.md` is generated by `pnpm changeset version`, not handwritten. We hand-write it here because `pnpm changeset version` would also modify `package.json`'s version field (from `0.1.0` to... `0.1.0` again, since the changeset records the bump that produced this version). Rather than run the CLI tool in a book example where it might have side effects, we write the file manually to match the shape changesets would produce.

### `package.json` (modified — devDependencies)

```json
"devDependencies": {
  "@changesets/cli": "^2.27.0",
  "@effect/vitest": "^0.29.0",
  "@types/node": "^20.0.0",
  "typescript": "^5.4.0",
  "vitest": "^3.2.0"
}
```

`@changesets/cli` is a dev dependency, not a regular dependency. It is a release tooling concern, not a runtime concern. Consumers who install `@example/effect-cache` will never download `@changesets/cli`.

---

## Why this design choice

### Changesets over manual `npm version`

The naive alternative to changesets is `npm version minor && git tag v0.1.0 && npm publish`. This works for a single developer on a single package, but it does not scale to:

- **Monorepos** — `npm version` bumps one package; changesets understands interdependencies and bumps all affected packages in topological order.
- **Collaborative workflows** — multiple contributors open PRs; each PR should include a changeset entry describing what changed. Changesets accumulates those entries across multiple merges and resolves them into a single coherent version bump at release time.
- **Structured changelogs** — `npm version` produces an empty tag; changesets generates a rich CHANGELOG.md from the accumulated entries, categorized as Major, Minor, or Patch changes.
- **CI-driven releases** — the `changesets/action` GitHub Action can open a "Version Packages" PR automatically, keeping the main branch always releasable without human intervention.

Effect itself uses changesets for all of its packages — see `repos/effect/.changeset/config.json` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`), which registers `@changesets/changelog-github` for PR-linked entries. We mirror the same tooling at a simpler configuration level.

### Peer dependency range strategy

The current range is `"effect": "^3.21.0"`. This means the package requires at least Effect 3.21.0 and is compatible with any 3.x release up to (but not including) 4.0.0. Three options were considered:

1. **`"^3.0.0"`** — broadest range, but we use APIs that were stabilized in 3.10.0 (Schema-in-core) and runtime behavior we tested against 3.21.2. Advertising compatibility with 3.0.0 is inaccurate.
2. **`"^3.21.0"`** — matches our test target. Any consumer on 3.21.x or later 3.x is guaranteed to work. This is the correct and conservative choice.
3. **`"^3.0.0 || ^4.0.0"`** — forward-looking, but Effect 4.x does not exist at this writing and its API surface is unknown. This would be premature.

`^3.21.0` is retained as-is.

### The complete publishing checklist

For readers publishing a real package for the first time, here is the full sequence:

1. `pnpm changeset` — interactively record what changed and which bump type applies. This writes a new `.md` file in `.changeset/`.
2. `pnpm changeset version` — consume all pending changeset entries, bump `package.json`, and update `CHANGELOG.md`.
3. `pnpm build` — compile ESM and CJS targets into `dist/`.
4. `pnpm test` — verify the compiled output against the test suite.
5. `pnpm publish --access public` — upload the tarball to the npm registry. The `--access public` flag is required for scoped packages even when `"access": "public"` is set in `config.json`, because the CLI flag overrides the config for safety.
6. `git tag v0.1.0` — tag the release commit.
7. `git push --tags` — push the tag to the remote so GitHub creates a release anchor.

Steps 3 and 4 can be automated in a `prepublishOnly` script in `package.json`, which npm/pnpm runs automatically before step 5:

```json
"scripts": {
  "prepublishOnly": "pnpm build && pnpm test"
}
```

We deliberately omit `prepublishOnly` from the worked example to keep the build scripts minimal and focused on what each chapter introduces.

---

## What's still missing

- **`prepublishOnly` guard** — A `"prepublishOnly": "pnpm build && pnpm test"` script would prevent accidentally publishing uncompiled or broken code. Chapter 60 (retrospective) notes this as a desirable addition.
- **`publishConfig` field** — For packages that live in a monorepo workspace, `"publishConfig": { "access": "public" }` in `package.json` is a cleaner way to override npm's default scoped-package behavior without relying on the CLI flag. We use `config.json`'s `"access": "public"` instead, which is equivalent for the `@changesets/cli` workflow.
- **CI release automation** — The `changesets/action` GitHub Action can open Version Packages PRs and run `npm publish` automatically on merge. This is out of scope for a worked example.
- **`@since` audit** — Every JSDoc block in `src/` should carry `@since 0.1.0` now that the first version is known. Chapter 57 added `@since 0.1.0` to the initial tags; Chapter 60 is where we confirm all symbols are covered.
- **Provenance attestation** — `npm publish --provenance` signs the tarball with a Sigstore attestation, proving it was built from a specific git commit in a CI environment. Not applicable to a local worked example, but worth knowing for production libraries.

---

## Commit

```bash
cd /Users/nosferatu/Projects/personal/effect-help/worked-example
git add .changeset/config.json .changeset/initial.md package.json CHANGELOG.md
git commit -m "chore: changesets config, peer deps, initial CHANGELOG"
```

The commit SHA for this chapter in the worked-example is `868c40d`.

---

## See also

- [Chapter 58 — Versioning, exports map, and dual ESM/CJS](58-versioning-and-exports.md) — sets `"version": "0.1.0"` and writes the `"exports"` map that this chapter's release process publishes.
- [Chapter 60 — Retrospective](60-retrospective.md) — looks back at the full worked example, notes what we would refactor, and references the publishing checklist from this chapter.
- [Part I Chapter 9 — Layers](../part-1-foundations/09-layer.md) — the `Layer` primitives that underpin the `Cache` service this release ships.
- [Part II Chapter 21 — ANSI printer (dual ESM/CJS)](../part-2-tour/21-printer-ansi.md) — the Effect monorepo's own dual ESM/CJS exports map, which `@example/effect-cache` mirrors in structure.
- [Dual ESM/CJS export pattern](../../research/02-patterns-catalog.md#dual-esmcjs-export-pattern) — the pattern catalog entry for the `"exports"` map shape this package ships.
- [`repos/effect/.changeset/config.json`](../../repos/effect/.changeset/config.json) — Effect's own changesets config at SHA `39c934c1476be389f7469433910fdf30fc4dad82`; compare `"access": "restricted"` (private monorepo) vs our `"access": "public"` (public library).
- [changesets documentation — Declaring a pre-release](https://github.com/changesets/changesets/blob/main/docs/prereleases.md) — how to use `pnpm changeset pre enter alpha` for alpha and beta release cycles.

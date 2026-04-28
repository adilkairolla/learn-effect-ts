# Effect TS Book — Phases 1–4 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete the research and outline phases for the Effect TS book — clone the official repos, build the patterns catalog and per-package research notes, and produce a Table of Contents that the user reviews before chapter writing begins.

**Architecture:** Four sequential phases with one user review gate at the end. Phase 1 sets up the source material in `./repos/`. Phase 2 produces four cross-cutting research artifacts in `./research/`. Phase 3 produces one analysis note per official package. Phase 4 synthesizes everything into `book/00-toc.md`, `book/00-glossary.md`, and `book/00-cheatsheet.md` for user review.

**Tech Stack:** `git`, `gh` (GitHub CLI), `ripgrep` (`rg`), `jq`, the Effect-TS source itself (TypeScript). No code is being written in this plan — output is markdown research notes and a TOC.

**Out of scope for this plan:** Writing the ~60 book chapters and building the worked-example package. Those are Phase 5, which gets its own plan after the TOC review gate at the end of Task 16.

**This plan is a research/documentation project, not a code project.** "Tests" in the standard TDD sense don't apply. Each task ends with a verification step that is the equivalent for the artifact being produced (file exists, has required sections, every claim cites a `repos/` path, etc.). Frequent commits still apply.

---

## File Structure (artifacts produced by this plan)

```
./repos/                                 # cloned Effect-TS source (gitignored)
├── effect/                              # Effect-TS/effect monorepo, pinned to a SHA
├── website/                             # Effect-TS/website
├── examples/                            # Effect-TS/examples
└── ... (other effect-* repos under the org)

./research/
├── 01-package-inventory.md              # one row per package across the org
├── 02-patterns-catalog.md               # PRIMARY ARTIFACT — 40-60 patterns
├── 03-conventions.md                    # team house style
├── 04-dependency-graph.md               # edges between packages
└── packages/
    ├── effect.md                        # one note per official package
    ├── platform.md
    ├── platform-node.md
    ├── platform-bun.md
    ├── sql.md
    ├── sql-pg.md
    ├── sql-sqlite-node.md
    ├── sql-mysql2.md
    ├── sql-mssql.md
    ├── sql-libsql.md
    ├── sql-kysely.md
    ├── sql-drizzle.md (if present)
    ├── rpc.md
    ├── cluster.md
    ├── cli.md
    ├── printer.md
    ├── opentelemetry.md
    ├── experimental.md
    ├── vitest.md
    ├── typeclass.md
    └── ... (any others surfaced in Task 6)

./book/
├── 00-toc.md                            # full chapter list, slugs, locations
├── 00-glossary.md                       # every term + chapter link
├── 00-cheatsheet.md                     # single-page reference
└── README.md                            # tiny pointer to 00-toc.md
```

---

## Phase 1 — Research setup

### Task 1: Create directory layout and tool check

**Files:**
- Create: `./repos/.gitkeep` (placeholder; `repos/` is gitignored)
- Create: `./research/packages/.gitkeep`
- Create: `./book/.gitkeep`

- [ ] **Step 1: Verify required tools are installed**

Run:
```bash
which git gh rg jq node
gh auth status
```

Expected: paths printed for all five tools, and `gh auth status` shows a logged-in user. If any tool is missing, stop and ask the user to install it. If `gh` is not authenticated, ask the user to run `gh auth login` interactively.

- [ ] **Step 2: Create the three top-level directories with placeholder files so empty dirs commit cleanly**

Run:
```bash
cd /Users/nosferatu/Projects/personal/effect-help
mkdir -p repos research/packages book
touch repos/.gitkeep research/packages/.gitkeep book/.gitkeep
```

- [ ] **Step 3: Verify .gitignore already excludes `repos/`**

Run:
```bash
cat .gitignore
git check-ignore -v repos/.gitkeep
```

Expected: `repos/` listed in `.gitignore`, and `git check-ignore` confirms `repos/.gitkeep` is ignored. The `repos/.gitkeep` file is intentionally never tracked — it just keeps the local directory shape obvious.

- [ ] **Step 4: Commit the empty research and book scaffolding**

```bash
git add research/packages/.gitkeep book/.gitkeep
git commit -m "Scaffold research/ and book/ directories"
```

---

### Task 2: Enumerate official Effect-TS repos

**Files:**
- Create: `research/_meta/repos-list.json` (raw `gh api` dump for reproducibility)
- Create: `research/_meta/repos-selected.md` (the human-readable shortlist with reasons)

- [ ] **Step 1: Fetch every public repo under the Effect-TS org**

Run:
```bash
mkdir -p research/_meta
gh api -X GET 'orgs/Effect-TS/repos' \
  -f per_page=100 --paginate \
  | jq '[.[] | {name, full_name, description, archived, fork, default_branch, pushed_at, size}]' \
  > research/_meta/repos-list.json
wc -l research/_meta/repos-list.json
jq 'length' research/_meta/repos-list.json
```

Expected: a JSON array. Length printed. If the count is 0, `gh` auth is broken — go back and fix it.

- [ ] **Step 2: Print the candidate list filtered for non-archived, non-fork repos**

Run:
```bash
jq -r '.[] | select(.archived == false and .fork == false) | "- " + .name + " — " + (.description // "(no description)") + " (last push: " + .pushed_at + ")"' research/_meta/repos-list.json
```

Expected: a list of ~10–25 repos. Read the descriptions.

- [ ] **Step 3: Write `research/_meta/repos-selected.md` with the cloning decisions**

The file must contain exactly these sections:

```markdown
# Repos Selected for Cloning

> Source: `research/_meta/repos-list.json` (snapshot from `gh api orgs/Effect-TS/repos`).

## Will clone

| Repo | Why |
|------|-----|
| Effect-TS/effect | Core monorepo — every official package lives here. |
| Effect-TS/website | Docs source — useful for "how the team explains things." |
| Effect-TS/examples | Example apps — real consumers of the library. |
| <add any other repo from Step 2 that contains library/example code worth reading> | <one-line reason> |

## Will skip

| Repo | Why skipped |
|------|-------------|
| <name> | archived / fork / template / unrelated tooling / etc. |
```

Every non-archived, non-fork repo from Step 2 must appear in either "Will clone" or "Will skip." No repo silently dropped.

- [ ] **Step 4: Verify every repo from Step 2 is accounted for**

Run:
```bash
jq -r '.[] | select(.archived == false and .fork == false) | .name' research/_meta/repos-list.json | sort > /tmp/repos-actual.txt
grep -oE '\| [A-Za-z0-9._-]+/[A-Za-z0-9._-]+' research/_meta/repos-selected.md | awk '{print $2}' | awk -F/ '{print $2}' | sort -u > /tmp/repos-listed.txt
diff /tmp/repos-actual.txt /tmp/repos-listed.txt
```

Expected: empty diff. If non-empty, add the missing repo to either table in `repos-selected.md` and re-run.

- [ ] **Step 5: Commit**

```bash
git add research/_meta/repos-list.json research/_meta/repos-selected.md
git commit -m "Enumerate Effect-TS org repos and pick clone targets"
```

---

### Task 3: Clone the selected repos

**Files:**
- Modify: `./repos/` (cloned working trees, not committed)
- Create: `research/_meta/clone-log.md` (records what was cloned, with SHAs)

- [ ] **Step 1: Clone each repo from the "Will clone" table**

For every repo in `research/_meta/repos-selected.md` "Will clone", run:
```bash
cd /Users/nosferatu/Projects/personal/effect-help/repos
git clone --depth=1 https://github.com/Effect-TS/<repo-name>.git
```

Use `--depth=1` for everything *except* `effect` — the core monorepo gets a full clone so we can pin to a specific historical commit if needed:
```bash
git clone https://github.com/Effect-TS/effect.git
```

Expected: each clone succeeds and creates a directory under `repos/`.

- [ ] **Step 2: Record what was cloned**

Run:
```bash
cd /Users/nosferatu/Projects/personal/effect-help
{
  echo "# Clone Log"
  echo
  echo "Cloned at: $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo
  echo "| Repo | Default branch | HEAD SHA | Working dir |"
  echo "|------|----------------|----------|-------------|"
  for d in repos/*/; do
    name=$(basename "$d")
    branch=$(git -C "$d" rev-parse --abbrev-ref HEAD)
    sha=$(git -C "$d" rev-parse HEAD)
    echo "| $name | $branch | $sha | $d |"
  done
} > research/_meta/clone-log.md
cat research/_meta/clone-log.md
```

Expected: the log file lists every cloned repo with its HEAD SHA.

- [ ] **Step 3: Verify the core repo is present and is the monorepo we expect**

Run:
```bash
ls repos/effect/packages | head -50
test -d repos/effect/packages/effect && echo "core package present"
test -f repos/effect/pnpm-workspace.yaml && echo "pnpm workspace present"
```

Expected: a list of 15+ package directories, "core package present", and "pnpm workspace present". If any of these fail, the clone is wrong — investigate before continuing.

- [ ] **Step 4: Commit the clone log**

```bash
git add research/_meta/clone-log.md
git commit -m "Record cloned repo SHAs"
```

---

### Task 4: Pin `repos/effect` to a specific commit

**Files:**
- Modify: `repos/effect` (working tree checkout)
- Modify: `research/_meta/clone-log.md` (note the pin)
- Create: `book/00-toc.md` (stub file — full content written in Task 14, but we record the pin SHA here now so it lives in the book artifact even if `clone-log.md` changes)

- [ ] **Step 1: Identify the latest tagged release of the `effect` package**

Run:
```bash
cd repos/effect
git fetch --tags
git tag --list 'effect@*' --sort=-v:refname | head -5
```

Expected: a list of recent `effect@X.Y.Z` tags. Pick the highest non-prerelease tag. Record the chosen tag below — call it `<PIN_TAG>`.

- [ ] **Step 2: Check out the pinned tag**

Run:
```bash
cd /Users/nosferatu/Projects/personal/effect-help/repos/effect
git checkout <PIN_TAG>
git rev-parse HEAD
```

Expected: detached HEAD, SHA printed. Record the SHA below — call it `<PIN_SHA>`.

- [ ] **Step 3: Update `research/_meta/clone-log.md` to record the pin**

Append to the file:
```markdown

## Pin

`repos/effect` is pinned to tag `<PIN_TAG>` at SHA `<PIN_SHA>`. All citations in this book reference file paths inside this snapshot. Re-syncing is the reader's decision.
```

- [ ] **Step 4: Create `book/00-toc.md` stub that records the same pin**

Write to `book/00-toc.md`:
```markdown
# Table of Contents

> **Effect TS source pinned to:** tag `<PIN_TAG>` at SHA `<PIN_SHA>`.
> All chapter citations reference file paths inside that snapshot.

_Full TOC will be written at the end of Phase 4 (Task 14)._
```

- [ ] **Step 5: Verify**

Run:
```bash
git -C repos/effect rev-parse HEAD
grep -c '<PIN_SHA>' research/_meta/clone-log.md book/00-toc.md
```

Expected: same SHA in both files.

- [ ] **Step 6: Commit**

```bash
git add research/_meta/clone-log.md book/00-toc.md
git commit -m "Pin repos/effect to <PIN_TAG> and record SHA in TOC stub"
```

---

## Phase 2 — Cross-cutting research artifacts

### Task 5: Build the package inventory (`research/01-package-inventory.md`)

**Files:**
- Create: `research/01-package-inventory.md`

- [ ] **Step 1: List all packages in the monorepo**

Run:
```bash
ls -d repos/effect/packages/*/ | xargs -n1 basename | sort
```

Expected: a list of ~25 package directory names.

- [ ] **Step 2: For each package, read its `package.json` to extract name and dependencies on other Effect packages**

Run:
```bash
for d in repos/effect/packages/*/; do
  pkg=$(basename "$d")
  if [ -f "$d/package.json" ]; then
    name=$(jq -r '.name' "$d/package.json")
    desc=$(jq -r '.description // ""' "$d/package.json")
    deps=$(jq -r '(.dependencies // {}) | to_entries | map(select(.key | startswith("effect") or startswith("@effect/"))) | map(.key) | join(", ")' "$d/package.json")
    echo "## $name"
    echo "Dir: $d"
    echo "Description: $desc"
    echo "Effect deps: $deps"
    echo "Top-level src modules:"
    ls "$d/src" 2>/dev/null | head -20
    echo
  fi
done
```

Expected: per-package summary printed. Save the output mentally or to a scratch file — it's the raw input for the inventory.

- [ ] **Step 3: Write `research/01-package-inventory.md`**

Required structure:
```markdown
# Package Inventory

> Source: `repos/effect/packages/*/package.json`, snapshot pinned at `<PIN_SHA>` (see `book/00-toc.md`).

## How to read this

| Column | Meaning |
|--------|---------|
| Package | npm name (`effect`, `@effect/xxx`) |
| Tier | core / platform / domain / tooling / experimental |
| Purpose | one-line summary |
| Effect deps | other Effect packages it imports |
| Novelty | what this package teaches that others don't |
| Source | `repos/effect/packages/<dir>/` |

## Inventory

| Package | Tier | Purpose | Effect deps | Novelty | Source |
|---------|------|---------|-------------|---------|--------|
| effect | core | <one line> | (none) | <one line> | `repos/effect/packages/effect/` |
| @effect/platform | platform | ... | effect | ... | `repos/effect/packages/platform/` |
| ... | | | | | |
```

Every package directory listed in Step 1 must appear as a row. No package silently omitted.

- [ ] **Step 4: Cross-check that every package directory has a row**

Run:
```bash
ls -d repos/effect/packages/*/ | xargs -n1 basename | sort > /tmp/dirs.txt
grep -oE '`repos/effect/packages/[a-z0-9-]+/`' research/01-package-inventory.md | sed 's|`repos/effect/packages/||;s|/`||' | sort -u > /tmp/listed.txt
diff /tmp/dirs.txt /tmp/listed.txt
```

Expected: empty diff. Fix any missing rows and re-run.

- [ ] **Step 5: Commit**

```bash
git add research/01-package-inventory.md
git commit -m "Add package inventory for pinned Effect monorepo"
```

---

### Task 6: Build the dependency graph (`research/04-dependency-graph.md`)

Numbered "04" because it serves a different purpose — it's a small graph file, but it informs the per-package work in Phase 3.

**Files:**
- Create: `research/04-dependency-graph.md`

- [ ] **Step 1: Extract dependency edges from each package**

Run:
```bash
for d in repos/effect/packages/*/; do
  src="$d/package.json"
  [ -f "$src" ] || continue
  from=$(jq -r '.name' "$src")
  jq -r --arg from "$from" '
    ((.dependencies // {}) | to_entries | map(select(.key | startswith("effect") or startswith("@effect/"))) | .[]?.key)
    | "\($from) -> \(.)"
  ' "$src"
done | sort -u
```

Expected: a list of edges like `@effect/sql -> effect`, `@effect/sql-pg -> @effect/sql`, etc.

- [ ] **Step 2: Write `research/04-dependency-graph.md`**

Required structure:
```markdown
# Dependency Graph

> Source: `repos/effect/packages/*/package.json` (`dependencies` field only — `devDependencies` excluded).

## Edge list

```
<paste sorted edge list from Step 1>
```

## Tier ordering (by depth from `effect`)

- **Depth 0:** effect
- **Depth 1:** <packages depending only on effect>
- **Depth 2:** <packages depending on depth-1 packages>
- ...

## Notes

- <Any cycles, surprising edges, or peer-dependency-only links worth noting.>
```

- [ ] **Step 3: Verify the graph is acyclic**

Run:
```bash
# Quick sanity: no package depends on itself.
grep -E '^([A-Za-z0-9@/_-]+) -> \1$' research/04-dependency-graph.md && echo "CYCLE FOUND" || echo "no self-edges"
```

Expected: "no self-edges". For richer cycle detection, run a `tsort` on the edge list:
```bash
awk '/^[a-zA-Z@]/ {print $3, $1}' <(grep -oE '^[a-zA-Z@/_0-9-]+ -> [a-zA-Z@/_0-9-]+' research/04-dependency-graph.md) | tsort > /dev/null && echo "DAG ok"
```

Expected: "DAG ok". If `tsort` reports a cycle, document it in the "Notes" section instead of failing.

- [ ] **Step 4: Commit**

```bash
git add research/04-dependency-graph.md
git commit -m "Add dependency graph for Effect monorepo"
```

---

### Task 7: Seed the patterns catalog with pattern *names* (Pass 1 of 3)

This is the primary research artifact. It's built in three passes: (7) names + locations, (8) signatures + citations, (9) when-to-use + anti-patterns + cross-refs. Splitting passes lets us hold the whole catalog in mind at each step instead of finishing one pattern at a time and losing the cross-pattern view.

**Files:**
- Create: `research/02-patterns-catalog.md`

- [ ] **Step 1: Run a set of grep sweeps over `repos/effect/packages/effect/src/` to find candidate patterns**

Run each of these and record what they surface:
```bash
cd repos/effect/packages/effect/src

# Constructor patterns
rg -n 'export const make\b' --type ts | head -40
rg -n 'export const of\b' --type ts | head -40
rg -n 'export const from[A-Z]' --type ts | head -40

# Layer patterns
rg -n '\bLayer\.(succeed|effect|scoped|scopedDiscard|scopedContext|merge|provide|provideMerge|fresh|setRandom|setLogger)\b' --type ts | head -40

# Context / Tag patterns
rg -n 'Context\.(GenericTag|Tag|Reference|Tag\(|GenericTag\()' --type ts | head -40
rg -n 'class .* extends Context\.Tag\(' --type ts | head -40
rg -n 'Effect\.Service\b' --type ts | head -20

# Error patterns
rg -n 'Data\.(TaggedError|TaggedClass|Class|TaggedEnum|tagged|struct)\b' --type ts | head -40

# Schema patterns (full schema package)
rg -n 'export const (Struct|Class|TaggedClass|brand|filter|transform|transformOrFail)\b' Schema.ts SchemaAST.ts 2>/dev/null | head -40

# Stream / fiber / scope patterns
rg -n 'Stream\.(make|fromIterable|paginate|fromQueue|asyncPush|fromAsyncIterable|fromReadableStream)' --type ts | head -40
rg -n '\bScope\.(make|extend|close|fork)\b' --type ts | head -40
rg -n 'Effect\.(acquireRelease|acquireUseRelease|forkScoped|fork|forkDaemon|withFiberRuntime)' --type ts | head -40

# Pipe / dual API
rg -n 'export const \w+: \{' --type ts | head -40   # often signals dual signature
rg -n 'dual\(' --type ts | head -40

# Branded types
rg -n '\bBrand\.(nominal|branded|refined|all)\b' --type ts | head -40

# Equality / hash
rg -n 'class .* implements Equal\.Equal\b' --type ts | head -20

# Internal module convention
fd '^internal$' --type d | head
```

Expected: each grep prints hits. The hits are the seed list of candidate patterns.

- [ ] **Step 2: Write `research/02-patterns-catalog.md` with the *headers only* (one section per pattern, no body yet)**

Required top-level structure:
```markdown
# Effect TS Patterns Catalog

> Source: `repos/effect/` pinned at `<PIN_SHA>` (see `book/00-toc.md`).
> Every pattern entry below cites a file path inside `repos/`. If a pattern has no citation, it is not yet verified — see the "Unverified" list at the bottom.

## How patterns are documented

Each pattern follows this fixed schema:

- **Name** — short canonical name
- **Signature** — TypeScript shape
- **Where it appears** — `repos/<path>:<line-range>`, with at least one cite
- **When to use / when not to**
- **Anti-pattern it replaces**
- **Related patterns** — links to other entries by name

## Index

- [Constructors](#constructors)
- [Effects](#effects)
- [Layers & Context](#layers--context)
- [Errors & Cause](#errors--cause)
- [Schema](#schema)
- [Streams & Concurrency](#streams--concurrency)
- [Resources & Scope](#resources--scope)
- [API style (pipeable, dual)](#api-style-pipeable-dual)
- [Data, Equal, Hash, Brand](#data-equal-hash-brand)
- [Module / file conventions](#module--file-conventions)

## Constructors

### `.make` constructor
### `.of` constructor
### `.from*` family

## Effects

### `Effect.gen` + `yield*`
### `Effect.runPromise` / `runSync` / `runFork`
### `Effect.fn` (named effect functions)

## Layers & Context

### `Layer.succeed`
### `Layer.effect`
### `Layer.scoped`
### `Layer.merge` and `Layer.provide`
### `Context.GenericTag`
### `Context.Tag` class
### `Effect.Service` class

## Errors & Cause

### `Data.TaggedError`
### `Cause` and the `Cause.fail` / `Cause.die` / `Cause.interrupt` distinction
### Catching by tag (`Effect.catchTag`, `Effect.catchTags`)

## Schema

### `Schema.Struct`
### `Schema.Class`
### `Schema.TaggedClass`
### `Schema.brand`
### `Schema.transform` / `transformOrFail`
### `Schema.filter`

## Streams & Concurrency

### `Stream.make` / `fromIterable`
### `Stream.async*` family
### `Effect.fork` / `forkDaemon` / `forkScoped`
### Structured concurrency via `Scope`

## Resources & Scope

### `Effect.acquireRelease`
### `Layer.scoped` (resource layers)
### `Scope.fork` for sub-scopes

## API style (pipeable, dual)

### Dual data-first / data-last (`dual(...)`)
### Pipeable trait
### `pipe` vs method chaining

## Data, Equal, Hash, Brand

### `Data.struct` / `Data.tuple` / `Data.array`
### `Data.Class` and `Data.TaggedClass`
### `Brand.nominal` / `Brand.refined`
### `Equal.equals` and the `Equal` interface

## Module / file conventions

### The `internal/` folder
### `index.ts` re-export shape
### `effect.dts` and dual ESM/CJS exports
### `JSDoc` `@since`, `@category`, `@example` tags

## Unverified (not yet cited)

- <pattern names surfaced by greps in Step 1 that don't yet have file:line citations>
```

Add or remove sections to match what Step 1 actually surfaced. Aim for 40–60 patterns total when the catalog is fully filled out (Tasks 8 and 9 do that).

- [ ] **Step 3: Sanity-check section count**

Run:
```bash
grep -cE '^### ' research/02-patterns-catalog.md
```

Expected: between 40 and 70. If under 40, you missed pattern families — go back to Step 1 and grep more broadly.

- [ ] **Step 4: Commit**

```bash
git add research/02-patterns-catalog.md
git commit -m "Patterns catalog pass 1: pattern names and section structure"
```

---

### Task 8: Patterns catalog Pass 2 — fill signatures and citations

**Files:**
- Modify: `research/02-patterns-catalog.md`

- [ ] **Step 1: For each `### <pattern>` section, fill in `**Signature**` and `**Where it appears**`**

For every pattern section in `research/02-patterns-catalog.md`, replace the empty body with:

```markdown
**Signature:**
```ts
<paste the actual signature from the source file>
```

**Where it appears:**
- `repos/effect/packages/<pkg>/src/<file>.ts:<startLine>-<endLine>` — <one-line note>
- `repos/effect/packages/<pkg>/src/<file>.ts:<startLine>-<endLine>` — <one-line note>
```

To find the signature for a pattern, e.g., `Layer.scoped`, run:
```bash
rg -nA3 '^export const scoped\b' repos/effect/packages/effect/src/Layer.ts
```

Then copy the function signature exactly. Cite the line range in the file.

Every pattern section needs at least one citation. If you can't find one, move the pattern to the "Unverified" list at the bottom rather than inventing.

- [ ] **Step 2: Verify every `### <pattern>` section has at least one `repos/` citation**

Run:
```bash
python3 - <<'PY'
import re, sys
text = open('research/02-patterns-catalog.md').read()
sections = re.split(r'^### ', text, flags=re.M)[1:]
missing = []
for s in sections:
    name = s.split('\n', 1)[0].strip()
    body = s.split('\n', 1)[1] if '\n' in s else ''
    # Stop at next "## " (top-level) section
    body = body.split('\n## ', 1)[0]
    if 'repos/' not in body and name not in ('(none)',):
        missing.append(name)
if missing:
    print("Patterns missing citations:")
    for m in missing:
        print(" -", m)
    sys.exit(1)
print("All patterns cited.")
PY
```

Expected: "All patterns cited." If anything is listed, either add the citation or move the pattern under "Unverified".

- [ ] **Step 3: Commit**

```bash
git add research/02-patterns-catalog.md
git commit -m "Patterns catalog pass 2: signatures and source citations"
```

---

### Task 9: Patterns catalog Pass 3 — fill when-to-use, anti-patterns, cross-refs

**Files:**
- Modify: `research/02-patterns-catalog.md`

- [ ] **Step 1: For each `### <pattern>` section, append the remaining schema fields**

For every pattern section, append below the Signature and Where-it-appears blocks:

```markdown
**When to use:** <2–4 sentences. Concrete situations.>

**When NOT to use:** <2–4 sentences. The other pattern that's better in adjacent situations.>

**Anti-pattern it replaces:** <The plain-JS-or-naive-TS thing it removes — concrete code shape if possible.>

**Related:** [Pattern Name 1](#pattern-name-1), [Pattern Name 2](#pattern-name-2)
```

Use the source files to verify your claims about behavior. If the source disagrees with your initial reading, source wins.

- [ ] **Step 2: Verify every section is complete**

Run:
```bash
python3 - <<'PY'
import re, sys
text = open('research/02-patterns-catalog.md').read()
sections = re.split(r'^### ', text, flags=re.M)[1:]
incomplete = []
required = ('Signature', 'Where it appears', 'When to use', 'When NOT to use', 'Anti-pattern it replaces', 'Related')
for s in sections:
    name = s.split('\n', 1)[0].strip()
    body = s.split('\n', 1)[1] if '\n' in s else ''
    body = body.split('\n## ', 1)[0]
    missing_fields = [r for r in required if r not in body]
    if missing_fields:
        incomplete.append((name, missing_fields))
if incomplete:
    print("Incomplete pattern sections:")
    for name, fields in incomplete:
        print(f" - {name}: missing {fields}")
    sys.exit(1)
print("All patterns complete.")
PY
```

Expected: "All patterns complete." Fix any incompletes before continuing.

- [ ] **Step 3: Verify every `Related: [Pattern Name](#anchor)` link resolves to a real anchor in the same file**

Run:
```bash
python3 - <<'PY'
import re, sys
text = open('research/02-patterns-catalog.md').read()
anchors = set()
for m in re.finditer(r'^### (.+)$', text, flags=re.M):
    name = m.group(1).strip()
    # GitHub-style anchor slug: lowercase, spaces->hyphens, drop punctuation
    slug = re.sub(r'[^\w\s-]', '', name.lower()).strip().replace(' ', '-')
    anchors.add(slug)
broken = []
for m in re.finditer(r'\]\(#([\w-]+)\)', text):
    if m.group(1) not in anchors:
        broken.append(m.group(1))
if broken:
    print("Broken intra-doc links:")
    for b in sorted(set(broken)):
        print(" -", b)
    sys.exit(1)
print("All cross-refs resolve.")
PY
```

Expected: "All cross-refs resolve." Fix broken links before committing.

- [ ] **Step 4: Commit**

```bash
git add research/02-patterns-catalog.md
git commit -m "Patterns catalog pass 3: when-to-use, anti-patterns, cross-refs"
```

---

### Task 10: Build the conventions doc (`research/03-conventions.md`)

**Files:**
- Create: `research/03-conventions.md`

- [ ] **Step 1: Survey the monorepo for the team's house style**

Run each:
```bash
# File layout: typical package shape
ls repos/effect/packages/effect/src | head -40
ls repos/effect/packages/effect/src/internal | head -40
test -d repos/effect/packages/effect/test && ls repos/effect/packages/effect/test | head -10

# index.ts re-export shape
head -60 repos/effect/packages/effect/src/index.ts

# JSDoc tag convention
rg -nB1 '^\s*\* @since' repos/effect/packages/effect/src/Effect.ts | head -30
rg -no '^\s*\* @[a-z]+' repos/effect/packages/effect/src/Effect.ts | sort -u

# Exports map and dual ESM/CJS
jq '.exports, .main, .module, .types, .type' repos/effect/packages/effect/package.json

# Test conventions
ls repos/effect/packages/effect/test 2>/dev/null | head -10
head -40 repos/effect/packages/effect/test/Effect.test.ts 2>/dev/null

# Versioning + release tooling
ls repos/effect/.changeset 2>/dev/null | head
cat repos/effect/.changeset/config.json 2>/dev/null

# Build config
cat repos/effect/packages/effect/tsconfig.json | head -40
ls repos/effect/packages/effect/build* 2>/dev/null
```

Read the output before writing.

- [ ] **Step 2: Write `research/03-conventions.md`**

Required sections:
```markdown
# Effect TS House Conventions

> Source: `repos/effect/packages/effect/` and a sample of sibling packages, pinned at `<PIN_SHA>`.

## Package layout

<src/, internal/, test/, build/, package.json — what each does, with citations>

## `index.ts` re-export shape

<Pattern: namespace re-exports vs. value re-exports vs. type-only re-exports. Cite a file.>

## JSDoc tags the team uses

<List every `@`-tag observed and what it means: @since, @category, @example, @internal, etc. Cite a file showing each.>

## Exports map (dual ESM/CJS)

<Show the `exports` field structure from `package.json` and what each entry maps to. Cite the package.json.>

## `internal/` folder

<What goes there, what doesn't, why it's not re-exported. Cite an example.>

## Naming conventions

<Constructor names (.make, .of, .from*), branded type names, error class names, layer names. Cite examples.>

## Test conventions

<Test framework (@effect/vitest), test file colocation, naming. Cite an example test file.>

## Release / versioning

<Changesets, semver policy, prerelease tagging.>
```

Every claim needs a `repos/...` citation.

- [ ] **Step 3: Verify every section has at least one citation**

Run:
```bash
python3 - <<'PY'
import re, sys
text = open('research/03-conventions.md').read()
sections = re.split(r'^## ', text, flags=re.M)[1:]
missing = []
for s in sections:
    name = s.split('\n', 1)[0].strip()
    body = s.split('\n', 1)[1] if '\n' in s else ''
    if 'repos/' not in body:
        missing.append(name)
if missing:
    print("Sections missing citations:", missing)
    sys.exit(1)
print("All sections cited.")
PY
```

Expected: "All sections cited."

- [ ] **Step 4: Commit**

```bash
git add research/03-conventions.md
git commit -m "Add Effect TS house conventions doc"
```

---

## Phase 3 — Per-package analysis

### Task 11: Define the per-package note template

**Files:**
- Create: `research/packages/_template.md`

- [ ] **Step 1: Write the template that every per-package note must follow**

Write to `research/packages/_template.md`:
```markdown
# <package-name>

> Source: `repos/effect/packages/<dir>/`, pinned at `<PIN_SHA>`.
> Tier: <core | platform | domain | tooling | experimental>
> Effect deps: <comma-separated, copied from research/01-package-inventory.md>

## What it does

<2–4 sentences. Concrete: who consumes it, what problem it solves, what it would look like without this package.>

## Public API surface

<Top-level modules and their main exports. One bullet per module. Group by purpose, not alphabetically. Cite `repos/.../src/<file>.ts`.>

## Patterns used

<Bulleted list. Each bullet links to research/02-patterns-catalog.md by anchor.>

- [Pattern Name](../02-patterns-catalog.md#pattern-name) — <one-line note on how this package uses it>

## What's unique about this package's design

<2–5 sentences. The thing this package teaches that no other package teaches. Concrete and citation-backed.>

## Conventions observed

<File layout, naming, error shape, anything that diverges from research/03-conventions.md.>

## "If you were authoring something similar, copy this"

<Bulleted list of specific design decisions worth stealing, each with a citation.>

## Open questions

<Things you noticed but couldn't fully answer. May seed the worked-example or later research.>
```

- [ ] **Step 2: Commit**

```bash
git add research/packages/_template.md
git commit -m "Add per-package research note template"
```

---

### Task 12: Write per-package research notes

This task fans out: one note per package row from `research/01-package-inventory.md`. Each note follows the template from Task 11. Notes are independent and can be written in parallel by separate subagents.

**Files:**
- Create: `research/packages/<name>.md` for every package in the inventory.

- [ ] **Step 1: Build the worklist**

Run:
```bash
ls -d repos/effect/packages/*/ | xargs -n1 basename | sort > /tmp/pkg-worklist.txt
cat /tmp/pkg-worklist.txt
```

This is the canonical worklist. Each line is one note to produce. The note filename is the package directory name with `.md` (e.g., `effect/` → `research/packages/effect.md`, `platform-node/` → `research/packages/platform-node.md`).

- [ ] **Step 2: For each package in the worklist, write `research/packages/<name>.md` using the template**

For each package directory `repos/effect/packages/<name>/`:

  1. Copy `research/packages/_template.md` to `research/packages/<name>.md`.
  2. Replace `<package-name>` with the npm name from `package.json`.
  3. Replace `<dir>` with the directory name.
  4. Replace `<PIN_SHA>` with the SHA from `book/00-toc.md`.
  5. Fill `Tier` and `Effect deps` from the row in `research/01-package-inventory.md`.
  6. Write the prose. Every claim cites a file inside `repos/`. If unsure, mark as an "Open question" rather than guessing.
  7. Cross-link patterns to anchors in `research/02-patterns-catalog.md`.

Word target: 500–1500 words per note. Bigger packages (`effect`, `@effect/platform`, `@effect/sql`) trend higher.

**Subagent dispatch hint (if executing via subagent-driven-development):** dispatch one subagent per package. Self-contained briefing per subagent: package directory path, the template path, the inventory file path, the patterns catalog path, and the requirement that every claim cite a file in `repos/`.

- [ ] **Step 3: Verify every package in the worklist has a note**

Run:
```bash
ls research/packages/*.md | grep -v '_template.md' | xargs -n1 basename | sed 's/\.md$//' | sort > /tmp/notes-actual.txt
diff /tmp/pkg-worklist.txt /tmp/notes-actual.txt
```

Expected: empty diff.

- [ ] **Step 4: Verify every note has at least one `repos/` citation and one cross-ref into the patterns catalog**

Run:
```bash
python3 - <<'PY'
import os, sys
bad = []
for f in sorted(os.listdir('research/packages')):
    if f == '_template.md' or not f.endswith('.md'):
        continue
    body = open(f'research/packages/{f}').read()
    if 'repos/' not in body:
        bad.append((f, 'no citation'))
    if '../02-patterns-catalog.md#' not in body:
        bad.append((f, 'no pattern cross-ref'))
if bad:
    for f, why in bad:
        print(f, '-', why)
    sys.exit(1)
print("All notes cite source and reference the patterns catalog.")
PY
```

Expected: success line printed.

- [ ] **Step 5: Commit**

If notes were produced one-by-one:
```bash
git add research/packages/
git commit -m "Add per-package research notes for all monorepo packages"
```

If notes were produced via parallel subagents, commit after each batch instead of one bulk commit:
```bash
git add research/packages/<batch-of-files>
git commit -m "Add per-package notes: <batch list>"
```

---

## Phase 4 — Outline & user review

### Task 13: Synthesize the Table of Contents

**Files:**
- Modify: `book/00-toc.md` (currently a stub from Task 4)

- [ ] **Step 1: Replace the stub `book/00-toc.md` with the full TOC**

Required structure:
```markdown
# Table of Contents

> **Effect TS source pinned to:** tag `<PIN_TAG>` at SHA `<PIN_SHA>`.
> All chapter citations reference file paths inside that snapshot.

## Reading paths

- **Linear:** Part I → Part II → Part III, in number order.
- **By goal:** see "Reading paths by goal" below.
- **Reference:** [Glossary](00-glossary.md), [Cheatsheet](00-cheatsheet.md), [Patterns Catalog](../research/02-patterns-catalog.md).

## Part I — Foundations

| # | Title | Slug | Patterns introduced |
|---|-------|------|---------------------|
| 01 | Why Effect | `01-why-effect` | — |
| 02 | Effect as a value | `02-effect-as-a-value` | [Effect.gen](...), [Pipeable](...) |
| ... | ... | ... | ... |

## Part II — Package tours

Tour ordering: use-case interest (simpler / more satisfying packages first), not strict dep depth. See `research/04-dependency-graph.md` for the depth ordering we are *not* following.

| # | Title | Slug | Package | New patterns |
|---|-------|------|---------|--------------|
| 19 | Building a CLI with @effect/cli | `19-cli` | `@effect/cli` | ... |
| ... | ... | ... | ... | ... |

## Part III — Authoring (with worked example `effect-cache`)

Each chapter corresponds to one commit in `worked-example/` (its own fresh git repo, initialized at the start of Task 46).

| # | Title | Slug | What gets committed |
|---|-------|------|---------------------|
| 46 | Designing the public API | `46-public-api` | `src/index.ts`, `src/Cache.ts` (Tag, .make stub) |
| ... | ... | ... | ... |

## Reading paths by goal

- **"I want to write a backend service":** Part I → Part II tours of `@effect/platform`, `@effect/sql`, `@effect/rpc` → Part III.
- **"I want to write a CLI":** Part I → Part II tour of `@effect/cli`, `@effect/printer` → Part III.
- **"I want to author a library":** Part I → Part III. Part II is reference, not required reading.
```

Build the chapter rows from `research/01-package-inventory.md`, `research/02-patterns-catalog.md`, and the spec's tentative chapter list. Every Part I chapter should reference at least one pattern from the catalog. Every Part II chapter should reference one or more packages from the inventory.

- [ ] **Step 2: Verify every Part I chapter references a real pattern, and every Part II chapter references a real package**

Run:
```bash
python3 - <<'PY'
import re, sys
toc = open('book/00-toc.md').read()
catalog = open('research/02-patterns-catalog.md').read()
inventory = open('research/01-package-inventory.md').read()

catalog_anchors = set(re.findall(r'^### (.+)$', catalog, flags=re.M))
inventory_pkgs = set(re.findall(r'\| (effect|@effect/[a-z0-9-]+) \|', inventory))

issues = []

# Part I rows mention at least one bracketed pattern link
in_part1 = False
in_part2 = False
for line in toc.splitlines():
    if line.startswith('## Part I'):
        in_part1, in_part2 = True, False
        continue
    if line.startswith('## Part II'):
        in_part1, in_part2 = False, True
        continue
    if line.startswith('## '):
        in_part1 = in_part2 = False
        continue
    if in_part1 and re.match(r'\| \d+ \|', line):
        if not re.search(r'\[[^\]]+\]', line):
            issues.append(('Part I chapter has no pattern link', line.strip()))
    if in_part2 and re.match(r'\| \d+ \|', line):
        cells = [c.strip() for c in line.strip().strip('|').split('|')]
        if len(cells) >= 4:
            pkg = cells[3]
            if pkg and pkg not in inventory_pkgs:
                issues.append(('Part II references unknown package', pkg))

if issues:
    for kind, det in issues:
        print(kind, '::', det)
    sys.exit(1)
print("TOC sanity check passed.")
PY
```

Expected: "TOC sanity check passed." Fix any issues.

- [ ] **Step 3: Commit**

```bash
git add book/00-toc.md
git commit -m "Write full Table of Contents (Parts I, II, III)"
```

---

### Task 14: Build the glossary (`book/00-glossary.md`)

**Files:**
- Create: `book/00-glossary.md`

- [ ] **Step 1: Write the glossary**

Required structure:
```markdown
# Glossary

> Every term used in the book. Each entry: short definition + chapter where introduced + pattern link.

| Term | Definition | Introduced in | Pattern |
|------|------------|---------------|---------|
| Effect | A description of a computation that may fail with `E`, succeed with `A`, and require services `R`. | [Ch. 02](part-1-foundations/02-effect-as-a-value.md) | — |
| Layer | A description of how to build a service of type `R` from other services. | [Ch. 09](part-1-foundations/09-layer.md) | [Layer.succeed](../research/02-patterns-catalog.md#layersucceed) |
| ... | ... | ... | ... |
```

Pull terms from `research/02-patterns-catalog.md` headers and from any other named concept that appears in `book/00-toc.md`.

- [ ] **Step 2: Verify every pattern in the catalog appears in the glossary**

Run:
```bash
python3 - <<'PY'
import re, sys
catalog = open('research/02-patterns-catalog.md').read()
glossary = open('book/00-glossary.md').read()
patterns = re.findall(r'^### (.+)$', catalog, flags=re.M)
missing = [p for p in patterns if p not in glossary]
if missing:
    print("Patterns not in glossary:")
    for m in missing:
        print(" -", m)
    sys.exit(1)
print("Glossary covers all patterns.")
PY
```

Expected: "Glossary covers all patterns."

- [ ] **Step 3: Commit**

```bash
git add book/00-glossary.md
git commit -m "Build glossary linking terms to chapters and patterns"
```

---

### Task 15: Build the cheatsheet (`book/00-cheatsheet.md`)

**Files:**
- Create: `book/00-cheatsheet.md`

- [ ] **Step 1: Write a single-page reference**

Required structure:
```markdown
# Cheatsheet

> One-page reference. Skim this before opening a chapter.

## Constructors

```ts
// .make pattern
const Foo = { make: (init: Init) => Effect.succeed(new Foo(init)) }
```

## Effect.gen

```ts
const program = Effect.gen(function* () {
  const x = yield* serviceA
  const y = yield* Effect.tryPromise(() => fetch(x.url))
  return y
})
```

## Layer.succeed / .effect / .scoped

```ts
const ALive = Layer.succeed(A, { ... })
const ALiveEff = Layer.effect(A, Effect.gen(function* () { ... }))
const ALiveScoped = Layer.scoped(A, Effect.acquireRelease(acquire, release))
```

## Errors

```ts
class NotFound extends Data.TaggedError("NotFound")<{ id: string }> {}

Effect.catchTag("NotFound", (e) => Effect.succeed(default))
```

## Schema

```ts
const User = Schema.Struct({ id: Schema.String.pipe(Schema.brand("UserId")), name: Schema.String })
type User = Schema.Schema.Type<typeof User>
```

## Stream

```ts
Stream.fromIterable([1, 2, 3]).pipe(Stream.map((n) => n * 2), Stream.runCollect)
```

## Patterns index

| Pattern | Where to read |
|---------|---------------|
| .make constructor | [Ch. 11](part-1-foundations/11-constructors.md) · [Catalog](../research/02-patterns-catalog.md#make-constructor) |
| ... | ... |
```

Choose ~10–15 of the most-used patterns. The goal is "skim before reading," not exhaustive.

- [ ] **Step 2: Commit**

```bash
git add book/00-cheatsheet.md
git commit -m "Add one-page cheatsheet"
```

---

### Task 16: User review gate (the gate that ends Phase 4)

**Files:**
- Create: `book/README.md`

- [ ] **Step 1: Write `book/README.md`**

Write to `book/README.md`:
```markdown
# The Effect TS Book

Start at [Table of Contents](00-toc.md).

- [Glossary](00-glossary.md)
- [Cheatsheet](00-cheatsheet.md)
- [Patterns Catalog (research)](../research/02-patterns-catalog.md)
- [Per-package research notes](../research/packages/)

The book is pinned to a specific Effect TS commit; see the TOC for the SHA.
```

- [ ] **Step 2: Commit**

```bash
git add book/README.md
git commit -m "Add book README pointing at TOC"
```

- [ ] **Step 3: Print the review summary for the user**

Output the following message (do not commit it; this is for the user, not the repo):

> Phases 1–4 are complete. Please review:
>
> - **`book/00-toc.md`** — the chapter-by-chapter outline. This is the most important review. Restructuring is cheap now and expensive once chapters are written.
> - **`book/00-glossary.md`** and **`book/00-cheatsheet.md`** — the supporting reference docs.
> - **`research/02-patterns-catalog.md`** — the pattern vocabulary the book is built on. Skim for missing patterns or odd framings.
> - **`research/packages/`** — per-package notes. Skim a couple to spot-check accuracy.
>
> Once you approve the TOC, I will write a separate Phase 5 plan that breaks the ~60 chapters and the `worked-example/` package into bite-sized tasks.

- [ ] **Step 4: Wait for user approval**

Do not start Phase 5. Do not start writing chapters. The Phase 5 plan is written *after* the user signs off on the TOC.

---

## Self-Review (writer's note)

Coverage check against the spec (`docs/superpowers/specs/2026-04-28-effect-ts-book-design.md`):

- ✅ Phase 1 — clone repos, pin Effect-TS/effect to a SHA, record SHA in book artifacts (Tasks 1–4)
- ✅ Phase 2 — package inventory, dependency graph, patterns catalog (3-pass), conventions doc (Tasks 5–10)
- ✅ Phase 3 — per-package notes with template, verification of coverage and citations (Tasks 11–12)
- ✅ Phase 4 — TOC, glossary, cheatsheet, README, and explicit user review gate (Tasks 13–16)
- ✅ Pinning policy honored (recorded in `book/00-toc.md` and `clone-log.md`)
- ✅ Experimental packages included (Task 12 fans out across every directory in `repos/effect/packages/`)
- ✅ Patterns catalog optimized as primary artifact (gets three dedicated tasks; per-package notes built on top of it)
- ✅ Quality gate "every claim cites a `repos/` path" enforced by Python verifier scripts in Tasks 8, 9, 10, 12
- ✅ Frequent commits — every task ends with a commit
- ✅ Out-of-scope (Phase 5 chapter writing + worked-example package) explicitly deferred to a follow-up plan

Type/name consistency:
- `<PIN_TAG>` and `<PIN_SHA>` used uniformly across tasks 4, 5, 7, 11.
- File paths consistent: `research/02-patterns-catalog.md`, `research/packages/<name>.md`, `book/00-toc.md`, `book/00-glossary.md`, `book/00-cheatsheet.md`.
- Per-package note template in Task 11 matches the schema referenced by Task 12's verifier.

No placeholders for the engineer to fill in: every step has the exact command or the exact file content. The few `<placeholders>` that exist (`<PIN_TAG>`, `<PIN_SHA>`, `<PINS>` etc.) are values discovered at runtime in the same task that uses them.

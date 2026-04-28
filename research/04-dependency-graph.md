# Dependency Graph

> Source: `repos/effect/packages/*/package.json` and `repos/effect/packages/ai/*/package.json`. Includes BOTH `dependencies` and `peerDependencies` (the monorepo prefers peer deps for Effect siblings).
> Pinned at `39c934c1476be389f7469433910fdf30fc4dad82` (see `book/00-toc.md`).

## Edge list

Format: `<dependent> -> <dependency>`. Total edges: 121.

```
@effect/ai -> @effect/experimental
@effect/ai -> @effect/platform
@effect/ai -> @effect/rpc
@effect/ai -> effect
@effect/ai-amazon-bedrock -> @effect/ai
@effect/ai-amazon-bedrock -> @effect/ai-anthropic
@effect/ai-amazon-bedrock -> @effect/experimental
@effect/ai-amazon-bedrock -> @effect/platform
@effect/ai-amazon-bedrock -> effect
@effect/ai-anthropic -> @effect/ai
@effect/ai-anthropic -> @effect/experimental
@effect/ai-anthropic -> @effect/platform
@effect/ai-anthropic -> effect
@effect/ai-google -> @effect/ai
@effect/ai-google -> @effect/experimental
@effect/ai-google -> @effect/platform
@effect/ai-google -> effect
@effect/ai-openai -> @effect/ai
@effect/ai-openai -> @effect/experimental
@effect/ai-openai -> @effect/platform
@effect/ai-openai -> effect
@effect/ai-openrouter -> @effect/ai
@effect/ai-openrouter -> @effect/experimental
@effect/ai-openrouter -> @effect/platform
@effect/ai-openrouter -> effect
@effect/cli -> @effect/platform
@effect/cli -> @effect/printer
@effect/cli -> @effect/printer-ansi
@effect/cli -> effect
@effect/cluster -> @effect/platform
@effect/cluster -> @effect/rpc
@effect/cluster -> @effect/sql
@effect/cluster -> @effect/workflow
@effect/cluster -> effect
@effect/experimental -> @effect/platform
@effect/experimental -> effect
@effect/opentelemetry -> @effect/platform
@effect/opentelemetry -> effect
@effect/platform -> effect
@effect/platform-browser -> @effect/platform
@effect/platform-browser -> effect
@effect/platform-bun -> @effect/cluster
@effect/platform-bun -> @effect/platform
@effect/platform-bun -> @effect/platform-node-shared
@effect/platform-bun -> @effect/rpc
@effect/platform-bun -> @effect/sql
@effect/platform-bun -> effect
@effect/platform-node -> @effect/cluster
@effect/platform-node -> @effect/platform
@effect/platform-node -> @effect/platform-node-shared
@effect/platform-node -> @effect/rpc
@effect/platform-node -> @effect/sql
@effect/platform-node -> effect
@effect/platform-node-shared -> @effect/cluster
@effect/platform-node-shared -> @effect/platform
@effect/platform-node-shared -> @effect/rpc
@effect/platform-node-shared -> @effect/sql
@effect/platform-node-shared -> effect
@effect/printer -> @effect/typeclass
@effect/printer -> effect
@effect/printer-ansi -> @effect/printer
@effect/printer-ansi -> @effect/typeclass
@effect/printer-ansi -> effect
@effect/rpc -> @effect/platform
@effect/rpc -> effect
@effect/sql -> @effect/experimental
@effect/sql -> @effect/platform
@effect/sql -> effect
@effect/sql-clickhouse -> @effect/experimental
@effect/sql-clickhouse -> @effect/platform
@effect/sql-clickhouse -> @effect/platform-node
@effect/sql-clickhouse -> @effect/sql
@effect/sql-clickhouse -> effect
@effect/sql-d1 -> @effect/experimental
@effect/sql-d1 -> @effect/platform
@effect/sql-d1 -> @effect/sql
@effect/sql-d1 -> effect
@effect/sql-drizzle -> @effect/sql
@effect/sql-drizzle -> effect
@effect/sql-kysely -> @effect/sql
@effect/sql-kysely -> effect
@effect/sql-libsql -> @effect/experimental
@effect/sql-libsql -> @effect/platform
@effect/sql-libsql -> @effect/sql
@effect/sql-libsql -> effect
@effect/sql-mssql -> @effect/experimental
@effect/sql-mssql -> @effect/platform
@effect/sql-mssql -> @effect/sql
@effect/sql-mssql -> effect
@effect/sql-mysql2 -> @effect/experimental
@effect/sql-mysql2 -> @effect/platform
@effect/sql-mysql2 -> @effect/sql
@effect/sql-mysql2 -> effect
@effect/sql-pg -> @effect/experimental
@effect/sql-pg -> @effect/platform
@effect/sql-pg -> @effect/sql
@effect/sql-pg -> effect
@effect/sql-sqlite-bun -> @effect/experimental
@effect/sql-sqlite-bun -> @effect/platform
@effect/sql-sqlite-bun -> @effect/sql
@effect/sql-sqlite-bun -> effect
@effect/sql-sqlite-do -> @effect/experimental
@effect/sql-sqlite-do -> @effect/sql
@effect/sql-sqlite-do -> effect
@effect/sql-sqlite-node -> @effect/experimental
@effect/sql-sqlite-node -> @effect/platform
@effect/sql-sqlite-node -> @effect/sql
@effect/sql-sqlite-node -> effect
@effect/sql-sqlite-react-native -> @effect/experimental
@effect/sql-sqlite-react-native -> @effect/sql
@effect/sql-sqlite-react-native -> effect
@effect/sql-sqlite-wasm -> @effect/experimental
@effect/sql-sqlite-wasm -> @effect/sql
@effect/sql-sqlite-wasm -> @effect/wa-sqlite
@effect/sql-sqlite-wasm -> effect
@effect/typeclass -> effect
@effect/vitest -> effect
@effect/workflow -> @effect/experimental
@effect/workflow -> @effect/platform
@effect/workflow -> @effect/rpc
@effect/workflow -> effect
```

## Tier ordering (depth from `effect`)

Depth = longest dependency chain back to the core `effect` package. Lower = closer to the foundation.

- **Depth 0:** effect
- **Depth 1:** @effect/platform, @effect/typeclass, @effect/vitest
- **Depth 2:** @effect/experimental, @effect/opentelemetry, @effect/platform-browser, @effect/printer, @effect/rpc
- **Depth 3:** @effect/ai, @effect/printer-ansi, @effect/sql, @effect/workflow
- **Depth 4:** @effect/ai-anthropic, @effect/ai-google, @effect/ai-openai, @effect/ai-openrouter, @effect/cli, @effect/cluster, @effect/sql-d1, @effect/sql-drizzle, @effect/sql-kysely, @effect/sql-libsql, @effect/sql-mssql, @effect/sql-mysql2, @effect/sql-pg, @effect/sql-sqlite-bun, @effect/sql-sqlite-do, @effect/sql-sqlite-node, @effect/sql-sqlite-react-native, @effect/sql-sqlite-wasm
- **Depth 5:** @effect/ai-amazon-bedrock, @effect/platform-node-shared
- **Depth 6:** @effect/platform-bun, @effect/platform-node
- **Depth 7:** @effect/sql-clickhouse
- **Unreachable (depth -1):** @effect/wa-sqlite — listed as a dependency of `@effect/sql-sqlite-wasm` but is not itself an Effect-namespace package and has no path back to `effect` via the collected edges.

## Notes

- **DAG status: acyclic.** `tsort` exits 0 with no cycle warnings. No self-edges found. The graph is a valid DAG.
- **Most edges are peerDependencies.** Nearly all Effect sibling references appear under `peerDependencies`, not `dependencies`. Runtime `dependencies` contain only third-party packages (e.g., `@parcel/watcher`, `ws`, `@clickhouse/client`). A graph built from `dependencies` alone would have almost no internal edges.
- **`@effect/cluster` is surprisingly deep at depth 4.** It peers against `@effect/sql` and `@effect/workflow`, which themselves depend on `@effect/experimental` and `@effect/rpc`. This places `cluster` deeper than it might appear — it depends on the full persistence + workflow stack.
- **`@effect/platform-node-shared` at depth 5, deeper than `@effect/platform-node` (depth 6).** This is counterintuitive by name, but `platform-node-shared` peers against `@effect/cluster`, `@effect/sql`, and `@effect/workflow` — the same high-level set as `platform-node`. However, `platform-node` additionally peers against `@effect/platform-node-shared`, pushing it one level deeper.
- **`@effect/sql-clickhouse` is the deepest package at depth 7.** It peers against `@effect/platform-node` (depth 6), making it the highest-level leaf in the graph. Part II ordering should treat it as a late chapter.
- **`@effect/ai-amazon-bedrock` has an unusual cross-AI dependency on `@effect/ai-anthropic`.** Bedrock supports Claude models and reuses Anthropic's message format types, explaining this direct sibling dependency at the provider level.
- **`@effect/wa-sqlite` is an external package** (third-party WebAssembly SQLite binding) listed in `@effect/sql-sqlite-wasm`'s dependencies but not itself in the Effect namespace. It appears as a node in the graph because it is an Edge target, not because it is an Effect package.
- **Part II tour ordering implication:** The depth tiers suggest a natural bottom-up reading order: `effect` → `platform` / `typeclass` → `experimental` / `rpc` / `printer` → `sql` / `workflow` / `ai` → driver-level sql packages → `cluster` → `platform-node` / `platform-bun` → `sql-clickhouse`. The spec notes that use-case interest may override strict depth order, but these tiers provide a useful sanity check.

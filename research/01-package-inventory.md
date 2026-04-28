# Package Inventory

> Source: `repos/effect/packages/*/package.json`, snapshot pinned at `39c934c1476be389f7469433910fdf30fc4dad82` (see `book/00-toc.md`).

## How to read this

| Column | Meaning |
|--------|---------|
| Package | npm name (`effect`, `@effect/xxx`) |
| Tier | core / platform / domain / tooling / experimental |
| Purpose | one-line summary |
| Effect deps | other Effect packages it imports (runtime `dependencies` only; peer deps noted separately where relevant) |
| Novelty | what this package teaches that others don't |
| Source | `repos/effect/packages/<dir>/` |

> **Note on `ai` directory**: `repos/effect/packages/ai/` is a container with no top-level `package.json`. It holds six sub-packages (`ai`, `anthropic`, `amazon-bedrock`, `google`, `openai`, `openrouter`) each in its own sub-directory. All six are listed individually below.
>
> **Note on Effect deps column**: Most packages declare `effect` and sibling `@effect/*` packages as `peerDependencies`, not `dependencies`. The column shows runtime `dependencies` only (per task spec). Where all Effect relations are peers, the cell reads `(peers only)`.

## Inventory

| Package | Tier | Purpose | Effect deps | Novelty | Source |
|---------|------|---------|-------------|---------|--------|
| `effect` | core | The Effect runtime: the `Effect` type, `Layer`, `Context`, `Schema`, `Stream`, `Fiber`, `STM`, `Queue`, `Schedule`, `Config`, and the full standard library for TypeScript | (none) | Everything foundational — every other package builds on this | `repos/effect/packages/effect/` |
| `@effect/typeclass` | core | Algebraic typeclass abstractions (`Functor`, `Monad`, `Monoid`, `Applicative`, etc.) encoded in Effect style for use across the ecosystem | (peers only) | Teaches the typeclass encoding pattern used in Effect; entry point for understanding principled abstraction composition | `repos/effect/packages/typeclass/` |
| `@effect/platform` | platform | Runtime-agnostic interfaces for HTTP client/server, file system, shell commands, key-value store, workers, and WebSockets — implemented by each platform package | (peers only) | Shows how to write portable, testable services against abstract platform capabilities; the canonical Effect service-interface pattern | `repos/effect/packages/platform/` |
| `@effect/platform-node` | platform | Node.js implementations of `@effect/platform` interfaces: HTTP server/client (via `node:http`), file system, subprocess execution, sockets, workers | `@effect/platform-node-shared` | Node-specific wiring: how the abstract platform interfaces map to Node.js built-ins | `repos/effect/packages/platform-node/` |
| `@effect/platform-bun` | platform | Bun runtime implementations of `@effect/platform` interfaces: HTTP server/client, file system, sockets, workers, using Bun's native APIs | `@effect/platform-node-shared` | Bun-specific wiring; also demonstrates how a new runtime target is added with minimal duplication via shared internals | `repos/effect/packages/platform-bun/` |
| `@effect/platform-browser` | platform | Browser implementations of `@effect/platform` interfaces: `fetch`-based HTTP client, `localStorage`/`sessionStorage` key-value store, browser workers, WebSockets | (peers only) | Browser-specific constraints (no FS, no subprocess); teaches how to write browser-safe Effect services | `repos/effect/packages/platform-browser/` |
| `@effect/platform-node-shared` | platform | Internal shared Node.js/Bun primitives (file system, streams, sockets, command execution) reused by both `@effect/platform-node` and `@effect/platform-bun` | (peers only) | Illustrates code-sharing between runtime targets via an internal shared package; not intended for direct use | `repos/effect/packages/platform-node-shared/` |
| `@effect/sql` | domain | Core SQL abstraction layer: `SqlClient` service, `Statement` DSL, `SqlResolver` (batching/caching), `SqlSchema`, migrations, and streaming queries | (peers only) | The generic Effect SQL pattern — parameterized clients, type-safe statements, N+1 solving with `SqlResolver` | `repos/effect/packages/sql/` |
| `@effect/sql-pg` | domain | PostgreSQL driver adapter built on `postgres` (npm); implements `@effect/sql`'s `SqlClient` for Postgres | (peers only) | Postgres driver implementation pattern: connection pooling, `COPY`, `LISTEN/NOTIFY` in Effect style | `repos/effect/packages/sql-pg/` |
| `@effect/sql-mysql2` | domain | MySQL driver adapter built on `mysql2`; implements `@effect/sql`'s `SqlClient` for MySQL | (peers only) | MySQL-specific driver wiring; shows parameter encoding differences vs Postgres | `repos/effect/packages/sql-mysql2/` |
| `@effect/sql-mssql` | domain | Microsoft SQL Server driver adapter using `tedious`; implements `@effect/sql`'s `SqlClient` for MSSQL, including stored procedures | (peers only) | MSSQL-specific concerns: stored procedure support (`Procedure`), `Parameter` type mapping | `repos/effect/packages/sql-mssql/` |
| `@effect/sql-sqlite-node` | domain | SQLite driver for Node.js using `better-sqlite3`; synchronous I/O wrapped in Effect's fiber model | (peers only) | Synchronous native SQLite in Effect — how to safely wrap a blocking synchronous driver | `repos/effect/packages/sql-sqlite-node/` |
| `@effect/sql-sqlite-bun` | domain | SQLite driver for Bun using Bun's built-in SQLite API | (peers only) | Bun-native SQLite integration; contrasts with Node's `better-sqlite3` approach | `repos/effect/packages/sql-sqlite-bun/` |
| `@effect/sql-sqlite-wasm` | domain | SQLite in WebAssembly (via `@sqlite.org/sqlite-wasm`), with optional OPFS (Origin Private File System) persistence for the browser | (peers only) | Browser-native persistent SQLite; demonstrates OPFS worker pattern and WASM integration | `repos/effect/packages/sql-sqlite-wasm/` |
| `@effect/sql-sqlite-do` | domain | SQLite driver for Cloudflare Durable Objects (`SqlStorage` API); brings `@effect/sql` to the Cloudflare Workers edge | (peers only) | Edge-runtime SQL: how Cloudflare's `SqlStorage` maps to the Effect SQL abstraction | `repos/effect/packages/sql-sqlite-do/` |
| `@effect/sql-sqlite-react-native` | domain | SQLite driver for React Native using `expo-sqlite` or `react-native-quick-sqlite` | (peers only) | Mobile-platform SQL: integrating Effect with React Native's async SQLite bindings | `repos/effect/packages/sql-sqlite-react-native/` |
| `@effect/sql-clickhouse` | domain | ClickHouse analytics database client for Effect, including migrations | (peers only) | Columnar/analytics DB driver pattern; shows how `@effect/sql` extends to non-relational-SQL engines | `repos/effect/packages/sql-clickhouse/` |
| `@effect/sql-libsql` | domain | libSQL (Turso) driver for Effect — the SQLite-compatible distributed database | (peers only) | Turso/libSQL remote connection pattern; demonstrates Effect with edge-hosted SQLite forks | `repos/effect/packages/sql-libsql/` |
| `@effect/sql-d1` | domain | Cloudflare D1 (SQLite-compatible) driver for Effect | (peers only) | D1 edge database integration; contrasts with `sql-sqlite-do` (both Cloudflare, different APIs) | `repos/effect/packages/sql-d1/` |
| `@effect/sql-drizzle` | domain | Drizzle ORM integration for `@effect/sql` — lets you use Drizzle's query builder with Effect's SQL client | (peers only) | ORM integration pattern: running Drizzle builders through Effect's `SqlClient` without losing type safety | `repos/effect/packages/sql-drizzle/` |
| `@effect/sql-kysely` | domain | Kysely query builder integration for `@effect/sql` — runs Kysely queries through Effect's SQL client for Postgres, MySQL, MSSQL, and SQLite | (peers only) | Query-builder integration pattern: Kysely as the DSL layer on top of Effect's SQL abstraction | `repos/effect/packages/sql-kysely/` |
| `@effect/rpc` | domain | Type-safe RPC framework: define request/response schemas once, generate both client and server, with pluggable transport (HTTP, WebSocket, Worker) | (peers only) | Schema-first RPC: how to derive a full client/server protocol from a single `RpcGroup` definition | `repos/effect/packages/rpc/` |
| `@effect/cluster` | domain | Actor-model distributed clustering: entity sharding, message routing, cron jobs, cluster-aware workflow execution across nodes | (peers only) | Distributed systems primitives in Effect — entity lifecycle, message delivery guarantees, K8s-aware HTTP runner | `repos/effect/packages/cluster/` |
| `@effect/workflow` | domain | Durable workflow engine: Activities with automatic retry/idempotency, `DurableClock`, `DurableDeferred`, `DurableQueue` — persisted via `@effect/sql` | (peers only) | Long-running durable execution: how to build Temporal-style workflows natively in Effect | `repos/effect/packages/workflow/` |
| `@effect/ai` | domain | Provider-agnostic AI abstractions: `LanguageModel`, `EmbeddingModel`, `Tool`, `Toolkit`, MCP server integration — the shared interface layer for all AI providers | (peers only) | Effect's AI abstraction pattern: swap providers without changing business logic; also covers MCP (Model Context Protocol) server building | `repos/effect/packages/ai/ai/` |
| `@effect/ai-anthropic` | domain | Anthropic Claude provider for `@effect/ai`: Claude language model, tokenizer, tool calling, streaming | (peers only) | Anthropic-specific implementation: SSE streaming, tool-use protocol, token counting via the Anthropic API | `repos/effect/packages/ai/anthropic/` |
| `@effect/ai-openai` | domain | OpenAI provider for `@effect/ai`: GPT language model, embeddings, tokenizer, tool calling, streaming | (peers only) | OpenAI-specific implementation: `tiktoken` tokenization, function calling, embedding model pattern | `repos/effect/packages/ai/openai/` |
| `@effect/ai-google` | domain | Google Gemini provider for `@effect/ai`: Gemini language model, tool calling | (peers only) | Google-specific implementation: Gemini API schema, tool calling via Google's protocol | `repos/effect/packages/ai/google/` |
| `@effect/ai-amazon-bedrock` | domain | Amazon Bedrock provider for `@effect/ai`: multi-model gateway (including Claude-on-Bedrock), event stream encoding | (peers only) | AWS Bedrock multi-model routing; demonstrates `EventStreamEncoding` for AWS streaming protocol | `repos/effect/packages/ai/amazon-bedrock/` |
| `@effect/ai-openrouter` | domain | OpenRouter provider for `@effect/ai`: routes requests to 200+ models via the OpenRouter API | (peers only) | OpenRouter as aggregator; shows how to target a meta-provider rather than a single model vendor | `repos/effect/packages/ai/openrouter/` |
| `@effect/experimental` | experimental | Incubator for features not yet stable: `Machine` (actor FSM), `PersistedCache`, `PersistedQueue`, `EventLog`, `DevTools`, `RateLimiter` | (peers only) | Pre-stable patterns — the best place to see what Effect's future API surface looks like before it graduates to `effect` or a domain package | `repos/effect/packages/experimental/` |
| `@effect/opentelemetry` | tooling | OpenTelemetry integration: exports Effect spans/metrics/logs to OTLP; includes `NodeSdk`, `WebSdk`, OTLP tracer, metrics, and logger | (peers only) | How to wire Effect's built-in tracing and metrics to the OpenTelemetry ecosystem | `repos/effect/packages/opentelemetry/` |
| `@effect/cli` | tooling | Framework for building fully-featured CLI applications: commands, subcommands, options, arguments, prompts, auto-complete, help text, config file support | (peers only) | CLI construction in Effect style: declarative command trees, `Args`/`Options` as typed schemas, built-in `--help` and shell completion | `repos/effect/packages/cli/` |
| `@effect/printer` | tooling | Wadler/Lindig pretty-printing algebra in Effect style: `Doc` combinators, layout algorithms, page-width-aware rendering | (peers only) | The algebra-of-pretty-printing approach: teaches how to build a layout engine from composable `Doc` primitives | `repos/effect/packages/printer/` |
| `@effect/printer-ansi` | tooling | ANSI terminal color/styling extension for `@effect/printer`: `Ansi` annotations, colored `AnsiDoc`, terminal-aware rendering | `@effect/printer` | ANSI escape code rendering layer on top of the printer algebra; shows how to extend `Doc` annotations for a new output medium | `repos/effect/packages/printer-ansi/` |
| `@effect/vitest` | tooling | Vitest helpers for testing Effect programs: `it.effect`, `it.live`, `it.scoped`, fiber-aware test runners, layer management in tests | (peers only) | Effect-native test patterns: running effectful tests without manual runtime setup, scoped resource cleanup in tests | `repos/effect/packages/vitest/` |

## Tier summary

- **core** (2): `effect`, `@effect/typeclass`
- **platform** (5): `@effect/platform`, `@effect/platform-node`, `@effect/platform-bun`, `@effect/platform-browser`, `@effect/platform-node-shared`
- **domain** (23): `@effect/sql` + 10 sql drivers/integrations, `@effect/rpc`, `@effect/cluster`, `@effect/workflow`, `@effect/ai` + 5 AI providers
- **tooling** (5): `@effect/opentelemetry`, `@effect/cli`, `@effect/printer`, `@effect/printer-ansi`, `@effect/vitest`
- **experimental** (1): `@effect/experimental`

**Total: 36 packages** (31 top-level directories; `packages/ai/` is a container holding 6 sub-packages, each with its own `package.json`)

# Repos Selected for Cloning

> Source: `research/_meta/repos-list.json` (snapshot from `gh api orgs/Effect-TS/repos`).

## Will clone

| Repo | Why |
|------|-----|
| Effect-TS/effect | Core monorepo — every official package lives here. |
| Effect-TS/website | Docs source — useful for "how the team explains things." |
| Effect-TS/examples | Example apps — real consumers of the library. |
| Effect-TS/effect-smol | Core libraries and experimental work for Effect v4 — shows direction of the library. |
| Effect-TS/eslint-plugin | Official ESLint/TS rules for Effect — reveals best-practice patterns enforced by the team. |
| Effect-TS/language-service | LSP plugin — documents type-level APIs and editor-facing semantics. |

## Will skip

| Repo | Why skipped |
|------|-------------|
| Effect-TS/figlet | Toy demo (FIGlet renderer); illustrative but not a representative library use-case. |
| Effect-TS/discord-bot | Community tooling bot — not library/example code worth reading for the book. |
| Effect-TS/general-issues | Issue tracker only; no code, last push 2023. |
| Effect-TS/docgen | Internal documentation generator tooling; not relevant to library usage patterns. |
| Effect-TS/build-utils | Internal build/packaging helpers; not relevant to library usage patterns. |
| Effect-TS/.github | Org-wide GitHub config only; no library or example code. |
| Effect-TS/vscode-extension | Editor extension tooling; not library or example code. |
| Effect-TS/codemod | Migration codemods; useful for upgraders but not for learning the library. |
| Effect-TS/content | No description, no recent activity; unclear purpose, skipping for now. |
| Effect-TS/meetups | Talk proposals via issues only; no library or example code. |
| Effect-TS/effect-days-2025-workshop | Workshop snapshot from a single event; superseded by the main examples repo. |
| Effect-TS/tsgo | TypeScript-go LSP experiment; tooling project, not library/example code. |

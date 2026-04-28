# @effect/cli

> Source: `repos/effect/packages/cli/`, pinned at `39c934c1476be389f7469433910fdf30fc4dad82`.
> Tier: tooling
> Effect deps: `effect`, `@effect/platform`, `@effect/printer`, `@effect/printer-ansi` (all peers; see `repos/effect/packages/cli/package.json:50–55`)

## What it does

`@effect/cli` is a framework for building fully-featured, type-safe CLI applications in TypeScript. Application developers compose a typed tree of `Command`, `Args`, and `Options` values; the framework derives argument parsing, `--help` output, shell auto-completion scripts (bash/fish/zsh), wizard mode, config-file loading, and `ValidationError` reporting from that same declarative tree — no separate configuration required. Without it, a team building a CLI in pure Effect would need to manually wire a third-party parsing library (commander, yargs) whose handler types are either `any` or require hand-written type assertions; `@effect/cli` makes the handler's parameter type a direct function of the arg/option declarations. See `research/01-package-inventory.md` for the row describing this package's purpose and tier.

## Public API surface

Grouped by conceptual layer, each bullet cites the primary source file.

**Command construction**

- `Command` — the central type; `Command<Name, R, E, A>` extends both `Pipeable` and `Effect<A, never, Command.Context<Name>>`, making it usable inside `Effect.gen` handlers for parent-context access (`repos/effect/packages/cli/src/Command.ts:42–48`). Key constructors: `Command.make`, `Command.prompt`, `Command.fromDescriptor`. Key combinators: `Command.withSubcommands`, `Command.withHandler`, `Command.withDescription`, `Command.provide`, `Command.transformHandler`.
- `CliApp` — lower-level application shell; `CliApp<A>` carries `name`, `version`, `command`, and `footer`; `CliApp.run` executes parsing and dispatch (`repos/effect/packages/cli/src/CliApp.ts:21–74`).

**Argument and option types**

- `Args<A>` — positional arguments; constructors for `text`, `integer`, `float`, `boolean`, `date`, `path`, `file`, `directory`, `fileContent`, `fileParse`, `fileSchema`, `redacted`, `secret`, `choice`; combinators for `optional`, `repeated`, `atLeast`, `atMost`, `between`, `map`, `mapEffect`, `withDefault` (`repos/effect/packages/cli/src/Args.ts`).
- `Options<A>` — named flags (`--flag`/`-f`); constructors mirror `Args` plus `keyValueMap`, `choiceWithValue`, and `withAlias`; combinators include `optional`, `withFallbackConfig`, `map`, `mapEffect` (`repos/effect/packages/cli/src/Options.ts`).
- `Primitive<A>` — the shared parse-from-string layer beneath both `Args` and `Options`; rarely used directly (`repos/effect/packages/cli/src/Primitive.ts:28–34`).

**Interactive / help layer**

- `Prompt<Output>` — interactive terminal prompts; extends `Effect<Output, QuitException, Terminal>`; built-in variants: `text`, `confirm`, `number`, `select`, `multiSelect`, `list`, `toggle`, `date`, `file` (loaded from `internal/prompt/` modules via `repos/effect/packages/cli/src/Prompt.ts:1–20`).
- `HelpDoc` — a structured document ADT (`Empty | Header | Paragraph | DescriptionList | Enumeration | Sequence`) renderable to plain text, ANSI, HTML, and JSON (`repos/effect/packages/cli/src/HelpDoc.ts:23–78`).
- `Span` — inline text nodes inside `HelpDoc`; re-exported from `HelpDoc/Span.ts` (`repos/effect/packages/cli/src/index.ts:79`).
- `Usage` — usage-string model, derived automatically from the command descriptor.

**Error model**

- `ValidationError` — a tagged union of 11 variants: `CommandMismatch`, `CorrectedFlag`, `HelpRequested`, `InvalidArgument`, `InvalidValue`, `MissingValue`, `MissingFlag`, `MultipleValuesDetected`, `MissingSubcommand`, `NoBuiltInMatch`, `UnclusteredFlag` (`repos/effect/packages/cli/src/ValidationError.ts:25–36`).

**Built-in and ancillary**

- `BuiltInOptions` — the built-in flag set (`--help`, `--version`, `--wizard`, `--completions`, `--log-level`) as a tagged union; not user-facing but injected automatically by `CliApp` (`repos/effect/packages/cli/src/BuiltInOptions.ts:17–77`).
- `ConfigFile` — reads JSON/YAML/INI/TOML config files and exposes them as an Effect `ConfigProvider`; `ConfigFile.layer` provides a `Layer` that merges the file's values into Effect's config system (`repos/effect/packages/cli/src/ConfigFile.ts:50–72`).
- `AutoCorrect` — Levenshtein-distance typo correction for flag names (`repos/effect/packages/cli/src/AutoCorrect.ts:12–13`).
- `CliConfig` — runtime tuning (case-sensitivity, auto-correction threshold).

## Patterns used

- [`.make` / `.of` constructors](../02-patterns-catalog.md#make--of-constructors) — `Command.make`, `Args.text`, `Options.boolean`, `Prompt.*` all follow the named-constructor convention; `CliApp.make` assembles the full application shell (`repos/effect/packages/cli/src/CliApp.ts:58`).
- [`Effect.gen` + `yield*`](../02-patterns-catalog.md#effectgen--yield) — subcommand handlers are plain `Effect` values, written with `Effect.gen`; `Command` itself extends `Effect`, so a child handler can `yield*` the parent command to read its parsed config (demonstrated in `repos/effect/packages/cli/README.md:1122–1158`).
- [`Layer.succeed` / `effect` / `scoped` — Layer constructors](../02-patterns-catalog.md#layersucceed--effect--scoped--layer-constructors) — `ConfigFile.layer` returns a `Layer<never, ConfigFileError, Path | FileSystem>` that installs a `ConfigProvider`; `Command.provide` and `Command.provideEffect` attach layers directly to a command's handler (`repos/effect/packages/cli/src/Command.ts:255–313`).
- [Dual data-first / data-last (`dual(...)`) and Pipeable trait](../02-patterns-catalog.md#dual-data-first--data-last-dual-and-pipeable-trait) — every combinator on `Command`, `Args`, and `Options` ships in both overload forms; `Command`, `Args`, and `Options` all implement `Pipeable` so `.pipe(...)` chains work naturally (`repos/effect/packages/cli/src/Args.ts:40`, `repos/effect/packages/cli/src/Command.ts:13–14`).
- [`Match.value` / `Match.type` — starting a match](../02-patterns-catalog.md#matchvalue--matchtype--starting-a-match) and [`Match.when` / `not` / `exhaustive`](../02-patterns-catalog.md#matchwhen--not--exhaustive--clauses-and-finalizers) — `ValidationError` and `BuiltInOptions` are tagged unions matched exhaustively inside the framework's internal dispatch logic (`repos/effect/packages/cli/src/internal/cliApp.ts`); consumer code pattern-matches `subcommand: Option<...>` fields with `Option.match`.
- [`Data.TaggedError`](../02-patterns-catalog.md#datataggederror) — `ConfigFileError` is a `YieldableError` with a `ConfigErrorTypeId` brand, following the tagged-error convention (`repos/effect/packages/cli/src/ConfigFile.ts:34–38`).
- [`Config.string` / `integer` / `boolean` / `nested` / `all`](../02-patterns-catalog.md#configstring--integer--boolean--nested--all) — `Options.withFallbackConfig` accepts an Effect `Config` value so a flag can fall back to an environment variable or config file entry; `ConfigFile.layer` feeds into this path (`repos/effect/packages/cli/src/Options.ts`).
- [The `internal/` folder and `index.ts` re-export shape](../02-patterns-catalog.md#the-internal-folder-and-indexts-re-export-shape) — all runtime implementations live under `repos/effect/packages/cli/src/internal/`; the public modules (`Command.ts`, `Args.ts`, etc.) re-export only the type interfaces and delegate to internal via named aliases.

## What's unique about this package's design

The headline design decision is that `Command<Name, R, E, A>` is simultaneously an `Effect` and a `Pipeable`. Because `Command` extends `Effect<A, never, Command.Context<Name>>` (line 42 of `repos/effect/packages/cli/src/Command.ts`), a subcommand handler can do `Effect.flatMap(parentCommand, (config) => ...)` to read the parent's parsed config — the parent context is tracked in the `R` type parameter and is automatically erased when `Command.withSubcommands` wires them together (the `Command.Context<Name>` is subtracted from `R` at that point). This is the only mainstream TypeScript CLI library where the parent-to-child config flow is enforced statically.

The second novelty is that help text, shell completion scripts, and wizard mode are all derived from the same declarative `Args`/`Options` tree — they are not bolted on. `Command.getHelp`, `Command.getBashCompletions`, `Command.getFishCompletions`, and `Command.getZshCompletions` all accept a `Command<...>` and traverse its descriptor; there is no separate "completions config" to write (see `repos/effect/packages/cli/src/Command.ts:153–191`). Contrast this with commander or yargs, where completions are either absent or require separate registration.

The `ParseConfig<Config>` mapped type at lines 80–89 of `repos/effect/packages/cli/src/Command.ts` is what threads typed params into the handler: a structural `Config` object whose values are `Args<A>` or `Options<A>` is recursively mapped to its parsed form (`A`), so the handler receives exactly the right types with no `as any` cast required.

## Conventions observed

- `@since 1.0.0` is used for almost all exports; `ConfigFile` breaks this with `@since 2.0.0` (see `repos/effect/packages/cli/src/ConfigFile.ts:1` and `repos/effect/packages/cli/src/index.ts:43`) — this reflects the module being added in a later version of the package, before the project normalised versioning at `1.0.0`. This diverges from `research/03-conventions.md`'s note that cli tags some pre-existing modules at `@since 2.0.0` from before the 1.0.0 cutover.
- `@example` JSDoc tags are absent from `Args.ts` and `Options.ts`; examples appear inline in constructor docstrings only for the more unusual overloads (e.g., `Options.choiceWithValue` at `repos/effect/packages/cli/src/Options.ts:183–210`). This is within the per-module discretion noted in `research/03-conventions.md`.
- The `package.json` includes `"effect": { "generateIndex": { "include": ["**/*"] } }` at line 69, enabling auto-generation of `index.ts`. The core `effect` package hand-maintains its `index.ts`; `@effect/cli`'s is generated. This is called out explicitly in `research/03-conventions.md`.
- The export map blocks `./internal/*`: null (line 39 of `repos/effect/packages/cli/package.json`), matching the ecosystem-wide convention.
- `@category` tags group exports into `constructors`, `combinators`, `accessors`, `models`, `refinements`, `mapping`, `utilities` — same vocabulary as core `effect`.
- No `@param` / `@returns` / `@throws` in any public module; all documentation is prose paragraphs, matching the dominant style documented in `research/03-conventions.md`.

## "If you were authoring something similar, copy this"

- **`Command` extending `Effect`** (`repos/effect/packages/cli/src/Command.ts:42`). Making your primary domain type extend `Effect` means it can be used inside `Effect.gen` and `Effect.flatMap` without any unwrapping ceremony. The parent-context access pattern is a direct consequence of this.
- **`ParseConfig<Config>` mapped type** (`repos/effect/packages/cli/src/Command.ts:80–89`). The pattern of declaring a `Config` object whose fields are typed descriptors (`Args<A>` or `Options<A>`), then using a recursive mapped type to derive the parsed form, is transferable to any framework that takes descriptors and produces values. It eliminates the need for casting in handlers.
- **Deriving completions and help from the same descriptor** (`repos/effect/packages/cli/src/Command.ts:153–191`). Never maintain a separate "help string" and a separate "completion list" — walk the same structured tree for both. This prevents drift between what the help text says and what completions actually offer.
- **`Command.withSubcommands` erasing parent context** (`repos/effect/packages/cli/src/Command.ts:361–401`). The type signature subtracts `Command.Context<Name>` from the subcommand's `R`, so the wiring is invisible to the caller but enforced by the compiler. This is the right pattern when you need a service/context to be available inside a scope but not leak outside.
- **`ConfigFile.layer` as a `ConfigProvider` contributor** (`repos/effect/packages/cli/src/ConfigFile.ts:64–72`). Rather than inventing a new config-reading API, this module produces an Effect `ConfigProvider` and composes it with `Options.withFallbackConfig`. The entire config-system integration is just a `Layer`, reusing all of Effect's existing config infrastructure.
- **`BuiltInOptions` as a tagged union** (`repos/effect/packages/cli/src/BuiltInOptions.ts:17–67`). Encoding the built-in flag set as a discriminated union (`ShowHelp | ShowCompletions | ShowWizard | ShowVersion | SetLogLevel`) means dispatch over them is exhaustive and extensible — adding a new built-in is a new variant, caught at every call site.

## Open questions

- `CommandDescriptor` vs `Command`: the public API exposes both a `Command` module and a `CommandDescriptor` module (`repos/effect/packages/cli/src/index.ts:29–38`). The relationship (descriptor = parse description, command = descriptor + handler) is clear from the source, but the book chapter should explicitly explain when a reader would reach for `CommandDescriptor` directly versus always using `Command.make`.
- The `Wizard` mode (`--wizard`) builds interactive prompts from `Args` and `Options` descriptors. It is not clear whether this derivation is complete (all `Args`/`Options` types are covered) or whether certain exotic args fall back to raw text prompts. Worth verifying in `repos/effect/packages/cli/src/internal/command.ts` before describing wizard completeness to readers.
- `Args.fileSchema` and `Options.fileContent` accept `Schema` values — it is not obvious how the parse error from a Schema failure surfaces in the `ValidationError` union. Tracing through `internal/args.ts` would clarify whether it becomes an `InvalidValue` or whether Schema `ParseError` leaks through.
- The `transform` field on `Command<Name, R, E, A>` (`repos/effect/packages/cli/src/Command.ts:47`) is typed as `Command.Transform<R, E, A>` but not documented in the README. Its purpose and when to use `Command.transformHandler` vs `Command.withHandler` is worth clarifying.

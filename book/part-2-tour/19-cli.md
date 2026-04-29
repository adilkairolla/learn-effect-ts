# Chapter 19 — Building a CLI with @effect/cli

> **Package(s):** `@effect/cli`
> **Patterns introduced:** [`Config.string` / `integer` / `boolean` / `nested` / `all`](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all)
> **Reads from:** Chapter 02 (Effect as a value), Chapter 09 (Layer), Chapter 14 (Schema part 1)
> **Reads into:** Chapter 38 (Config and secrets — typed environment loading), Chapter 20 (Pretty-printing with @effect/printer)
> **Source pinned at:** `effect@3.21.2` (SHA `39c934c1476be389f7469433910fdf30fc4dad82`)

---

## The problem

Building a CLI tool without dedicated framework support means parsing `process.argv` by hand, or handing the keys to a library whose type story is incomplete. To see what the pain looks like, consider a small tool that clones a repository and optionally limits the history depth:

```ts
// Raw process.argv approach — no types, no help, no validation
const args = process.argv.slice(2)

if (args[0] === "clone") {
  const repo = args[1]
  if (!repo) {
    console.error("Error: repository argument is required")
    process.exit(1)
  }

  const depthIndex = args.indexOf("--depth")
  let depth: number | undefined
  if (depthIndex !== -1) {
    const raw = args[depthIndex + 1]
    depth = raw ? parseInt(raw, 10) : undefined
    if (depth === undefined || isNaN(depth)) {
      console.error("Error: --depth must be a valid integer")
      process.exit(1)
    }
  }

  // do the clone...
  console.log(`Cloning ${repo}${depth ? ` (depth ${depth})` : ""}`)
} else {
  console.error(`Unknown subcommand: ${args[0]}`)
  process.exit(1)
}
```

The problems here compound quickly. The argument declarations are scattered across the parsing logic — there is no single place that lists every flag the CLI accepts. The `--help` output must be written by hand and kept in sync with the actual behavior. Shell auto-completion scripts require a second, entirely separate file with its own maintenance burden. The depth flag is an integer in the business logic but arrives as a string from `process.argv`; the cast is manual and easy to get wrong.

A library like Commander.js partially solves these problems by introducing a declaration layer, but the handler callback still receives `options: any` by default until you add `--ts-generics` workarounds, and the resulting types are loose object literals rather than derived structural types. There is also no integration with Effect's error channel or Layer system, so any async work inside the handler exits the structured Effect world.

`@effect/cli` solves all of these at once. You declare `Args` and `Options` values, pass them to `Command.make`, and the handler receives a strongly-typed parsed object — no casts, no string-to-number coercions, no manual `--help` to write.

---

## The minimal example

```ts
import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

// Declare a positional text argument
const repoArg = Args.text({ name: "repository" })

// Declare a named integer option, optional
const depthOption = Options.integer("depth").pipe(Options.optional)

// Build the command — config object maps key names to parsed types
const cloneCommand = Command.make(
  "clone",
  { repo: repoArg, depth: depthOption },
  ({ repo, depth }) =>
    Console.log(
      depth._tag === "Some"
        ? `Cloning ${repo} at depth ${depth.value}`
        : `Cloning ${repo}`
    )
)

// Wrap in a top-level command and run
const cli = Command.run(cloneCommand, {
  name: "mygit",
  version: "1.0.0"
})

Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

Pass `--help` to this program and the framework prints a fully formatted help page — no extra code required. Pass `--depth foo` and you get a typed `InvalidValue` error message instead of a silent `NaN`.

---

## Tour

`@effect/cli` is built on four types that work together: `Command`, `Args`, `Options`, and `CliApp`. Understanding each type's responsibility is the fastest way to navigate the API.

### Command construction

**`Command<Name, R, E, A>`** is the central type. Its interface is declared at `repos/effect/packages/cli/src/Command.ts:38–48`:

```
repos/effect/packages/cli/src/Command.ts:38-48
```

```ts
// repos/effect/packages/cli/src/Command.ts:38-48
export interface Command<Name extends string, R, E, A>
  extends Pipeable, Effect<A, never, Command.Context<Name>> {
  readonly [TypeId]: TypeId
  readonly descriptor: Descriptor.Command<A>
  readonly handler: (_: A) => Effect<void, E, R>
  readonly tag: Tag<Command.Context<Name>, A>
  readonly transform: Command.Transform<R, E, A>
}
```

Two facts from this interface are consequential. First, `Command` extends `Pipeable`, so every combinator ships in both data-first and data-last form (covered in Chapter 04). Second — and this is the headline design decision — `Command` extends `Effect<A, never, Command.Context<Name>>`. A command is simultaneously a description and an effect. A subcommand handler can do `yield* parentCommand` to read the parent's parsed config, and TypeScript tracks that requirement in the `R` type parameter. When `Command.withSubcommands` wires the parent to its children, it subtracts `Command.Context<Name>` from each child's `R`, so the requirement is satisfied without the caller doing anything.

**`Command.make`** is the primary constructor (`repos/effect/packages/cli/src/Command.ts:207–239`). It takes a name, an optional config object, and an optional handler. The config object's values must be `Args<A>` or `Options<A>` instances; the `ParseConfig<Config>` mapped type at `repos/effect/packages/cli/src/Command.ts:80–89` recursively maps each field to its parsed type `A`, so the handler parameter is always fully typed:

```ts
// repos/effect/packages/cli/src/Command.ts:207-239
export const make: {
  <Name extends string>(name: Name): Command<Name, never, never, {}>

  <Name extends string, const Config extends Command.Config>(
    name: Name,
    config: Config
  ): Command<Name, never, never, Types.Simplify<Command.ParseConfig<Config>>>

  <Name extends string, const Config extends Command.Config, R, E>(
    name: Name,
    config: Config,
    handler: (_: Types.Simplify<Command.ParseConfig<Config>>) => Effect<void, E, R>
  ): Command<Name, R, E, Types.Simplify<Command.ParseConfig<Config>>>
} = Internal.make
```

**`Command.withHandler`** attaches or replaces the handler after the fact (`repos/effect/packages/cli/src/Command.ts:343–355`). It replaces the existing handler entirely, which is useful when you want to define the command shape separately from its behaviour, or when you need to satisfy a tighter type constraint.

**`Command.withSubcommands`** composes a parent command with a non-empty array of child commands (`repos/effect/packages/cli/src/Command.ts:357–401`). The parent's parsed type gains a `subcommand: Option<...>` field discriminated over all child types. Each child's `Command.Context<ParentName>` requirement is subtracted from its `R` type, keeping the parent-access pattern safe without leaking it.

**`Command.run`** is the shorthand that turns a command directly into a `(args: ReadonlyArray<string>) => Effect<void, ...>` function (`repos/effect/packages/cli/src/Command.ts:429–443`). It is equivalent to calling `CliApp.make` and then `CliApp.run` — useful for the common case where no custom footer or executable name is needed.

**`Command.withDescription`** attaches a help string (`repos/effect/packages/cli/src/Command.ts:329–341`). The description accepts either a plain `string` or a structured `HelpDoc` value for richer formatting.

**`Command.provide`** attaches a `Layer` directly to a command (`repos/effect/packages/cli/src/Command.ts:252–265`). The layer can be a static value or a function of the parsed config — useful when a handler needs a database connection whose parameters come from CLI flags.

### Argument and option types

**`Args<A>`** represents positional arguments — the kind consumed left-to-right, not prefixed with `--` (`repos/effect/packages/cli/src/Args.ts:34–40`). Constructors cover the full primitive surface:

- `Args.text` — a bare string (`repos/effect/packages/cli/src/Args.ts:400–408`)
- `Args.integer` — parsed integer, `InvalidValue` on non-numeric input (`repos/effect/packages/cli/src/Args.ts:313–321`)
- `Args.boolean` — `true`/`false` literal (`repos/effect/packages/cli/src/Args.ts:173–181`)
- `Args.file`, `Args.directory`, `Args.path` — filesystem paths with optional existence checks
- `Args.fileContent` — reads and returns file bytes alongside the path
- `Args.fileSchema` — reads, parses, and validates with a `Schema<A>` (from Chapter 14)
- `Args.choice` — accepts only values from a provided list, returning a typed union

Combinators transform the arity and optionality: `Args.repeated` produces `Args<Array<A>>`, `Args.optional` wraps the result in `Option<A>`, and `Args.withDefault` provides a fallback so the option becomes required-or-defaulted.

**`Options<A>`** represents named flags (`--flag`/`-f`). Constructors mirror `Args` with a leading `name` string:

- `Options.text("output")` — `--output <value>` (`repos/effect/packages/cli/src/Options.ts:331–335`)
- `Options.integer("depth")` — `--depth <integer>` (`repos/effect/packages/cli/src/Options.ts:299–303`)
- `Options.boolean("verbose")` — `--verbose`, `--no-verbose` (`repos/effect/packages/cli/src/Options.ts:145–150`)
- `Options.choice("format", ["json", "yaml"])` — enumerated string options
- `Options.keyValueMap("c")` — `-c key=value` repeated multiple times, producing a `HashMap<string, string>`
- `Options.redacted("token")` — stores the value as a `Redacted`, preventing it from leaking into logs

**`Options.withAlias`** adds a short form (`repos/effect/packages/cli/src/Options.ts:505–512`):

```ts
// repos/effect/packages/cli/src/Options.ts:505-512
export const withAlias: {
  (alias: string): <A>(self: Options<A>) => Options<A>
  <A>(self: Options<A>, alias: string): Options<A>
} = InternalOptions.withAlias
```

**`Options.withFallbackConfig`** is the bridge to Effect's Config system (`repos/effect/packages/cli/src/Options.ts:523–530`). When a flag is not provided on the command line, the fallback Config value is read from the environment (or from a `ConfigFile.layer`, or from any custom `ConfigProvider`). This is where the `Config.string` / `integer` / `boolean` patterns from the catalog enter the picture. For example:

```ts
import { Options } from "@effect/cli"
import { Config } from "effect"

const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withFallbackConfig(Config.boolean("VERBOSE"))
)
```

Now `--verbose` takes precedence; if absent, the `VERBOSE` env var is read; if that is also absent, parsing fails with a missing-value error. Chapter 38 covers the full Config system including `Config.nested`, `Config.all`, and secret handling.

### Interactive layer

**`Prompt<Output>`** enables interactive terminal prompts — `Prompt.text`, `Prompt.confirm`, `Prompt.select`, `Prompt.multiSelect`, `Prompt.number`, `Prompt.password`, and others (`repos/effect/packages/cli/src/Prompt.ts:1–20`). `Prompt` extends `Effect<Output, QuitException, Terminal>`, so it is just another Effect. The `--wizard` built-in flag causes `@effect/cli` to derive an interactive prompt sequence from your `Args` and `Options` declarations, walking the user through each field in turn.

### Help and completions layer

When a user passes `--help`, the framework calls `Command.getHelp` (`repos/effect/packages/cli/src/Command.ts:149–156`) and renders the result. The help content is derived entirely from your `Args`/`Options` declarations and any `withDescription` strings — there is nothing to maintain separately. The same tree drives shell completion scripts: `Command.getBashCompletions`, `Command.getFishCompletions`, and `Command.getZshCompletions` (`repos/effect/packages/cli/src/Command.ts:162–191`) all walk the descriptor and produce the right completion entries, including accepted values for `Args.choice` and `Options.choice`.

### Error model

**`ValidationError`** is a discriminated union of eleven variants (`repos/effect/packages/cli/src/ValidationError.ts:25–36`): `CommandMismatch`, `CorrectedFlag`, `HelpRequested`, `InvalidArgument`, `InvalidValue`, `MissingValue`, `MissingFlag`, `MultipleValuesDetected`, `MissingSubcommand`, `NoBuiltInMatch`, and `UnclusteredFlag`. `HelpRequested` and the completion/wizard variants are not user errors — they are internally used to control dispatch flow. The framework handles them before your handler runs; only the genuine error variants reach the surface.

Typo correction is built in via `AutoCorrect` (`repos/effect/packages/cli/src/AutoCorrect.ts:12–13`). If a user types `--verboes`, the `CorrectedFlag` variant carries a suggestion: "Did you mean `--verbose`?" The correction threshold is tunable via `CliConfig`.

### Built-in and ancillary

**`CliApp`** is the lower-level shell (`repos/effect/packages/cli/src/CliApp.ts:15–28`). `Command.run` is a convenience wrapper around it. `CliApp.make` lets you set a `summary` (a `Span` value for inline help text), a `footer` (a `HelpDoc` for extended notes), and a custom executable name. `CliApp.run` (`repos/effect/packages/cli/src/CliApp.ts:60–74`) takes the args array and a handler, and returns an `Effect<void, ValidationError, CliApp.Environment>` where `CliApp.Environment = FileSystem | Path | Terminal`.

**`ConfigFile.layer`** reads a JSON, YAML, INI, or TOML config file from the filesystem and installs its values as an Effect `ConfigProvider` (`repos/effect/packages/cli/src/ConfigFile.ts:60–72`). It requires `Path | FileSystem` from `@effect/platform`. Once provided, any `Options.withFallbackConfig` fallback will consult the file's values — the entire config-file integration is just a `Layer` composing into the Layer graph from Chapter 09. The module is tagged `@since 2.0.0`, reflecting that it was added in a later iteration of the package before version numbering was normalized.

---

## A production example

The following is adapted from `repos/effect/packages/cli/examples/minigit.ts`. It models a minimal git-like CLI with a parent `minigit` command, an `add` subcommand, and a `clone` subcommand. The `clone` subcommand reads the parent's config using `yield* minigit` — the parent-context access pattern described in the Tour.

```ts
import { Args, Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Array, Config, ConfigProvider, Console, Effect, Option } from "effect"

// ---- parent: minigit [-c key=value...] ----

const configs = Options.keyValueMap("c").pipe(Options.optional)

const minigit = Command.make("minigit", { configs }, ({ configs }) =>
  Option.match(configs, {
    onNone: () => Console.log("Running 'minigit'"),
    onSome: (map) => {
      const pairs = Array.fromIterable(map)
        .map(([k, v]) => `${k}=${v}`)
        .join(", ")
      return Console.log(`Running 'minigit' with configs: ${pairs}`)
    }
  })
)

// ---- add subcommand ----

const pathspec = Args.text({ name: "pathspec" }).pipe(Args.repeated)

// withFallbackConfig bridges the CLI flag to the Config system (Chapter 38)
const verbose = Options.boolean("verbose").pipe(
  Options.withAlias("v"),
  Options.withFallbackConfig(Config.boolean("VERBOSE"))
)

const minigitAdd = Command.make(
  "add",
  { pathspec, verbose },
  ({ pathspec, verbose }) => {
    const paths = Array.match(pathspec, {
      onEmpty: () => "",
      onNonEmpty: (ps) => ` ${Array.join(ps, " ")}`
    })
    return Console.log(
      `Running 'minigit add${paths}' with --verbose ${verbose}`
    )
  }
)

// ---- clone subcommand ----

const repository = Args.text({ name: "repository" })
const directory = Args.directory().pipe(Args.optional)
const depth = Options.integer("depth").pipe(
  Options.withFallbackConfig(Config.integer("DEPTH")),
  Options.optional
)

const minigitClone = Command.make(
  "clone",
  { repository, directory, depth },
  (sub) =>
    // yield* minigit reads the parent command's parsed config.
    // TypeScript tracks the Command.Context<"minigit"> requirement;
    // Command.withSubcommands (below) satisfies it.
    Effect.flatMap(minigit, (parent) => {
      const depthPart = Option.map(sub.depth, (d) => `--depth ${d}`)
      const parts = Array.getSomes([
        depthPart,
        Option.some(sub.repository),
        sub.directory
      ])
      const cfgs = Option.match(parent.configs, {
        onNone: () => "",
        onSome: (m) =>
          Array.fromIterable(m)
            .map(([k, v]) => `${k}=${v}`)
            .join(", ")
      })
      return Console.log(
        `Running 'minigit clone' with args: '${Array.join(parts, ", ")}'\n` +
          `parent configs: ${cfgs}`
      )
    })
)

// ---- wire and run ----

const command = minigit.pipe(
  Command.withSubcommands([minigitAdd, minigitClone])
)

const cli = Command.run(command, {
  name: "Minigit Distributed Version Control",
  version: "v1.0.0"
})

// ConfigProvider.nested scopes env-var lookup under a "GIT_" prefix,
// matching the Config.boolean("VERBOSE") as GIT_VERBOSE.
Effect.suspend(() => cli(process.argv)).pipe(
  Effect.withConfigProvider(
    ConfigProvider.nested(ConfigProvider.fromEnv(), "GIT")
  ),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

Key patterns from Part I visible here:

- **Chapter 02** — every handler is an `Effect` value, not a Promise or a callback. Nothing runs until `NodeRuntime.runMain` evaluates the outermost effect.
- **Chapter 09** — `NodeContext.layer` (which includes `FileSystem`, `Path`, and `Terminal`) is provided via `Effect.provide`, satisfying the `CliApp.Environment` requirement in the type of `cli`.
- **Chapter 14** (Schema) — indirectly present through the `Args.directory()` call, which validates that the supplied path is a real directory using the platform `FileSystem` service.

---

## Variations

**Attaching a layer to a single command.** When one subcommand needs a database service derived from a CLI flag, use `Command.provide` with a factory function:

```ts
const deploy = Command.make("deploy", { env: Options.text("env") }).pipe(
  Command.provide(({ env }) => DbLayer.forEnv(env))
)
```

**Reading a config file automatically.** Use `ConfigFile.layer` alongside `Options.withFallbackConfig` so users can commit their flags to a project config file:

```ts
Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(ConfigFile.layer(".mygitrc")),
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

**Requiring at least N positional args.** Use `Args.atLeast` to enforce a minimum count:

```ts
const files = Args.text({ name: "file" }).pipe(Args.atLeast(1))
// produces Args<NonEmptyArray<string>>
```

**Accepting an enum flag.** Use `Options.choice` when only a fixed set of values is valid:

```ts
const format = Options.choice("format", ["json", "yaml", "toml"])
// produces Options<"json" | "yaml" | "toml">
```

**Falling back to an interactive prompt.** Use `Options.withFallbackPrompt` to turn a missing flag into an interactive question rather than an error:

```ts
const name = Options.text("name").pipe(
  Options.withFallbackPrompt(Prompt.text("What is the project name?"))
)
```

**Attaching a schema-validated config file argument.** Use `Options.fileSchema` when the value of a flag is a path to a structured file:

```ts
const configOpt = Options.fileSchema(
  "config",
  Schema.Struct({ host: Schema.String, port: Schema.Number })
)
// produces Options<{ host: string; port: number }>
```

---

## Anti-patterns

### Casting `process.argv` directly instead of using `Command.run`

```ts
// Wrong: bypasses all parsing, validation, and help generation
const [,, subcommand, ...rest] = process.argv
if (subcommand === "deploy") {
  const env = rest.find(r => r.startsWith("--env="))?.slice(6)
  if (!env) process.exit(1)
  // env is string | undefined; no type safety
}
```

```ts
// Correct: declare args and let @effect/cli parse, validate, and document them
import { Command, Options } from "@effect/cli"
import { NodeContext, NodeRuntime } from "@effect/platform-node"
import { Console, Effect } from "effect"

const deploy = Command.make(
  "deploy",
  { env: Options.text("env") },
  ({ env }) => Console.log(`Deploying to ${env}`)
)
const cli = Command.run(deploy, { name: "mytool", version: "1.0.0" })
Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

### Scattering `Options.withFallbackConfig` on ad-hoc `Config.string` calls

```ts
// Wrong: config keys are strings scattered through command definitions,
// making it impossible to see all env vars the CLI reads in one place
const host = Options.text("host").pipe(
  Options.withFallbackConfig(Config.string("HOST"))
)
const port = Options.integer("port").pipe(
  Options.withFallbackConfig(Config.integer("PORT"))
)
const token = Options.text("token").pipe(
  Options.withFallbackConfig(Config.string("API_TOKEN"))
)
```

```ts
// Correct: centralize the Config schema in one place and derive options from it.
// This makes every env var visible at a glance and ensures naming consistency.
import { Options } from "@effect/cli"
import { Config } from "effect"

const AppConfig = Config.all({
  host: Config.string("HOST"),
  port: Config.integer("PORT"),
  token: Config.string("API_TOKEN")
})

const host = Options.text("host").pipe(
  Options.withFallbackConfig(Config.string("HOST"))
)
```

The centralized `AppConfig` object is also usable in tests via `ConfigProvider.fromMap` without touching `process.env` — a technique covered in Chapter 38.

### Dropping `Effect.suspend` around the `cli` call

```ts
// Wrong: cli(process.argv) is called eagerly at module load time,
// before NodeContext.layer is provided — the effect runs unconfigured.
const cli = Command.run(myCommand, { name: "tool", version: "1.0.0" })
cli(process.argv).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

```ts
// Correct: wrap in Effect.suspend so argv is captured lazily,
// after the full layer stack is in place.
Effect.suspend(() => cli(process.argv)).pipe(
  Effect.provide(NodeContext.layer),
  NodeRuntime.runMain
)
```

`Effect.suspend` is the standard idiom for deferring any `Effect` that depends on ambient state (like `process.argv`) until the runtime is ready. Chapter 02 introduces `Effect` as a deferred description; `Effect.suspend` makes any arbitrary side-effectful value play by the same rules.

---

## See also

- [Chapter 02 — Effect as a value](../part-1-foundations/02-effect-as-a-value.md): `Command<Name, R, E, A>` extends `Effect<A, never, Command.Context<Name>>`. Understanding the three type parameters is a prerequisite for reading the command type signatures.
- [Chapter 09 — Layer](../part-1-foundations/09-layer.md): `Command.provide`, `ConfigFile.layer`, and `NodeContext.layer` are all Layers in the sense introduced there. The `CliApp.Environment = FileSystem | Path | Terminal` requirement is satisfied by providing a platform layer.
- [Chapter 14 — Schema part 1](../part-1-foundations/14-schema-part-1.md): `Args.fileSchema` and `Options.fileSchema` accept a `Schema` from the core `effect` package. The file's contents are decoded against that schema, and a `ParseError` becomes an `InvalidValue` in the `ValidationError` union.
- [Chapter 38 — Config and secrets](../part-2-tour/38-config-and-secrets.md): `Options.withFallbackConfig` and `ConfigFile.layer` are the bridges between `@effect/cli` and Effect's full Config system — `Config.nested`, `Config.all`, `Config.redacted`, and `ConfigProvider.fromMap` for testing. That chapter covers everything this one defers.
- [Chapter 20 — Pretty-printing with @effect/printer](../part-2-tour/20-printer.md): `HelpDoc` and `Span` (the types that drive `@effect/cli`'s help output) are rendered using `@effect/printer` and `@effect/printer-ansi`. Chapter 20 is the next natural stop on the CLI reading path.
- [`Config.string` / `integer` / `boolean` / `nested` / `all` — Patterns catalog](../../research/02-patterns-catalog.md#configstring--integer--boolean--nested--all): The entry for the patterns introduced in this chapter, including when to centralize configs and how to use `Config.nested` for env-var prefix scoping.
- [Per-package research note — @effect/cli](../../research/packages/cli.md): Covers the `CommandDescriptor` vs `Command` distinction, the `ParseConfig<Config>` mapped type, wizard-mode completeness, and the `transform` field on `Command`.

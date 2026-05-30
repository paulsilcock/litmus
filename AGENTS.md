# Agent Instructions

This file is the single, canonical source of guidance for **all** coding agents
working in this repository. Codex reads it natively; Claude loads it via
`CLAUDE.md`, which imports this file. Treat everything below as **mandatory rules
and project context — adhere to it exactly.**

## Default workflow

- Behaviour changes use **autonomous TDD** by default — clarify the behaviours, then run independently.
- Write one failing test at a time.
- Follow `RED → GREEN → REFACTOR`.
- Ask clarifying questions only when expected behaviour is ambiguous or a product/API decision is needed.

TDD applies by default to changes that **add, change, or fix behaviour**.

TDD does **not** apply by default to pure docs, mechanical renames, formatting-only
changes, read-only analysis, or explicitly requested throwaway spikes.

The three sections below are authoritative:

- **Repository overview** — what Litmus is, the packages, and the Vite+ (`vp`) toolchain.
- **TDD workflow** — how to develop behaviour changes test-first.
- **Code quality** — linting, build, commit, and convention rules.

---

# Litmus

Litmus is a TypeScript framework that makes test-driven development natural for modern applications — including those with non-deterministic AI components. Litmus provides domain primitives and entrypoint adapters that encourage modular, testable architectures, alongside test utilities that bring TDD discipline to acceptance tests and AI evaluations.

## Philosophy

- **TDD as a design methodology.** The primitives are shaped so that writing the test first is the easiest way to build. Acceptance tests, unit tests, and evals all follow the same RED → GREEN → REFACTOR loop.
- **Agents are actors, not framework features.** An AI agent interacts with the system through use cases — the same way a user would via HTTP or CLI. Litmus provides the entrypoint adapters and the testable boundaries, not the control loop.
- **Separate deterministic from non-deterministic.** Domain logic, orchestration, and routing are deterministic and tested with conventional assertions. AI tasks (single LLM calls) are the non-deterministic boundary, tested with evaluations and probabilistic assertions.
- **Only mock dependencies you own.** AI SDK calls are wrapped in application-defined task interfaces, keeping the mockable surface under your control.

## Packages

This monorepo contains packages under `packages/`:

- **`@litmus/core`** — Domain primitives and use case types: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `DomainError`, `Repository`, `CommandHandler`, `QueryHandler`. Sub-paths: `./ai` (AiTask, Agent, Toolbox), `./db` (DbContext interface), `./id` (prefixedUlid), `./events` (DomainEventDispatcher).
- **`@litmus/db`** — Database adapters. Sub-path `@litmus/db/drizzle/postgres` exposes `DrizzleDbContext`, `DrizzlePostgresRepository`, `ConcurrencyError`. `drizzle-orm` is a peer dep.
- **`@litmus/http`** — HTTP entrypoint adapter wrapping Hono. Exports `routeHandler` (use case → route with zod validation, verb-based status defaults, SSE streaming, custom respond callback) and `serve` (lifecycle wrapper with `onBeforeStart`/`onBeforeStop` and structured `DomainError` → HTTP mapping). Sub-path `@litmus/http/testing` exposes `BaseHttpDriver` and `BaseHonoDriver<T>` for ATDD. `hono` and `@hono/node-server` are peer deps.
- **`@litmus/cli`** — CLI entrypoint adapter. Typed command registration, grouped commands, unix socket transport with typed `cliClient` for RPC-style calls. Sub-path `@litmus/cli/testing` exposes `BaseLitmusCliDriver<T>` for ATDD. `zod` is a peer dep.
- **`@litmus/log`** — Structured logging with context propagation via `AsyncLocalStorage`. Pino-backed `Logger` implementation extending the abstract base in core. `pino` is a peer dep.
- **`@litmus/ai`** — AI SDK adapters. Sub-path `@litmus/ai/vercel` exposes `toVercelTools` for converting a `Toolbox` to Vercel AI SDK tool format. `ai` is a peer dep.
- **`@litmus/test`** — Test utilities for non-deterministic and acceptance testing. `evaluate()` probabilistic runner (samples, scenarios, pass rates, extend, concurrent), `synthesize()` for fanning out hand-written seeds into more scenarios via an LLM (hash-keyed file cache, opt-in regeneration via `LITMUS_SYNTH_MODE=regenerate`; usable standalone or as `evaluate.scenarios({ synthesize })`), `Grader` type for LLM-as-judge functions, `UserSimulator` for multi-turn conversation simulation, `useInMemoryTracing()` helper, `BaseBrowserDriver` for browser-based ATDD, and the abstract `BaseDriver` lifecycle (async `init()` and `cleanup()`) that all entrypoint-specific drivers extend. `ai` and `playwright` are peer deps. For browser tests: `vp dlx playwright install --with-deps chromium`.
- **`@litmus/test-acceptance`** _(private)_ — Cross-package acceptance tests. Lives outside core/db/http to avoid coupling adapters to acceptance tests of cross-cutting concerns.

Tests use `it()` (not `test()`) and import test utilities from `vite-plus/test`. Test files are co-located with source files using `.test.ts` suffix.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, but it invokes Vite through `vp dev` and `vp build`.

## Vite+ Workflow

`vp` is a global binary that handles the full development lifecycle. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

### Start

- create - Create a new project from a template
- migrate - Migrate an existing project to Vite+
- config - Configure hooks and agent integration
- staged - Run linters on staged files
- install (`i`) - Install dependencies
- env - Manage Node.js versions

### Develop

- dev - Run the development server
- check - Run format, lint, and TypeScript type checks
- lint - Lint code
- fmt - Format code
- test - Run tests

### Execute

- run - Run monorepo tasks
- exec - Execute a command from local `node_modules/.bin`
- dlx - Execute a package binary without installing it as a dependency
- cache - Manage the task cache

### Build

- build - Build for production
- pack - Build libraries
- preview - Preview production build

### Manage Dependencies

Vite+ automatically detects and wraps the underlying package manager such as pnpm, npm, or Yarn through the `packageManager` field in `package.json` or package manager-specific lockfiles.

- add - Add packages to dependencies
- remove (`rm`, `un`, `uninstall`) - Remove packages from dependencies
- update (`up`) - Update packages to latest versions
- dedupe - Deduplicate dependencies
- outdated - Check for outdated packages
- list (`ls`) - List installed packages
- why (`explain`) - Show why a package is installed
- info (`view`, `show`) - View package information from the registry
- link (`ln`) / unlink - Manage local package links
- pm - Forward a command to the package manager

### Maintain

- upgrade - Update `vp` itself to the latest version

These commands map to their corresponding tools. For example, `vp dev --port 3000` runs Vite's dev server and works the same as Vite. `vp test` runs JavaScript tests through the bundled Vitest. The version of all tools can be checked using `vp --version`. This is useful when researching documentation, features, and bugs.

## Common Pitfalls

- **Using the package manager directly:** Do not use pnpm, npm, or Yarn directly. Vite+ can handle all package manager operations.
- **Always use Vite commands to run tools:** Don't attempt to run `vp vitest` or `vp oxlint`. They do not exist. Use `vp test` and `vp lint` instead.
- **Running scripts:** Vite+ built-in commands (`vp dev`, `vp build`, `vp test`, etc.) always run the Vite+ built-in tool, not any `package.json` script of the same name. To run a custom script that shares a name with a built-in command, use `vp run <script>`. For example, if you have a custom `dev` script that runs multiple services concurrently, run it with `vp run dev`, not `vp dev` (which always starts Vite's dev server).
- **Do not install Vitest, Oxlint, Oxfmt, or tsdown directly:** Vite+ wraps these tools. They must not be installed directly. You cannot upgrade these tools by installing their latest versions. Always use Vite+ commands.
- **Use Vite+ wrappers for one-off binaries:** Use `vp dlx` instead of package-manager-specific `dlx`/`npx` commands.
- **Import JavaScript modules from `vite-plus`:** Instead of importing from `vite` or `vitest`, all modules should be imported from the project's `vite-plus` dependency. For example, `import { defineConfig } from 'vite-plus';` or `import { expect, test, vi } from 'vite-plus/test';`. You must not install `vitest` to import test utilities.
- **Type-Aware Linting:** There is no need to install `oxlint-tsgolint`, `vp lint --type-aware` works out of the box.

## CI Integration

For GitHub Actions, consider using [`voidzero-dev/setup-vp`](https://github.com/voidzero-dev/setup-vp) to replace separate `actions/setup-node`, package-manager setup, cache, and install steps with a single action.

```yaml
- uses: voidzero-dev/setup-vp@v1
  with:
    cache: true
- run: vp check
- run: vp test
```

## Review Checklist for Agents

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to validate changes.
<!--VITE PLUS END-->

---

# TDD Workflow

TDD is a design methodology, not a testing strategy. Each test is a question: "what should happen when...?" The answer shapes the interface, and the interface shapes the design. Implementation is discovery — we learn what the code should be by building it one behaviour at a time.

**One test at a time. Always.**

Default to **autonomous** mode: clarify the behaviours, then run the loop independently. Switch to **guided** mode (propose each test, wait for approval) only when the user explicitly asks for it.

TDD applies by default to changes that **add, change, or fix behaviour**. It does **not** apply by default to pure docs, mechanical renames, formatting-only changes, read-only analysis, or explicitly requested throwaway spikes.

## Before Writing Any Test

Clarify the desired behaviour. Ask:

- What outcome does the user/caller expect?
- What are the inputs and observable effects?
- Are there edge cases or failure modes we know about?

Don't enumerate classes or components — list **behaviours**. The remaining behaviours will emerge as implementation progresses.

## RED → GREEN → REFACTOR

1. **RED** — Write one failing test that describes a desired behaviour. Focus on the public interface: inputs, outputs, observable effects. If ideas are easy to express in the test, they will be easy to express when someone uses the code. The test must compile (add stubs if needed).

2. **GREEN** — Ask: "what's stopping this test from passing right now?" Name that one thing. Fix it. Reassess. If the answer is a collaborator that doesn't exist, drop down and build it with its own RED → GREEN → REFACTOR loop — the collaborator's behaviour should help the consumer fulfil its responsibility. If the answer is one line of code, write that line. Do the simplest thing that works.

3. **REFACTOR** — Improve the design without changing behaviour. This is where strategic thinking happens — separation of concerns, modularity, cohesion. This step is not optional cleanup. Re-read the change as a reviewer would: error handling gaps, leaked internals, inconsistencies with the rest of the codebase, missed failure modes. Passing tests don't catch any of that. If nothing needs refactoring, say so.

4. **Review** — Are any proposed tests now redundant? Have new behaviours emerged? Then write the next test.

## What Makes a Good Test

- Tests describe **what the system should do**, not how it does it.
- A test should respond to behaviour changes and be insensitive to structure changes.
- If refactoring forces test changes, the tests are coupled to implementation.
- Test names read as specifications of observable behaviour. Never name a factory, class, option key, or framework API in the title.
  - Bad: `"createRouteHandler propagates Env so c.get is strictly typed"`
  - Bad: `"input hook combines validated data with context to produce handler input"`
  - Good: `"middleware variables are type-safe inside the input projection"`
  - Good: `"middleware-attached values can be projected into the handler input"`
- Before writing a new test, check whether an existing test already asserts this behaviour in any configuration. If a broader-scenario test subsumes it, don't write the narrower one — duplicates only surface when you audit later, and then they're work to remove. Write the most comprehensive test first.

## Acceptance Tests (Outer-Inner Loop)

For features where multiple classes must collaborate, wrap the inner loop in an outer acceptance test. Not every change needs one — use sparingly.

1. Write ONE failing acceptance test using the public API as a developer would. It reads like documentation.
2. Ask: "why does it fail? What's the first missing piece?" Drop into the inner loop.
3. Come back up. Does the acceptance test pass? If not, identify the next missing piece and repeat.
4. Only after it passes, consider whether a second acceptance test is needed.

## DO NOT

- **DO NOT write multiple tests before getting the first one passing.**
- **DO NOT write implementation before the failing test.**
- **DO NOT plan classes, dependencies, or architecture upfront.** Plan which behaviours to test. The implementation emerges.
- **DO NOT batch work.** Every RED, GREEN, and REFACTOR is a checkpoint.
- **DO NOT describe what you "need to build" in the GREEN phase.** Describe what's missing — what gap is preventing the test from passing right now?

## Testing Style

- **Default: Detroit/classicist** — real objects, assert on outcomes. Use **fakes** (lightweight in-memory implementations of an interface, e.g. PGlite instead of Postgres) when real infrastructure is impractical. Fakes behave like the real thing but are fast and disposable. They are not mocks — they have real logic, not expectations.
- **At boundaries: London/mockist** — spy on collaborator contracts when the interaction is the behaviour. Use mocks (objects that record calls and assert expectations) sparingly and only at true boundaries.
- **Acceptance tests: real objects and fakes only.** No mocks.

## Stubs

- When a test needs types that don't exist yet, add minimal stubs so it compiles.
- **Stubs must not make the test pass.** A stub exists only to satisfy the compiler — it should throw or return nothing. If your stubs contain real logic, the test will go GREEN before you've built anything, defeating the entire RED → GREEN → REFACTOR loop. The implementation is built incrementally through the inner loop, not front-loaded into stubs.
- No "stub" or "not yet implemented" comments.

---

# Code Quality

- Never use `as` type assertions. Use proper type annotations (`const x: Type = ...`) or fix the underlying types. The `no-unsafe-type-assertion` lint rule enforces this.
- Always run `vp check` (not just `vp test`) before considering a change complete — it catches type errors and lint violations that tests miss.
- The linter is **oxlint**. Suppression syntax is `// oxlint-disable <rule>` / `// oxlint-enable <rule>` (or `// oxlint-disable-next-line <rule>`). Never write `// biome-ignore`, `// eslint-disable`, or any other linter's syntax.

# Commits and Builds

- Always include `bun.lock` in commits that change any `package.json`. The lockfile must stay in sync or CI resolves different versions.
- `vp pack` and `vp run -r build` rewrite `exports` in `package.json` from `./src/*.ts` to `./dist/*.mjs`. After running either, check `git diff` for export-path changes and restore source paths before committing.

# Conventions

- Test files are co-located with source files using a `.test.ts` suffix.
- Acceptance tests live at `packages/core/src/acceptance.test.ts`.
- Shared test fixtures (aggregates, schemas, repos) live in `packages/core/src/test-support/fixtures.ts`.
- Use the `#litmus/*` import alias for absolute imports within `@litmus/core`.
- Import test utilities from `vite-plus/test`, not `vitest`.

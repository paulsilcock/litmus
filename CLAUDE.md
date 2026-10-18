# Litmus

Litmus is a TypeScript framework that makes test-driven development natural for modern applications — including those with non-deterministic AI components. Litmus provides domain primitives and entrypoint adapters that encourage modular, testable architectures, alongside test utilities that bring TDD discipline to acceptance tests and AI evaluations.

## Philosophy

- **TDD as a design methodology.** The primitives are shaped so that writing the test first is the easiest way to build. Acceptance tests, unit tests, and evals all follow the same RED → GREEN → REFACTOR loop.
- **Agents are actors, not framework features.** An AI agent interacts with the system through use cases — the same way a user would via HTTP or CLI. Litmus provides the entrypoint adapters and the testable boundaries, not the control loop.
- **Separate deterministic from non-deterministic.** Domain logic, orchestration, and routing are deterministic and tested with conventional assertions. AI tasks (single LLM calls) are the non-deterministic boundary, tested with evaluations and probabilistic assertions.
- **Only mock dependencies you own.** AI SDK calls are wrapped in application-defined task interfaces, keeping the mockable surface under your control.

## Packages

This monorepo contains packages under `packages/`:

- **`@litmus/core`** — Domain primitives and use case types: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `DomainError`, `Repository`, `CommandHandler`, `QueryHandler`. Sub-paths: `./ai` (AiTask, Agent, Toolbox, GenerationFunction contract with Message/Prompt/Tool types, `Audio`, and the voice contract — `VoiceModel` with its `inputSampleRate`, `VoiceSession`, `SimulatedUserAction`), `./db` (DbContext interface), `./id` (prefixedUlid), `./events` (DomainEventDispatcher).
- **`@litmus/db`** — Database adapters. Sub-path `@litmus/db/drizzle/postgres` exposes `DrizzleDbContext`, `DrizzlePostgresRepository`, `ConcurrencyError`. `drizzle-orm` is a peer dep.
- **`@litmus/http`** — HTTP entrypoint adapter wrapping Hono. Exports `routeHandler` (use case → route with zod validation, verb-based status defaults, SSE streaming, custom respond callback) and `serve` (lifecycle wrapper with `onBeforeStart`/`onBeforeStop` and structured `DomainError` → HTTP mapping). Sub-path `@litmus/http/testing` exposes `BaseHttpDriver` and `BaseHonoDriver<T>` for ATDD. `hono` and `@hono/node-server` are peer deps.
- **`@litmus/cli`** — CLI entrypoint adapter. Typed command registration, grouped commands, unix socket transport with typed `cliClient` for RPC-style calls. Sub-path `@litmus/cli/testing` exposes `BaseLitmusCliDriver<T>` for ATDD. `zod` is a peer dep.
- **`@litmus/log`** — Structured logging with context propagation via `AsyncLocalStorage`. Pino-backed `Logger` implementation extending the abstract base in core. `pino` is a peer dep.
- **`@litmus/ai`** — AI SDK adapters. Sub-path `@litmus/ai/vercel` exposes `toVercelTools` (converts a `ToolSelection` or tool record to Vercel AI SDK tool format) and `vercelGenerator({ model, schema, maxSteps? })` (a Vercel-backed `GenerationFunction` with schema-constrained output and per-call tools). Sub-path `@litmus/ai/openai` exposes `OpenAIRealtimeVoiceModel` (a `VoiceModel` over the OpenAI Realtime API, via `ws`); `@litmus/ai/openai/testing` exposes `FakeRealtimeServer`, a local stub of the Realtime wire protocol for tests. `ai` is a peer dep.
- **`@litmus/test`** — Test utilities for non-deterministic and acceptance testing. `evaluate()` probabilistic runner (samples, scenarios, pass rates, extend, concurrent), `synthesize()` for fanning out hand-written seeds into more scenarios via an LLM (hash-keyed file cache, opt-in regeneration via `LITMUS_SYNTH_MODE=regenerate`; usable standalone or as `evaluate.scenarios({ synthesize })`), `Grader` type for LLM-as-judge functions, `UserSimulator.text()` for multi-turn conversation simulation (scripted `write`/`read` and autonomous `pursueGoal`; generation injected as a `GenerationFunction<Utterance>` via `generateResponse`, abilities as core `Tool` records), `UserSimulator.voice()` for spoken conversations through a `VoiceModel` (audio piped via `speak`/`listen`; `hear()` and `pursueGoal(goal, { maxTurns })`; `silenceTimeout` fails a silent system; every failure ends the conversation, and later calls throw saying why), `useInMemoryTracing()` helper, `BaseBrowserDriver` for browser-based ATDD, and the abstract `BaseDriver` lifecycle (async `init()` and `cleanup()`) that all entrypoint-specific drivers extend. `ai` and `playwright` are peer deps. For browser tests: `vp dlx playwright install --with-deps chromium`.
- **`@litmus/test-acceptance`** _(private)_ — Cross-package acceptance tests. Lives outside core/db/http to avoid coupling adapters to acceptance tests of cross-cutting concerns.

Tests use `it()` (not `test()`) and import test utilities from `vite-plus/test`. Test files are co-located with source files using `.test.ts` suffix.

<!--VITE PLUS START-->

# Using Vite+, the Unified Toolchain for the Web

This project is using Vite+, a unified toolchain built on top of Vite, Rolldown, Vitest, tsdown, Oxlint, Oxfmt, and Vite Task. Vite+ wraps runtime management, package management, and frontend tooling in a single global CLI called `vp`. Vite+ is distinct from Vite, and it invokes Vite through `vp dev` and `vp build`. Run `vp help` to print a list of commands and `vp <command> --help` for information about a specific command.

Docs are local at `node_modules/vite-plus/docs` or online at https://viteplus.dev/guide/.

## Built-in Commands vs Scripts

`vp <name>` runs a built-in command. `vp run <name>` runs a `package.json` script or a `vite.config.ts` task. Scripts cannot overwrite built-ins, so `vp dev` and `vp run dev` may do different things. Check `package.json` and `vite.config.ts` first, and run `vp run <name>` when the project defines a script or task with that name.

## Tool Versions

Run `vp toolchain` to show versions and relationships in the active Vite+
release. Add a tool name to select part of the graph. For example, run
`vp toolchain vite`. Use `--global` to ignore the local `vite-plus` package. Use
`vp why <package>` to show the package-manager dependency graph.

## Review Checklist

- [ ] Run `vp install` after pulling remote changes and before getting started.
- [ ] Run `vp check` and `vp test` to format, lint, type check and test changes.
- [ ] Check if there are `vite.config.ts` tasks or `package.json` scripts necessary for validation, run via `vp run <script>`.
- [ ] If setup, runtime, or package-manager behavior looks wrong, run `vp env doctor` and include its output when asking for help.

<!--VITE PLUS END-->

# Litmus

A TypeScript framework that makes test-driven development natural for modern applications — including those with non-deterministic AI components. Litmus provides domain primitives and entrypoint adapters that encourage modular, testable architectures, alongside test utilities that bring TDD discipline to acceptance tests and AI evaluations.

Monorepo powered by [Vite+](https://viteplus.dev) (`vp`) as the unified toolchain.

## Prerequisites

- [Node.js](https://nodejs.org/) >= 24.14.1
- [Bun](https://bun.sh/) >= 1.3.11
- [Vite+](https://viteplus.dev/guide/) (`vp`) CLI installed globally

### Installing Vite+

```bash
curl -fsSL https://vite.plus | bash
```

Verify the installation:

```bash
vp -V
```

## Development

Install dependencies:

```bash
vp install
```

Browser-based tests use Playwright. Install Chromium and its system dependencies:

```bash
vp dlx playwright install --with-deps chromium
```

Run all checks (format, lint, test, build):

```bash
vp run ready
```

Run tests:

```bash
vp run -r test
```

Build:

```bash
vp run -r build
```

## Packages

- **`@litmus/core`** — Domain primitives and use case types: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `DomainError`, `Repository`, `CommandHandler`, `QueryHandler`. Sub-paths: `./ai` (AiTask, Agent, Toolbox), `./db` (DbContext interface), `./id` (prefixedUlid), `./events` (DomainEventDispatcher).
- **`@litmus/db`** — Database adapters. Sub-path `@litmus/db/drizzle/postgres` exposes `DrizzleDbContext`, `DrizzlePostgresRepository`, `ConcurrencyError`. `drizzle-orm` is a peer dep.
- **`@litmus/http`** — HTTP entrypoint adapter wrapping Hono. Exports `routeHandler` (adapts use cases to routes with validation, status defaults, SSE streaming) and `serve` (lifecycle wrapper with init/stop hooks and structured error mapping). `hono` and `@hono/node-server` are peer deps.
- **`@litmus/cli`** — CLI entrypoint adapter. Typed command registration, grouped commands, unix socket transport with typed `cliClient` for RPC-style calls. `zod` is a peer dep.
- **`@litmus/log`** — Structured logging with context propagation via `AsyncLocalStorage`. Pino-backed `Logger` implementation. `pino` is a peer dep.
- **`@litmus/ai`** — AI SDK adapters. Sub-path `@litmus/ai/vercel` converts a `Toolbox` to Vercel AI SDK tool format. `ai` is a peer dep.
- **`@litmus/test`** — Test utilities for non-deterministic and acceptance testing. `trial()` probabilistic runner, `Grader` type, `UserSimulator`, and `BaseHttpDriver`/`BaseHonoDriver`/`BaseLitmusCliDriver`/`BaseBrowserDriver` for ATDD. `playwright` is a peer dep — install with `vp dlx playwright install --with-deps chromium` if using `BaseBrowserDriver`.
- **`@litmus/test-acceptance`** _(private)_ — Cross-package acceptance tests that exercise the framework end-to-end.

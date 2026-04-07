# Litmus

A TypeScript framework for building applications with agentic AI capabilities. It combines building blocks that encourage testable architectures with first-class test utilities to make ATDD, TDD, and eval-driven development the path of least resistance.

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

- **`@litmus/core`** — Domain primitives and use case types: `AggregateRoot`, `Entity`, `ValueObject`, `DomainEvent`, `DomainError`, `Repository`, `CommandHandler`, `QueryHandler`. Zero vendor dependencies.
- **`@litmus/db`** — Database adapters. Currently exposes `@litmus/db/drizzle/postgres` with `DrizzleDbContext` and `DrizzlePostgresRepository`. `drizzle-orm` is a peer dep.
- **`@litmus/http`** — HTTP entrypoint adapter wrapping Hono. Exports `routeHandler` (adapts use cases to routes with validation, status defaults, SSE streaming) and `serve` (lifecycle wrapper with init/stop hooks and structured error mapping).
- **`@litmus/test-acceptance`** _(private)_ — Cross-package acceptance tests that exercise the framework end-to-end.

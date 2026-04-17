# @litmus/test-acceptance

Private package. Not published.

## What this is for

Cross-package acceptance tests for the Litmus framework. Lives outside `@litmus/core`, `@litmus/db`, and `@litmus/http` so that acceptance tests exercising cross-cutting concerns don't force those packages to depend on each other (or on test infrastructure).

## The bookshop

A realistic example application — customers, books, carts, orders, email confirmations — used to exercise the framework end-to-end. It is not a starter template and is not published. Its job is to answer: _if you build a real application on Litmus, does the framework hold up?_

Concretely, the bookshop demonstrates:

- **Aggregates and invariants** — `Cart`, `Order`, `Customer` as `AggregateRoot` with domain events
- **Use cases** — `CommandHandler` / `QueryHandler` composed via tsyringe DI
- **Repositories** — `DrizzlePostgresRepository` against PGlite (in-memory Postgres)
- **Event-driven reactions** — `OrderPlaced` → `CloseCart` + `SendOrderConfirmation`, wired via `registerDomainEventHandlers([...])`
- **HTTP entrypoints** — Hono routes via `@litmus/http` `routeHandler`, with structured `DomainError` → status mapping
- **Acceptance testing** — `BaseHttpDriver` + DSL, booting the real app on a free port and interacting only through HTTP

Acceptance tests live in [src/bookshop/test-acceptance/](src/bookshop/test-acceptance/) and treat the system as a black box: no container access, no direct DB writes.

## Layout

```
src/bookshop/
  bookshop.ts              boot function — DI, DB, HTTP server, event handlers
  domain/                  aggregates, value objects, domain events
  use-cases/               command + query handlers
  infra/
    db/                    Drizzle schema
    repositories/          DrizzlePostgresRepository subclasses
    email/                 EmailService interface + HTTP stub client
    payments/              PaymentGateway interface + stub
  entrypoints/http/        Hono route files
  test-acceptance/         black-box acceptance tests + DSL + driver
  test-support/            in-process DI wiring for use-case tests
```

## Running tests

From the repo root:

```bash
vp install
vp test
```

import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { serve } from "@litmus/http";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { container } from "tsyringe";

import { createBookshopApp } from "./entrypoints/http/app.ts";
import { schema } from "./infra/db/schema.ts";
import { PAYMENT_GATEWAY } from "./infra/payments/payment-gateway.ts";
import { StubPaymentGateway } from "./infra/payments/stub-payment-gateway.ts";

export interface RunningBookshop {
  baseUrl: string;
  stop(): Promise<void>;
}

/**
 * Boot a real bookshop instance: in-memory Postgres, the Hono app
 * served on a free port, and DI bindings registered for tsyringe to
 * resolve use cases and repositories. Returns a public-interface
 * handle (base URL + stop). Acceptance tests interact with the
 * system via this handle and the system's HTTP routes — never by
 * touching the container or the database directly.
 */
export async function bootstrapBookshop(): Promise<RunningBookshop> {
  const pg = new PGlite();
  const rawDb = drizzle(pg);
  const { apply } = await pushSchema(schema, rawDb);
  await apply();

  const db = drizzle(pg, { schema });
  const ctx = new DrizzleDbContext(db, new DomainEventDispatcher());

  container.registerInstance(DrizzleDbContext, ctx);
  container.registerSingleton(PAYMENT_GATEWAY, StubPaymentGateway);

  const app = createBookshopApp();
  const server = await serve(app, { port: 0 });

  return {
    baseUrl: `http://localhost:${server.port}`,
    async stop() {
      await server.stop();
      container.reset();
    },
  };
}

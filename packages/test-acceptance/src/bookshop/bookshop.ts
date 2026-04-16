import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import {
  DomainEventDispatcher,
  registerDomainEventHandlers,
} from "@litmus/core/events";
import { DRIZZLE_DB } from "@litmus/db/drizzle/postgres";
import { serve } from "@litmus/http";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { container } from "tsyringe";

import { OrderPlaced } from "./domain/order.ts";
import { createBookshopApp } from "./entrypoints/http/app.ts";
import { schema } from "./infra/db/schema.ts";
import { EMAIL_SERVICE } from "./infra/email/email-service.ts";
import { HttpEmailService } from "./infra/email/http-email-service.ts";
import { PAYMENT_GATEWAY } from "./infra/payments/payment-gateway.ts";
import { StubPaymentGateway } from "./infra/payments/stub-payment-gateway.ts";
import {
  type EmailStubServer,
  startEmailStubServer,
} from "./test-acceptance/email-stub-server.ts";
import { CloseCart } from "./use-cases/close-cart.ts";
import { SendOrderConfirmation } from "./use-cases/send-order-confirmation.ts";

export interface RunningBookshop {
  baseUrl: string;
  emailStubBaseUrl: string;
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

  container.registerInstance(DRIZZLE_DB, db);
  container.registerSingleton(DomainEventDispatcher);
  container.registerSingleton(PAYMENT_GATEWAY, StubPaymentGateway);

  const emailStub: EmailStubServer = await startEmailStubServer();
  container.registerInstance(
    EMAIL_SERVICE,
    new HttpEmailService(emailStub.baseUrl),
  );

  registerDomainEventHandlers([
    [OrderPlaced, CloseCart, (event) => ({ cartId: event.cartId })],
    [
      OrderPlaced,
      SendOrderConfirmation,
      (event) => ({ customerId: event.customerId, lines: event.lines }),
    ],
  ]);

  const app = createBookshopApp();
  const server = await serve(app, {
    port: 0,
    errors: {
      CustomerNotFound: 404,
      BookNotFound: 404,
      NoOpenCart: 400,
      EmptyCartCheckout: 400,
    },
  });

  return {
    baseUrl: `http://localhost:${server.port}`,
    emailStubBaseUrl: emailStub.baseUrl,
    async stop() {
      await server.stop();
      await emailStub.stop();
      container.reset();
    },
  };
}

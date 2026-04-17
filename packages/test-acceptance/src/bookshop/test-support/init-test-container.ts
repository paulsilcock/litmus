import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { container } from "tsyringe";

import { schema } from "../infra/db/schema.ts";
import {
  EMAIL_SERVICE,
  type EmailService,
} from "../infra/email/email-service.ts";
import { PAYMENT_GATEWAY } from "../infra/payments/payment-gateway.ts";
import { StubPaymentGateway } from "../infra/payments/stub-payment-gateway.ts";

/**
 * Records sent emails in memory. Lets use case tests assert on
 * `sent` directly without any out-of-process stub.
 */
export class FakeEmailService implements EmailService {
  readonly sent: Array<{ to: string; subject: string; body: string }> = [];

  async send(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    this.sent.push(message);
  }
}

/**
 * Minimal DI wiring for use case tests: in-memory Postgres,
 * stub payment gateway, in-memory email. Tests can override any
 * binding by calling `container.registerInstance(...)` before
 * resolving the use case.
 */
export async function initBookshopTestContainer(): Promise<void> {
  const pg = new PGlite();
  const rawDb = drizzle(pg);
  const { apply } = await pushSchema(schema, rawDb);
  await apply();

  const db = drizzle(pg, { schema });

  DrizzleDbContext.register(db);
  container.registerSingleton(DomainEventDispatcher);
  container.registerSingleton(PAYMENT_GATEWAY, StubPaymentGateway);
  container.registerInstance(EMAIL_SERVICE, new FakeEmailService());
}

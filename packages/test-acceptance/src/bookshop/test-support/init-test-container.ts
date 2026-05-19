import { DomainEventDispatcher } from "@litmus/core/events";
import { setupTestDb } from "@litmus/db/drizzle/postgres/test";
import "reflect-metadata";
import { container } from "tsyringe";
import { beforeEach } from "vite-plus/test";

import { schema } from "#bookshop/infra/db/schema.ts";
import {
  EMAIL_SERVICE,
  type EmailService,
} from "#bookshop/infra/email/email-service.ts";
import { PAYMENT_GATEWAY } from "#bookshop/infra/payments/payment-gateway.ts";
import { StubPaymentGateway } from "#bookshop/infra/payments/stub-payment-gateway.ts";

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
 * Describe-level setup for bookshop use case tests: shares one PGlite
 * instance across the file via `setupTestDb`, then re-registers the
 * bookshop-specific DI bindings before every test so each case starts
 * with fresh singletons.
 *
 * Call once at the top of a `describe` block. Tests then resolve
 * dependencies with `container.resolve(...)`.
 */
export function setupBookshopTest(): void {
  setupTestDb({ schema });

  beforeEach(() => {
    container.registerSingleton(DomainEventDispatcher);
    container.registerSingleton(PAYMENT_GATEWAY, StubPaymentGateway);
    container.registerInstance(EMAIL_SERVICE, new FakeEmailService());
  });
}

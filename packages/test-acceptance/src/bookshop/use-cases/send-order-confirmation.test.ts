import { prefixedUlid } from "@litmus/core/id";
import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Customer } from "../domain/customer.ts";
import { EMAIL_SERVICE } from "../infra/email/email-service.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";
import {
  FakeEmailService,
  setupBookshopTest,
} from "../test-support/init-test-container.ts";
import { SendOrderConfirmation } from "./send-order-confirmation.ts";

describe("SendOrderConfirmation", () => {
  setupBookshopTest();

  it("emails the customer with the order total", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    await container.resolve(SendOrderConfirmation).handle({
      customerId: alice.id,
      lines: [
        { bookId: prefixedUlid("book"), title: "The Hobbit", price: 12.99 },
        { bookId: prefixedUlid("book"), title: "Dune", price: 14.5 },
      ],
    });

    const emails = container.resolve<FakeEmailService>(EMAIL_SERVICE);
    expect(emails.sent).toHaveLength(1);
    expect(emails.sent[0]).toMatchObject({
      to: "alice@example.com",
      subject: "Your order is confirmed",
    });
    expect(emails.sent[0]?.body).toContain("Alice");
    expect(emails.sent[0]?.body).toContain("27.49");
  });
});

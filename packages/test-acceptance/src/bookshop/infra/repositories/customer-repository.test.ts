import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Customer, CustomerNotFound } from "../../domain/customer.ts";
import { initBookshopTestContainer } from "../../test-support/init-test-container.ts";
import { CustomerRepository } from "./customer-repository.ts";

describe("CustomerRepository", () => {
  beforeEach(async () => {
    await initBookshopTestContainer();
  });

  afterEach(() => {
    container.reset();
  });

  it("finds a customer by name", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const found = await customers.findByName("Alice");

    expect(found.id).toBe(alice.id);
    expect(found.email).toBe("alice@example.com");
  });

  it("throws CustomerNotFound when no customer matches the name", async () => {
    const customers = container.resolve(CustomerRepository);

    await expect(customers.findByName("Ghost")).rejects.toBeInstanceOf(
      CustomerNotFound,
    );
  });
});

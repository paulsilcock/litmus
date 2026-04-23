import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Customer, CustomerNotFound } from "../../domain/customer.ts";
import { setupBookshopTest } from "../../test-support/init-test-container.ts";
import { CustomerRepository } from "./customer-repository.ts";

describe("CustomerRepository", () => {
  setupBookshopTest();

  it("finds a customer by email", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const found = await customers.findByEmail("alice@example.com");

    expect(found.id).toBe(alice.id);
    expect(found.name).toBe("Alice");
  });

  it("throws CustomerNotFound when no customer matches the email", async () => {
    const customers = container.resolve(CustomerRepository);

    await expect(
      customers.findByEmail("ghost@example.com"),
    ).rejects.toBeInstanceOf(CustomerNotFound);
  });

  it("finds a customer by id", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const found = await customers.findById(alice.id);

    expect(found.name).toBe("Alice");
    expect(found.email).toBe("alice@example.com");
  });

  it("throws CustomerNotFound when no customer matches the id", async () => {
    const customers = container.resolve(CustomerRepository);

    await expect(customers.findById(customers.nextId())).rejects.toBeInstanceOf(
      CustomerNotFound,
    );
  });
});

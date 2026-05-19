import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Cart } from "#bookshop/domain/cart.ts";
import { Customer } from "#bookshop/domain/customer.ts";
import { setupBookshopTest } from "#bookshop/test-support/init-test-container.ts";

import { CartRepository } from "./cart-repository.ts";
import { CustomerRepository } from "./customer-repository.ts";

describe("CartRepository", () => {
  setupBookshopTest();

  it("findOpenForCustomer returns null when the customer has no open cart", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const carts = container.resolve(CartRepository);

    expect(await carts.findOpenForCustomer(alice.id)).toBeNull();
  });

  it("findById returns null when no cart matches", async () => {
    const carts = container.resolve(CartRepository);

    expect(await carts.findById(carts.nextId())).toBeNull();
  });

  it("findById returns the cart when one exists", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const carts = container.resolve(CartRepository);
    const cart = new Cart({ id: carts.nextId(), customerId: alice.id });
    await carts.add(cart);

    const found = await carts.findById(cart.id);

    expect(found?.id).toBe(cart.id);
    expect(found?.customerId).toBe(alice.id);
  });
});

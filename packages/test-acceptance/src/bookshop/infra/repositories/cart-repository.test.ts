import { container } from "tsyringe";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { Cart, NoOpenCart } from "../../domain/cart.ts";
import { Customer } from "../../domain/customer.ts";
import { initBookshopTestContainer } from "../../test-support/init-test-container.ts";
import { CartRepository } from "./cart-repository.ts";
import { CustomerRepository } from "./customer-repository.ts";

describe("CartRepository", () => {
  beforeEach(async () => {
    await initBookshopTestContainer();
  });

  afterEach(() => {
    container.reset();
  });

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

  it("findOpenForCheckout throws NoOpenCart when the customer has no open cart", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const carts = container.resolve(CartRepository);

    await expect(carts.findOpenForCheckout(alice.id)).rejects.toBeInstanceOf(
      NoOpenCart,
    );
  });

  it("findOpenForCheckout returns the open cart when one exists", async () => {
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

    const found = await carts.findOpenForCheckout(alice.id);

    expect(found.id).toBe(cart.id);
  });
});

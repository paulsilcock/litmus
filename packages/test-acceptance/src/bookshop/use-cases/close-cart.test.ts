import { prefixedUlid } from "@litmus/core/id";
import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Cart } from "../domain/cart.ts";
import { Customer } from "../domain/customer.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";
import { setupBookshopTest } from "../test-support/init-test-container.ts";
import { CloseCart } from "./close-cart.ts";

describe("CloseCart", () => {
  setupBookshopTest();

  it("closes the cart identified by the command", async () => {
    const customers = container.resolve(CustomerRepository);
    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const carts = container.resolve(CartRepository);
    const cart = new Cart({ id: carts.nextId(), customerId: alice.id });
    cart.add({
      bookId: prefixedUlid("book"),
      title: "The Hobbit",
      price: 12.99,
    });
    await carts.add(cart);

    await container.resolve(CloseCart).handle({ cartId: cart.id });

    expect(await carts.findOpenForCustomer(alice.id)).toBeNull();
  });

  it("does nothing when the cart no longer exists", async () => {
    const carts = container.resolve(CartRepository);

    await expect(
      container.resolve(CloseCart).handle({ cartId: carts.nextId() }),
    ).resolves.toBeUndefined();
  });
});

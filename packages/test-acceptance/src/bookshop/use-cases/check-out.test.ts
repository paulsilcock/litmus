import { prefixedUlid } from "@litmus/core/id";
import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Cart } from "../domain/cart.ts";
import { Customer } from "../domain/customer.ts";
import { PAYMENT_GATEWAY } from "../infra/payments/payment-gateway.ts";
import { StubPaymentGateway } from "../infra/payments/stub-payment-gateway.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";
import { setupBookshopTest } from "../test-support/init-test-container.ts";
import { CheckOut } from "./check-out.ts";
import { GetCustomerOrders } from "./get-customer-orders.ts";

describe("CheckOut", () => {
  setupBookshopTest();

  it("charges the cart total and records an order for the customer", async () => {
    const customers = container.resolve(CustomerRepository);
    const carts = container.resolve(CartRepository);

    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const cart = new Cart({ id: carts.nextId(), customerId: alice.id });
    cart.add({
      bookId: prefixedUlid("book"),
      title: "The Hobbit",
      price: 12.99,
    });
    cart.add({ bookId: prefixedUlid("book"), title: "Dune", price: 14.5 });
    await carts.add(cart);

    await container
      .resolve(CheckOut)
      .handle({ customerEmail: "alice@example.com" });

    const payment = container.resolve<StubPaymentGateway>(PAYMENT_GATEWAY);
    expect(payment.charges).toEqual([27.49]);

    const orders = await container
      .resolve(GetCustomerOrders)
      .handle({ customerEmail: "alice@example.com" });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("placed");
    expect(orders[0]?.total).toBe(27.49);
    expect(orders[0]?.lines).toEqual([
      { title: "The Hobbit", price: 12.99 },
      { title: "Dune", price: 14.5 },
    ]);
  });

  it("records a failed order when payment is rejected", async () => {
    container.registerInstance(PAYMENT_GATEWAY, {
      charge: async () => {
        throw new Error("card declined");
      },
    });

    const customers = container.resolve(CustomerRepository);
    const carts = container.resolve(CartRepository);

    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    const cart = new Cart({ id: carts.nextId(), customerId: alice.id });
    cart.add({
      bookId: prefixedUlid("book"),
      title: "The Hobbit",
      price: 12.99,
    });
    await carts.add(cart);

    await expect(
      container
        .resolve(CheckOut)
        .handle({ customerEmail: "alice@example.com" }),
    ).rejects.toThrow("card declined");

    const orders = await container
      .resolve(GetCustomerOrders)
      .handle({ customerEmail: "alice@example.com" });
    expect(orders).toHaveLength(1);
    expect(orders[0]?.status).toBe("failed");
  });
});

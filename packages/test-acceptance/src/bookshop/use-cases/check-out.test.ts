import { describe, expect, it } from "vite-plus/test";

import { Cart } from "../domain/cart.ts";
import { Customer } from "../domain/customer.ts";
import type { Purchase } from "../domain/purchase.ts";
import { CheckOut } from "./check-out.ts";

describe("CheckOut", () => {
  it("takes payment, closes the cart, and records a purchase per book", async () => {
    const alice = new Customer({ id: "customer_1", name: "Alice" });
    const cart = new Cart({ id: "cart_1", customerId: alice.id });
    cart.add({ bookId: "book_1", title: "The Hobbit", price: 12.99 });
    cart.add({ bookId: "book_2", title: "Dune", price: 14.5 });

    let chargedAmount: number | undefined;
    const saved: Purchase[] = [];
    let updatedCart: Cart | undefined;
    let nextPurchaseId = 0;

    const handler = new CheckOut(
      { findByName: async () => alice },
      {
        findOpenForCustomer: async () => cart,
        update: async (c) => {
          updatedCart = c;
        },
      },
      {
        charge: async (amount) => {
          chargedAmount = amount;
        },
      },
      {
        nextId: () => `purchase_${++nextPurchaseId}`,
        add: async (p) => {
          saved.push(p);
        },
      },
    );

    await handler.handle({ customer: "Alice" });

    expect(chargedAmount).toBe(27.49);
    expect(updatedCart?.status).toBe("checked-out");
    expect(saved).toHaveLength(2);
    expect(saved.map((p) => p.bookId)).toEqual(["book_1", "book_2"]);
    expect(saved.every((p) => p.customerId === alice.id)).toBe(true);
  });
});

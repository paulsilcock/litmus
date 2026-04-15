import { describe, expect, it } from "vite-plus/test";

import { Purchase } from "./purchase.ts";

describe("Purchase", () => {
  it("records which customer bought which book", () => {
    const purchase = new Purchase({
      id: "purchase_1",
      customerId: "customer_1",
      bookId: "book_1",
    });

    expect(purchase.customerId).toBe("customer_1");
    expect(purchase.bookId).toBe("book_1");
  });
});

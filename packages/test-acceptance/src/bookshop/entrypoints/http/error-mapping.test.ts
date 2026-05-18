import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";

import { bootstrapBookshop, type RunningBookshop } from "#bookshop/bookshop.ts";

describe("bookshop HTTP error mapping", () => {
  let bookshop: RunningBookshop;

  beforeAll(async () => {
    bookshop = await bootstrapBookshop();
  });

  afterAll(async () => {
    await bookshop.stop();
  });

  it("returns 404 with CUSTOMER_NOT_FOUND when checking out an unknown customer", async () => {
    const res = await fetch(`${bookshop.baseUrl}/checkout`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ customerEmail: "ghost@example.com" }),
    });

    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      code: "CUSTOMER_NOT_FOUND",
      message: "No customer found with email: ghost@example.com",
    });
  });
});

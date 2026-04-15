import { describe, expect, it } from "vite-plus/test";

import { Customer } from "./customer.ts";

describe("Customer", () => {
  it("has a name", () => {
    const customer = new Customer({ id: "customer_1", name: "Alice" });

    expect(customer.name).toBe("Alice");
  });
});

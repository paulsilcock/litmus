import { describe, expect, it } from "vite-plus/test";

import type { Customer } from "../domain/customer.ts";
import { RegisterCustomer } from "./register-customer.ts";

describe("RegisterCustomer", () => {
  it("records a new customer by name", async () => {
    const saved: Customer[] = [];
    const handler = new RegisterCustomer({
      nextId: () => "customer_1",
      add: async (customer) => {
        saved.push(customer);
      },
    });

    await handler.handle({ name: "Alice" });

    expect(saved).toHaveLength(1);
    expect(saved[0]?.name).toBe("Alice");
  });
});

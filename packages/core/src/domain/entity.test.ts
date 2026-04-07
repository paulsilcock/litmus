import { describe, expect, it } from "vite-plus/test";

import { Entity } from "#litmus/domain/entity.ts";

class Order extends Entity<{ id: string }> {}
class User extends Entity<{ id: string }> {}

describe("Entity", () => {
  it("equality is based on identity", () => {
    const order1 = new Order({ id: "abc" });
    const order2 = new Order({ id: "abc" });
    const order3 = new Order({ id: "xyz" });

    expect(order1.equals(order2)).toBe(true);
    expect(order1.equals(order3)).toBe(false);
  });

  it("different entity types with the same id are not equal", () => {
    const order = new Order({ id: "abc" });
    const user = new User({ id: "abc" });

    expect(order.equals(user)).toBe(false);
  });
});

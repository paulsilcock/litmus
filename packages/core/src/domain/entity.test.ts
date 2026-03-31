import { describe, expect, it } from "vite-plus/test";
import { Entity } from "#litmus/domain/entity.ts";

class Order extends Entity {
  constructor(id: string) {
    super(id);
  }
}

class User extends Entity {
  constructor(id: string) {
    super(id);
  }
}

describe("Entity", () => {
  it("equality is based on identity", () => {
    const order1 = new Order("abc");
    const order2 = new Order("abc");
    const order3 = new Order("xyz");

    expect(order1.equals(order2)).toBe(true);
    expect(order1.equals(order3)).toBe(false);
  });

  it("different entity types with the same id are not equal", () => {
    const order = new Order("abc");
    const user = new User("abc");

    expect(order.equals(user)).toBe(false);
  });
});

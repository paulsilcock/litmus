import { Entity } from "./entity";

class TestEntity extends Entity {
  constructor(id: string, public name: string) {
    super(id);
  }
}

describe("Entity", () => {
  it("two entities with the same ID are equal", () => {
    const entity1 = new TestEntity("abc", "Alice");
    const entity2 = new TestEntity("abc", "Bob");

    expect(entity1.equals(entity2)).toBe(true);
  });
});

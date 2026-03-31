import { Entity } from "./entity";

class TestEntity extends Entity {
  constructor(public name: string, id?: string) {
    super(id);
  }
}

describe("Entity", () => {
  it("two entities with the same ID are equal", () => {
    const entity1 = new TestEntity("Alice", "abc");
    const entity2 = new TestEntity("Bob", "abc");

    expect(entity1.equals(entity2)).toBe(true);
  });

  it("two entities with different IDs are not equal", () => {
    const entity1 = new TestEntity("Alice", "abc");
    const entity2 = new TestEntity("Alice", "def");

    expect(entity1.equals(entity2)).toBe(false);
  });

  it("creating a new entity generates a unique ID", () => {
    const entity1 = new TestEntity("Alice");
    const entity2 = new TestEntity("Bob");

    expect(entity1.id).toBeDefined();
    expect(entity1.id).not.toBe(entity2.id);
  });
});

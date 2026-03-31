import { ulid } from "ulidx";

export abstract class Entity {
  public readonly id: string;

  constructor(id?: string) {
    this.id = id ?? ulid();
  }

  equals(other: Entity): boolean {
    return this.id === other.id;
  }
}

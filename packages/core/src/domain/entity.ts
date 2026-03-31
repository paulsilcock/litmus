export abstract class Entity {
  constructor(public readonly id: string) {}

  equals(other: Entity): boolean {
    return this.id === other.id;
  }
}

export abstract class Entity<TId = string> {
  readonly id: TId;

  constructor(id: TId) {
    this.id = id;
  }

  equals(other: Entity<TId>): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}

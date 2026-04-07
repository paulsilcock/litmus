/**
 * Base class for entities — objects with a distinct identity that persists
 * across changes to their state.
 *
 * Two entities are equal if they are the same concrete type and share the
 * same `id`. State is irrelevant for equality.
 *
 * For aggregates (entities with their own consistency boundary, version,
 * and domain events), extend `AggregateRoot` instead.
 *
 * @example
 * ```typescript
 * import { Entity } from "@litmus/core";
 *
 * class User extends Entity {
 *   constructor(id: string, public email: string) {
 *     super(id);
 *   }
 * }
 *
 * const a = new User("user_1", "alice@example.com");
 * const b = new User("user_1", "alice+new@example.com");
 * a.equals(b); // true — same id, same type, even though state differs
 * ```
 */
export abstract class Entity<TId = string> {
  readonly id: TId;

  constructor(id: TId) {
    this.id = id;
  }

  equals(other: Entity<TId>): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}

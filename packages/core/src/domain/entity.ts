/**
 * Base class for entities with identity-based equality.
 *
 * Two entities are considered equal when they share the same constructor
 * and the same `id`, regardless of their other properties. Subclass
 * `Entity` for domain objects whose identity matters (as opposed to
 * value objects, where structural equality matters).
 *
 * @example
 * ```typescript
 * import { Entity } from "@litmus/core";
 *
 * class LineItem extends Entity {
 *   constructor(
 *     id: string,
 *     readonly productId: string,
 *     readonly quantity: number,
 *   ) {
 *     super(id);
 *   }
 * }
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

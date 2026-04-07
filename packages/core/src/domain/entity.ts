/**
 * Base class for entities — objects with a distinct identity that persists
 * across changes to their state.
 *
 * State lives in a private `#data` field accessed via the protected `data`
 * getter. Two entities are equal if they are the same concrete type and
 * share the same `id`. State is irrelevant for equality.
 *
 * For aggregates (entities with their own consistency boundary, version,
 * and domain events), extend `AggregateRoot` instead.
 *
 * @example
 * ```typescript
 * import { Entity } from "@litmus/core";
 *
 * interface UserData {
 *   id: string;
 *   email: string;
 * }
 *
 * class User extends Entity<UserData> {
 *   get email() {
 *     return this.data.email;
 *   }
 * }
 *
 * const a = new User({ id: "user_1", email: "alice@example.com" });
 * const b = new User({ id: "user_1", email: "alice+new@example.com" });
 * a.equals(b); // true — same id, same type, even though state differs
 * ```
 */
export abstract class Entity<TData extends { id: TId }, TId = string> {
  #data: TData;

  constructor(data: TData) {
    this.#data = data;
  }

  get id(): TId {
    return this.#data.id;
  }

  protected get data(): TData {
    return this.#data;
  }

  protected setData(data: TData): void {
    this.#data = data;
  }

  equals(other: Entity<TData, TId>): boolean {
    return this.constructor === other.constructor && this.id === other.id;
  }
}

/**
 * Base class for value objects — immutable objects whose identity is
 * defined by their attributes rather than an id.
 *
 * Two value objects are equal if they are the same concrete type and all
 * their `properties()` match. Subclasses implement `properties()` to expose
 * the fields that participate in equality.
 *
 * Use value objects for things like money, addresses, date ranges, and
 * any concept where "two things with the same data" are interchangeable.
 *
 * @example
 * ```typescript
 * import { ValueObject } from "@litmus/core";
 *
 * class Money extends ValueObject {
 *   constructor(
 *     readonly amount: number,
 *     readonly currency: string,
 *   ) {
 *     super();
 *   }
 *
 *   protected properties() {
 *     return { amount: this.amount, currency: this.currency };
 *   }
 * }
 *
 * new Money(100, "GBP").equals(new Money(100, "GBP")); // true
 * new Money(100, "GBP").equals(new Money(100, "USD")); // false
 * ```
 */
export abstract class ValueObject {
  protected abstract properties(): Record<string, unknown>;

  equals(other: ValueObject): boolean {
    if (this.constructor !== other.constructor) return false;

    const a = this.properties();
    const b = other.properties();
    const keys = Object.keys(a);

    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => a[key] === b[key]);
  }
}

/**
 * Base class for value objects with structural equality.
 *
 * Value objects have no identity -- two instances are equal when their
 * properties are equal. Subclass `ValueObject` and implement `properties()`
 * to return the fields that define equality.
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

import { ulid } from "ulidx";

/**
 * A ULID string prefixed with a human-readable label.
 *
 * The prefix makes aggregate IDs easy to identify at a glance
 * in logs, URLs, and database rows (e.g. `"order_01ARZ3NDEKTSV4RRFFQ69G5FAV"`).
 */
export type PrefixedUlid<T extends string> = `${T}_${string}`;

/**
 * Generates a ULID with a human-readable prefix for aggregate IDs.
 *
 * @example
 * ```typescript
 * import { prefixedUlid } from "@litmus/core";
 *
 * const orderId = prefixedUlid("order");
 * // => "order_01ARZ3NDEKTSV4RRFFQ69G5FAV"
 * ```
 */
export function prefixedUlid<T extends string>(prefix: T): PrefixedUlid<T> {
  return `${prefix}_${ulid()}`;
}

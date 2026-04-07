import { ulid } from "ulidx";

/**
 * Type for a ULID prefixed with the aggregate type, e.g. `"order_01ARZ3..."`.
 *
 * The literal prefix is preserved in the type, so a function can demand
 * a specific kind of id at compile time:
 *
 * ```typescript
 * function shipOrder(id: PrefixedUlid<"order">) { ... }
 * ```
 */
export type PrefixedUlid<T extends string> = `${T}_${string}`;

/**
 * Generates a new ULID with a human-readable type prefix.
 *
 * Prefixed IDs are easier to recognise in logs, errors, and database rows
 * than raw ULIDs or UUIDs — you can tell at a glance whether `cust_01...`
 * is a customer or an order. The prefix is your aggregate type's short
 * name (singular, snake_case).
 *
 * Repositories typically wrap this in their `nextId()` method so callers
 * never have to choose the prefix themselves.
 *
 * @example
 * ```typescript
 * import { prefixedUlid } from "@litmus/core/id";
 *
 * class OrderRepository extends DrizzlePostgresRepository<Order, typeof orders> {
 *   nextId() {
 *     return prefixedUlid("order");
 *     // -> "order_01ARZ3NDEKTSV4RRFFQ69G5FAV"
 *   }
 * }
 * ```
 */
export function prefixedUlid<T extends string>(prefix: T): PrefixedUlid<T> {
  return `${prefix}_${ulid()}`;
}

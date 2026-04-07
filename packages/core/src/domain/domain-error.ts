/**
 * Base class for errors that represent expected failure modes in the
 * domain — things the application is designed to handle, not bugs.
 *
 * Each subclass carries a stable, machine-readable `code` that
 * downstream layers (HTTP, CLI, message handlers) can use to map
 * the failure to the appropriate response. The human-readable
 * `message` is for developers and logs; the `code` is the contract.
 *
 * `@litmus/http`'s `serve()` accepts a map from error class names to
 * HTTP status codes and produces structured `{ code, message }` responses
 * automatically.
 *
 * @example
 * ```typescript
 * import { DomainError } from "@litmus/core";
 *
 * class InsufficientFunds extends DomainError {
 *   constructor(accountId: string, requested: number, available: number) {
 *     super(
 *       "INSUFFICIENT_FUNDS",
 *       `Account ${accountId} cannot withdraw ${requested}, only ${available} available`,
 *     );
 *   }
 * }
 *
 * class OrderNotFound extends DomainError {
 *   constructor(orderId: string) {
 *     super("ORDER_NOT_FOUND", `Order ${orderId} not found`);
 *   }
 * }
 * ```
 */
export abstract class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

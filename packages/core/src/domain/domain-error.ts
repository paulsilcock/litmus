/**
 * Base class for domain-specific errors.
 *
 * Subclass `DomainError` to represent business rule violations.
 * Each error carries a machine-readable `code` (useful for API responses
 * and client-side branching) alongside the human-readable `message`.
 *
 * @example
 * ```typescript
 * import { DomainError } from "@litmus/core";
 *
 * class InsufficientFunds extends DomainError {
 *   constructor(accountId: string, amount: number) {
 *     super("INSUFFICIENT_FUNDS", `Account ${accountId} lacks ${amount}`);
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

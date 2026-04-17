/**
 * Port for taking payment. Implementations live alongside the
 * concrete payment provider (real Stripe in production, a stub
 * in tests). The use cases depend on this contract — never on a
 * specific provider — so the system stays testable.
 *
 * Bound via the `PAYMENT_GATEWAY` token rather than a class token
 * because tsyringe rejects abstract classes as injection tokens.
 */
export interface PaymentGateway {
  charge(amount: number): Promise<void>;
}

export const PAYMENT_GATEWAY = "PaymentGateway" as const;

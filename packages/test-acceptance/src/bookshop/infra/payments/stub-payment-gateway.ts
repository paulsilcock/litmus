import type { PaymentGateway } from "./payment-gateway.ts";

/**
 * Success-by-default payment gateway for the bookshop example.
 * Records each charge so tests can inspect it if they care.
 */
export class StubPaymentGateway implements PaymentGateway {
  readonly charges: number[] = [];

  async charge(amount: number): Promise<void> {
    this.charges.push(amount);
  }
}

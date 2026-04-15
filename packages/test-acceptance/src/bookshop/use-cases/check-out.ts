import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import type { Cart } from "../domain/cart.ts";
import type { Customer } from "../domain/customer.ts";
import { Purchase } from "../domain/purchase.ts";

interface CustomerLookup {
  findByName(name: string): Promise<Customer | null>;
}

interface CartRepository {
  findOpenForCustomer(customerId: string): Promise<Cart | null>;
  update(cart: Cart): Promise<void>;
}

export interface PaymentGateway {
  charge(amount: number): Promise<void>;
}

interface PurchaseRepository {
  nextId(): string;
  add(purchase: Purchase): Promise<void>;
}

interface CheckOutCommand extends Record<string, unknown> {
  customer: string;
}

@injectable()
export class CheckOut extends CommandHandler<CheckOutCommand> {
  constructor(
    @inject("CustomerLookup") private readonly customers: CustomerLookup,
    @inject("CartRepository") private readonly carts: CartRepository,
    @inject("PaymentGateway") private readonly payments: PaymentGateway,
    @inject("PurchaseRepository")
    private readonly purchases: PurchaseRepository,
  ) {
    super();
  }

  async handle({ customer }: CheckOutCommand): Promise<void> {
    const c = await this.customers.findByName(customer);
    if (!c) throw new Error(`Unknown customer: ${customer}`);

    const cart = await this.carts.findOpenForCustomer(c.id);
    if (!cart) throw new Error(`No open cart for customer ${customer}`);

    await this.payments.charge(cart.total);

    cart.checkOut();
    await this.carts.update(cart);

    for (const line of cart.items) {
      await this.purchases.add(
        new Purchase({
          id: this.purchases.nextId(),
          customerId: c.id,
          bookId: line.bookId,
        }),
      );
    }
  }
}

import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import { Order } from "../domain/order.ts";
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "../infra/payments/payment-gateway.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";
import { OrderRepository } from "../infra/repositories/order-repository.ts";

interface CheckOutCommand extends Record<string, unknown> {
  customer: string;
}

@injectable()
export class CheckOut extends CommandHandler<CheckOutCommand> {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly carts: CartRepository,
    @inject(PAYMENT_GATEWAY) private readonly payments: PaymentGateway,
    private readonly orders: OrderRepository,
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

    const order = Order.place({
      id: this.orders.nextId(),
      customerId: c.id,
      lines: [...cart.items],
    });
    await this.orders.add(order);
  }
}

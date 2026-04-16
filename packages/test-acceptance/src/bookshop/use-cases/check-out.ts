import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import { NoOpenCart } from "../domain/cart.ts";
import { Order } from "../domain/order.ts";
import {
  PAYMENT_GATEWAY,
  type PaymentGateway,
} from "../infra/payments/payment-gateway.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";
import { OrderRepository } from "../infra/repositories/order-repository.ts";

interface CheckOutCommand extends Record<string, unknown> {
  customerEmail: string;
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

  async handle({ customerEmail }: CheckOutCommand): Promise<void> {
    const customer = await this.customers.findByEmail(customerEmail);
    const cart = await this.carts.findOpenForCustomer(customer.id);
    if (!cart) throw new NoOpenCart(customer.id);

    try {
      await this.payments.charge(cart.total);
    } catch (err) {
      const failed = Order.fail({
        id: this.orders.nextId(),
        customerId: customer.id,
        lines: cart.items,
      });
      await this.orders.add(failed);
      throw err;
    }

    const order = Order.place({
      id: this.orders.nextId(),
      customerId: customer.id,
      cartId: cart.id,
      lines: cart.items,
    });
    await this.orders.add(order);
  }
}

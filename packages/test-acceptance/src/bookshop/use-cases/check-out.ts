import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import { Order } from "../domain/order.ts";
import {
  EMAIL_SERVICE,
  type EmailService,
} from "../infra/email/email-service.ts";
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
    @inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {
    super();
  }

  async handle({ customer }: CheckOutCommand): Promise<void> {
    const c = await this.customers.findByName(customer);
    const cart = await this.carts.findOpenForCheckout(c.id);

    try {
      await this.payments.charge(cart.total);
    } catch (err) {
      const failed = Order.fail({
        id: this.orders.nextId(),
        customerId: c.id,
        lines: [...cart.items],
      });
      await this.orders.add(failed);
      throw err;
    }

    cart.checkOut();
    await this.carts.update(cart);

    const order = Order.place({
      id: this.orders.nextId(),
      customerId: c.id,
      lines: [...cart.items],
    });
    await this.orders.add(order);

    await this.email.send({
      to: c.email,
      subject: `Your order is confirmed`,
      body: `Thanks for your order, ${c.name}. Total: £${order.total.toFixed(2)}.`,
    });
  }
}

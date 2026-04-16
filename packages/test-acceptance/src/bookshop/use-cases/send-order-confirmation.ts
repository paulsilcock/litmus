import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import type { CustomerId } from "../domain/customer.ts";
import type { OrderLine } from "../domain/order.ts";
import {
  EMAIL_SERVICE,
  type EmailService,
} from "../infra/email/email-service.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

interface SendOrderConfirmationCommand extends Record<string, unknown> {
  customerId: CustomerId;
  lines: readonly OrderLine[];
}

@injectable()
export class SendOrderConfirmation extends CommandHandler<SendOrderConfirmationCommand> {
  constructor(
    private readonly customers: CustomerRepository,
    @inject(EMAIL_SERVICE) private readonly email: EmailService,
  ) {
    super();
  }

  async handle({
    customerId,
    lines,
  }: SendOrderConfirmationCommand): Promise<void> {
    const customer = await this.customers.findById(customerId);
    const cents = lines.reduce(
      (sum, line) => sum + Math.round(line.price * 100),
      0,
    );
    const total = cents / 100;

    await this.email.send({
      to: customer.email,
      subject: "Your order is confirmed",
      body: `Thanks for your order, ${customer.name}. Total: £${total.toFixed(2)}.`,
    });
  }
}

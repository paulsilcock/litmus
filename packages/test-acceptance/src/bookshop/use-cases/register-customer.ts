import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import { Customer } from "../domain/customer.ts";

interface CustomerRepository {
  nextId(): string;
  add(customer: Customer): Promise<void>;
}

interface RegisterCustomerCommand extends Record<string, unknown> {
  name: string;
}

@injectable()
export class RegisterCustomer extends CommandHandler<RegisterCustomerCommand> {
  constructor(
    @inject("CustomerRepository")
    private readonly customers: CustomerRepository,
  ) {
    super();
  }

  async handle({ name }: RegisterCustomerCommand): Promise<void> {
    const id = this.customers.nextId();
    await this.customers.add(new Customer({ id, name }));
  }
}

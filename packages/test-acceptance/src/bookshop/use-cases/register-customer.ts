import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";
import { z } from "zod";

import { Customer } from "../domain/customer.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

export const RegisterCustomerSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

interface RegisterCustomerCommand extends Record<string, unknown> {
  name: string;
  email: string;
}

@injectable()
export class RegisterCustomer extends CommandHandler<RegisterCustomerCommand> {
  constructor(private readonly customers: CustomerRepository) {
    super();
  }

  async handle({ name, email }: RegisterCustomerCommand): Promise<void> {
    const id = this.customers.nextId();
    await this.customers.add(new Customer({ id, name, email }));
  }
}

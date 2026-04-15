import { AggregateRoot, type AggregateData, DomainError } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

export type CustomerId = PrefixedUlid<"customer">;

export class CustomerNotFound extends DomainError {
  constructor(name: string) {
    super("CUSTOMER_NOT_FOUND", `No customer found with name: ${name}`);
  }
}

interface CustomerData extends AggregateData<CustomerId> {
  name: string;
  email: string;
}

export class Customer extends AggregateRoot<CustomerData, CustomerId> {
  get name(): string {
    return this.data.name;
  }

  get email(): string {
    return this.data.email;
  }
}

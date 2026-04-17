import { AggregateRoot, type AggregateData, DomainError } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

export type CustomerId = PrefixedUlid<"customer">;

export class CustomerNotFound extends DomainError {
  constructor(identifier: { email: string } | { id: CustomerId }) {
    const message =
      "email" in identifier
        ? `No customer found with email: ${identifier.email}`
        : `No customer found with id: ${identifier.id}`;
    super("CUSTOMER_NOT_FOUND", message);
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

import { AggregateRoot, type AggregateData } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

export type CustomerId = PrefixedUlid<"customer">;

interface CustomerData extends AggregateData<CustomerId> {
  name: string;
}

export class Customer extends AggregateRoot<CustomerData, CustomerId> {
  get name(): string {
    return this.data.name;
  }
}

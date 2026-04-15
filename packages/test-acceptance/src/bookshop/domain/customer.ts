import { AggregateRoot, type AggregateData } from "@litmus/core";

interface CustomerData extends AggregateData {
  name: string;
}

export class Customer extends AggregateRoot<CustomerData> {
  get name(): string {
    return this.data.name;
  }
}

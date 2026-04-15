import { AggregateRoot, type AggregateData } from "@litmus/core";

interface PurchaseData extends AggregateData {
  customerId: string;
  bookId: string;
}

export class Purchase extends AggregateRoot<PurchaseData> {
  get customerId(): string {
    return this.data.customerId;
  }

  get bookId(): string {
    return this.data.bookId;
  }
}

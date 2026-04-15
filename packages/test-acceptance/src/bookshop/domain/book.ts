import { AggregateRoot, type AggregateData } from "@litmus/core";

interface BookData extends AggregateData {
  title: string;
  author: string;
  price: number;
}

export class Book extends AggregateRoot<BookData> {
  get title(): string {
    return this.data.title;
  }

  get author(): string {
    return this.data.author;
  }

  get price(): number {
    return this.data.price;
  }
}

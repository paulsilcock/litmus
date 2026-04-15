import { AggregateRoot, type AggregateData } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

export type BookId = PrefixedUlid<"book">;

interface BookData extends AggregateData<BookId> {
  title: string;
  author: string;
  price: number;
}

export class Book extends AggregateRoot<BookData, BookId> {
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

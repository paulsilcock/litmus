import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import { Book } from "../domain/book.ts";

interface BookRepository {
  nextId(): string;
  add(book: Book): Promise<void>;
}

interface PutBookOnSaleCommand extends Record<string, unknown> {
  title: string;
  author: string;
  price: number;
}

@injectable()
export class PutBookOnSale extends CommandHandler<PutBookOnSaleCommand> {
  constructor(
    @inject("BookRepository") private readonly books: BookRepository,
  ) {
    super();
  }

  async handle({ title, author, price }: PutBookOnSaleCommand): Promise<void> {
    const id = this.books.nextId();
    await this.books.add(new Book({ id, title, author, price }));
  }
}

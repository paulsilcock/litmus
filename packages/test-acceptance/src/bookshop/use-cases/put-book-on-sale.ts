import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";

import { Book } from "../domain/book.ts";
import { BookRepository } from "../infra/repositories/book-repository.ts";

interface PutBookOnSaleCommand extends Record<string, unknown> {
  title: string;
  author: string;
  price: number;
}

@injectable()
export class PutBookOnSale extends CommandHandler<PutBookOnSaleCommand> {
  constructor(private readonly books: BookRepository) {
    super();
  }

  async handle({ title, author, price }: PutBookOnSaleCommand): Promise<void> {
    const id = this.books.nextId();
    await this.books.add(new Book({ id, title, author, price }));
  }
}

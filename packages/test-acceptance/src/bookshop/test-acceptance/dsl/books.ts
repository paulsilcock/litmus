import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriverApi } from "../driver.ts";

export class BooksDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriverApi,
    context: DslContext,
  ) {
    super(context);
  }

  async hasOnSale(input: {
    title: string;
    author: string;
    price: number;
  }): Promise<void> {
    await this.driver.putBookOnSale({
      title: this.context.alias(input.title),
      author: this.context.alias(input.author),
      price: input.price,
    });
  }

  async searchBy(input: { author: string }): Promise<void> {
    await this.driver.searchBooksByAuthor(this.context.alias(input.author));
  }
}

import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriverApi } from "../driver.ts";

export class CartDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriverApi,
    context: DslContext,
  ) {
    super(context);
  }

  async addBook(input: { title: string }): Promise<void> {
    await this.driver.addBookToCart(this.context.alias(input.title));
  }

  async checkOut(): Promise<void> {
    await this.driver.checkOut();
  }
}

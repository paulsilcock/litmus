import type { DslContext } from "@litmus/test";

import type { BookshopDriver } from "#bookshop/test-acceptance/driver.ts";

export class CartDsl {
  constructor(
    private readonly driver: BookshopDriver,
    private readonly context: DslContext,
  ) {}

  async addBook(input: { title: string }): Promise<void> {
    await this.driver.addBookToCart(this.context.alias(input.title));
  }

  async checkOut(): Promise<void> {
    await this.driver.checkOut();
  }
}

import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriver } from "../driver.ts";

export class OrdersDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriver,
    context: DslContext,
  ) {
    super(context);
  }

  async confirmPurchased(input: { title: string }): Promise<void> {
    await this.driver.assertBookPurchased(this.context.alias(input.title));
  }
}

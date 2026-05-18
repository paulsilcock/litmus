import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriverApi } from "../driver.ts";

export class OrdersDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriverApi,
    context: DslContext,
  ) {
    super(context);
  }

  async confirmPurchased(input: { title: string }): Promise<void> {
    await this.driver.assertBookPurchased(this.context.alias(input.title));
  }
}

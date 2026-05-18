import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriver } from "../driver.ts";

export class EmailsDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriver,
    context: DslContext,
  ) {
    super(context);
  }

  async confirmOrderConfirmationSent(input: { to: string }): Promise<void> {
    await this.driver.assertConfirmationEmailSent(this.context.alias(input.to));
  }
}

import { Dsl, type DslContext } from "@litmus/test";

import type { BookshopDriver } from "#bookshop/test-acceptance/driver.ts";

export class CustomersDsl extends Dsl {
  constructor(
    private readonly driver: BookshopDriver,
    context: DslContext,
  ) {
    super(context);
  }

  async hasAccount(input: { name: string; email: string }): Promise<void> {
    await this.driver.registerCustomer(
      input.name,
      this.context.alias(input.email),
    );
  }

  async logIn(input: { email: string }): Promise<void> {
    this.driver.loginAs(this.context.alias(input.email));
  }
}

import type { DslContext } from "@litmus/test";

import type { BookshopDriver } from "#bookshop/test-acceptance/driver.ts";

export class CustomersDsl {
  constructor(
    private readonly driver: BookshopDriver,
    private readonly context: DslContext,
  ) {}

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

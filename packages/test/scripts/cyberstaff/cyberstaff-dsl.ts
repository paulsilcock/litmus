import { Dsl } from "#litmus-test/dsl.ts";

import { BusinessDsl } from "./business-dsl.ts";
import { CustomerDsl } from "./customer-dsl.ts";
import { CyberstaffDriver } from "./cyberstaff-driver.ts";

/**
 * Cyberstaff, as its users see it: customers phone the business, and
 * the business owner sets the receptionist up and follows up its calls.
 */
export class CyberstaffDsl extends Dsl<CyberstaffDriver> {
  readonly customer: CustomerDsl;
  readonly business: BusinessDsl;

  constructor(driver: CyberstaffDriver) {
    super(driver);
    this.customer = new CustomerDsl(driver);
    this.business = new BusinessDsl(driver);
  }

  /** Logs the business owner in, ready for a customer to call. */
  static async open(): Promise<CyberstaffDsl> {
    const driver = new CyberstaffDriver();
    await driver.init();
    return new CyberstaffDsl(driver);
  }
}

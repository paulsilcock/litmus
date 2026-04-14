/**
 * Base class for acceptance-test DSLs. A DSL translates business
 * vocabulary into driver calls — `dsl.placeOrder("cust_1")` instead
 * of clicking buttons or sending HTTP requests directly.
 *
 * **Stateless.** A DSL must NOT hold domain state — no "current
 * customer", no "last order ID". State belongs in the driver
 * (protocol state) or the test itself (test fixtures). DSLs that
 * accumulate state become tightly coupled to test ordering and
 * impossible to reason about.
 *
 * **Composable.** Larger applications often split a DSL into
 * smaller domain-specific DSLs:
 *
 * ```typescript
 * class AppDsl extends Dsl {
 *   readonly customers = new CustomerDsl(this.driver);
 *   readonly orders = new OrderDsl(this.driver);
 *
 *   constructor(private driver: WebDriver) { super(); }
 *
 *   async init() { await this.driver.init(); }
 *   async cleanup() { await this.driver.cleanup(); }
 * }
 *
 * class CustomerDsl extends Dsl {
 *   constructor(private driver: WebDriver) { super(); }
 *
 *   async createCustomer(name: string) {
 *     await this.driver.createCustomer(name);
 *   }
 * }
 * ```
 *
 * **Lifecycle ownership.** The DSL that constructs a driver is
 * responsible for cleaning it up. Child DSLs share the parent's
 * driver and do NOT call `cleanup()` on it. The default `init()`
 * and `cleanup()` are no-ops — override them only in the DSL that
 * owns the underlying resources.
 *
 * @example
 * ```typescript
 * const dsl = new AppDsl(driver);
 * await dsl.init();
 *
 * await dsl.customers.createCustomer("Alice");
 * await dsl.orders.placeOrder({ customerId: "cust_1" });
 *
 * await dsl.cleanup();
 * ```
 */
export abstract class Dsl {
  /**
   * Async setup. Override to launch resources (e.g. `await driver.init()`).
   * Default is a no-op for child DSLs that share a parent's resources.
   */
  async init(): Promise<void> {}

  /**
   * Async teardown. Override to release resources (e.g. `await driver.cleanup()`).
   * Default is a no-op for child DSLs.
   */
  async cleanup(): Promise<void> {}
}

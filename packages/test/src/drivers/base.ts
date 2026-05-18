/**
 * Lifecycle interface for driver base classes.
 *
 * `init()` performs async setup (e.g. launching a browser) that
 * cannot run in the constructor. For drivers that don't need async
 * setup (HTTP, CLI, Hono), the default `init()` is a no-op.
 *
 * Drivers that hold resources (browser, persistent socket, file
 * handles) should implement `[Symbol.asyncDispose]` so tests can
 * scope the driver's lifetime with `await using`:
 *
 * ```typescript
 * await using driver = new BrowserDriver(opts);
 * await driver.init();
 * // driver disposed automatically when the block exits, even on throw
 * ```
 *
 * Drivers without resources to release leave `[Symbol.asyncDispose]`
 * unimplemented — there's nothing to clean up.
 */
export abstract class BaseDriver {
  async init(): Promise<void> {}
}

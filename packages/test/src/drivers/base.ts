/**
 * Lifecycle base for driver classes.
 *
 * `init()` performs async setup (e.g. launching a browser) that
 * cannot run in the constructor. For drivers that don't need async
 * setup (HTTP, CLI, Hono), the default `init()` is a no-op.
 *
 * `[Symbol.asyncDispose]()` releases any resources held by the
 * driver. The default is a no-op; subclasses with real resources
 * (browser handles, persistent sockets, file handles) override.
 * Every `Driver` is an `AsyncDisposable`, which lets `Dsl<TDriver>`
 * propagate disposal to its driver without runtime checks.
 *
 * ```typescript
 * await using driver = new BrowserDriver(opts);
 * await driver.init();
 * // driver disposed automatically when the block exits, even on throw
 * ```
 */
export abstract class Driver implements AsyncDisposable {
  async init(): Promise<void> {}

  async [Symbol.asyncDispose](): Promise<void> {}
}

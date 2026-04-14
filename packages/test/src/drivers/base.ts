/**
 * Lifecycle interface for all driver base classes.
 * `init()` performs async setup (e.g. launching a browser).
 * `cleanup()` releases resources after the test completes.
 *
 * For drivers that don't need async setup (HTTP, CLI, Hono),
 * the default `init()` is a no-op.
 */
export abstract class BaseDriver {
  async init(): Promise<void> {}
  abstract cleanup(): Promise<void>;
}

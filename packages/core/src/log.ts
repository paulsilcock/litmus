import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Structured key/value pairs attached to a log line.
 */
export type LogContext = Record<string, unknown>;

/**
 * Abstract base class for structured loggers.
 *
 * `@litmus/log` ships a pino-backed implementation. Anywhere in the
 * framework that needs to log accepts this class so it stays decoupled
 * from the underlying logger library. Consumers who want a different
 * backend extend this class and implement the level methods.
 *
 * Async-scoped context propagation is handled by the static
 * `runWithContext` — fields added inside the callback are merged into
 * every log line emitted from any logger inside the scope (including
 * async descendants). Subclasses use the protected `mergedContext`
 * helper to combine the current scope's context with per-call data
 * before forwarding to the backend.
 *
 * @example
 * ```typescript
 * import { Logger } from "@litmus/core/log";
 *
 * class CreateUser {
 *   constructor(private readonly logger: Logger) {}
 *
 *   async handle(input: { email: string }) {
 *     this.logger.info("creating user", { email: input.email });
 *   }
 * }
 * ```
 */
export abstract class Logger {
  static readonly #contextStorage = new AsyncLocalStorage<LogContext>();

  /**
   * Run a function within a log context. All log lines emitted inside
   * `fn` (and from any async descendants) will include the given context
   * fields, regardless of which logger instance emits them. Nested calls
   * merge with any outer context.
   */
  static runWithContext<T>(context: LogContext, fn: () => T): T {
    const current = Logger.#contextStorage.getStore() ?? {};
    return Logger.#contextStorage.run({ ...current, ...context }, fn);
  }

  /**
   * Returns the merged context for the current async scope, optionally
   * combined with per-call data. Subclasses should call this when
   * forwarding to the backend so context fields land on the log line.
   */
  protected mergedContext(data?: LogContext): LogContext {
    const current = Logger.#contextStorage.getStore() ?? {};
    return data ? { ...current, ...data } : current;
  }

  abstract trace(message: string, data?: LogContext): void;
  abstract debug(message: string, data?: LogContext): void;
  abstract info(message: string, data?: LogContext): void;
  abstract warn(message: string, data?: LogContext): void;
  abstract error(message: string, data?: LogContext): void;
  abstract fatal(message: string, data?: LogContext): void;
}

/**
 * Method decorator that wraps a method in a log context. Every log line
 * emitted inside the method (including from async descendants) includes
 * a `context: "ClassName.methodName"` field.
 *
 * Method arguments are NOT logged by default — passing arbitrary inputs
 * to logs risks leaking sensitive data. Pass an explicit `mapper` to
 * include shaped, redacted fields when you need them.
 *
 * @example
 * ```typescript
 * import { CommandHandler } from "@litmus/core";
 * import { logContext } from "@litmus/core/log";
 *
 * class PlaceOrder extends CommandHandler<PlaceOrderCommand, OrderDto> {
 *   // No args logged
 *   @logContext()
 *   async handle(cmd: PlaceOrderCommand): Promise<OrderDto> {
 *     // ...
 *   }
 * }
 *
 * class ResetPassword extends CommandHandler<ResetPasswordCommand, void> {
 *   // Explicitly log only the email — never the new password
 *   @logContext((cmd: ResetPasswordCommand) => ({ email: cmd.email }))
 *   async handle(cmd: ResetPasswordCommand): Promise<void> {
 *     // ...
 *   }
 * }
 * ```
 */
export function logContext<TArgs extends unknown[]>(
  mapper?: (...args: TArgs) => LogContext,
) {
  return function (
    _target: object,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ): PropertyDescriptor {
    const original: (...args: TArgs) => unknown = descriptor.value;
    const methodName = String(propertyKey);

    descriptor.value = function (this: object, ...args: TArgs) {
      const className = this.constructor.name;
      const context: LogContext = {
        context: `${className}.${methodName}`,
      };
      if (mapper) {
        Object.assign(context, mapper(...args));
      }
      return Logger.runWithContext(context, () => original.apply(this, args));
    };

    return descriptor;
  };
}

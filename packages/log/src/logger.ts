import { type LogContext, Logger as LoggerBase } from "@litmus/core/log";
import pino from "pino";

export type { LogContext } from "@litmus/core/log";

/**
 * Options for constructing a `Logger`.
 *
 * @property level - Minimum level to emit. Anything below is dropped.
 *   Defaults to `"info"`. Set via `LOG_LEVEL` env var or pass explicitly.
 * @property destination - Destination stream. Defaults to stdout. Pass
 *   a custom writable for tests, file output, or transports.
 */
export interface LoggerOptions {
  level?: pino.LevelWithSilent;
  destination?: { write(chunk: string): void };
}

/**
 * Pino-backed implementation of the Litmus `Logger` abstract class.
 *
 * Forwards each log call to pino with the current async-scoped context
 * merged in, so any fields added via `Logger.runWithContext` (or by the
 * `@logContext()` decorator) appear automatically on every log line
 * emitted inside that scope.
 *
 * @example
 * ```typescript
 * import { Logger } from "@litmus/log";
 *
 * const logger = new Logger({ level: "info" });
 * logger.info("server starting", { port: 3000 });
 *
 * Logger.runWithContext({ requestId: "req_1" }, () => {
 *   logger.info("processing"); // includes requestId automatically
 * });
 * ```
 */
export class Logger extends LoggerBase {
  private readonly pino: pino.Logger;

  constructor(options: LoggerOptions = {}) {
    super();
    this.pino = pino(
      { level: options.level ?? "info" },
      options.destination ?? pino.destination(1),
    );
  }

  trace(message: string, data?: LogContext): void {
    this.pino.trace(this.mergedContext(data), message);
  }

  debug(message: string, data?: LogContext): void {
    this.pino.debug(this.mergedContext(data), message);
  }

  info(message: string, data?: LogContext): void {
    this.pino.info(this.mergedContext(data), message);
  }

  warn(message: string, data?: LogContext): void {
    this.pino.warn(this.mergedContext(data), message);
  }

  error(message: string, data?: LogContext): void {
    this.pino.error(this.mergedContext(data), message);
  }

  fatal(message: string, data?: LogContext): void {
    this.pino.fatal(this.mergedContext(data), message);
  }
}

import { context, propagation, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import { W3CTraceContextPropagator } from "@opentelemetry/core";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";

/**
 * Vitest setup module that prints OTel spans to stdout when
 * `OTEL_TRACES_EXPORTER=console` is set in the environment. Otherwise
 * a no-op.
 *
 * Add to `vitest.config.ts`:
 * ```ts
 * import { defineConfig } from "vite-plus";
 *
 * export default defineConfig({
 *   test: { setupFiles: ["@litmus/test/vitest-setup"] },
 * });
 * ```
 *
 * Then run with the env var to see traces:
 * ```sh
 * OTEL_TRACES_EXPORTER=console vp test
 * ```
 */
if (process.env.OTEL_TRACES_EXPORTER === "console") {
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(new ConsoleSpanExporter())],
    }),
  );
  context.setGlobalContextManager(
    new AsyncLocalStorageContextManager().enable(),
  );
  propagation.setGlobalPropagator(new W3CTraceContextPropagator());
}

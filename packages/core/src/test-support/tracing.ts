import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach } from "vite-plus/test";

/**
 * Registers an in-memory OTel tracer + AsyncLocalStorage context manager
 * for the duration of each test in the enclosing `describe`. Returns an
 * accessor for the spans recorded by the active test.
 *
 * @example
 * ```ts
 * describe("...", () => {
 *   const tracing = useInMemoryTracing();
 *
 *   it("...", () => {
 *     // exercise code that emits spans
 *     expect(tracing.spans()).toHaveLength(1);
 *   });
 * });
 * ```
 */
export function useInMemoryTracing(): {
  spans(): ReadableSpan[];
} {
  let exporter: InMemorySpanExporter;
  let provider: BasicTracerProvider;

  beforeEach(() => {
    exporter = new InMemorySpanExporter();
    provider = new BasicTracerProvider({
      spanProcessors: [new SimpleSpanProcessor(exporter)],
    });
    trace.setGlobalTracerProvider(provider);
    context.setGlobalContextManager(
      new AsyncLocalStorageContextManager().enable(),
    );
  });

  afterEach(async () => {
    trace.disable();
    context.disable();
    await provider.shutdown();
  });

  return {
    spans: () => exporter.getFinishedSpans(),
  };
}

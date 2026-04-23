import { context, trace } from "@opentelemetry/api";
import { AsyncLocalStorageContextManager } from "@opentelemetry/context-async-hooks";
import {
  BasicTracerProvider,
  ConsoleSpanExporter,
  InMemorySpanExporter,
  type ReadableSpan,
  SimpleSpanProcessor,
  type SpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { afterEach, beforeEach } from "vite-plus/test";

/**
 * Records spans emitted during each test in the enclosing `describe`
 * so they can be asserted against.
 *
 * When `OTEL_TRACES_EXPORTER=console` is set, spans are also printed
 * to stdout — handy when debugging a flaky test or learning what the
 * framework emits. The behaviour is controlled entirely by the env
 * var, so test code stays free of debug toggles.
 *
 * @example
 * ```ts
 * describe("PlaceOrder", () => {
 *   const tracing = useInMemoryTracing();
 *
 *   it("emits one span per invocation", async () => {
 *     await new PlaceOrder().handle({ customerId: "c1" });
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
    trace.disable();
    context.disable();
    exporter = new InMemorySpanExporter();
    const processors: SpanProcessor[] = [new SimpleSpanProcessor(exporter)];
    if (process.env.OTEL_TRACES_EXPORTER === "console") {
      processors.push(new SimpleSpanProcessor(new ConsoleSpanExporter()));
    }
    provider = new BasicTracerProvider({ spanProcessors: processors });
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

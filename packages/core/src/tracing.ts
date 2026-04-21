import { SpanStatusCode, trace } from "@opentelemetry/api";

const TRACER_NAME = "@litmus/core";

/**
 * Base class that wraps a named method on the subclass instance so each
 * invocation is enclosed in an OpenTelemetry span named after the
 * concrete class. Subclasses pass the method name via `super(...)`.
 */
export abstract class Traceable {
  constructor(methodName: string) {
    traceMethod(this, methodName);
  }
}

/**
 * Wrap the named async method on `instance` so each invocation is
 * enclosed in an OpenTelemetry span named after the instance's class.
 * The span records exceptions and marks an ERROR status if the method
 * throws. With no registered tracer provider, OTel's no-op tracer
 * makes this a transparent passthrough.
 */
function traceMethod(instance: object, methodName: string): void {
  const fn: unknown = Reflect.get(instance, methodName);
  if (typeof fn !== "function") {
    throw new Error(`traceMethod: ${methodName} is not a function`);
  }
  const original = fn.bind(instance);
  const spanName = instance.constructor.name;
  Object.defineProperty(instance, methodName, {
    value: (input: unknown) => {
      const tracer = trace.getTracer(TRACER_NAME);
      return tracer.startActiveSpan(spanName, async (span) => {
        try {
          return await original(input);
        } catch (err) {
          span.recordException(err instanceof Error ? err : String(err));
          span.setStatus({
            code: SpanStatusCode.ERROR,
            message: err instanceof Error ? err.message : String(err),
          });
          throw err;
        } finally {
          span.end();
        }
      });
    },
  });
}

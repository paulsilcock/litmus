import { zValidator } from "@hono/zod-validator";
import { type HandlerClass, isAsyncIterable } from "@litmus/core";
import type { Context, Env } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { container } from "tsyringe";
import type { ZodSchema } from "zod";

type ValidationTarget = "json" | "param" | "query";

interface RouteHandlerOptions<TResult = unknown> {
  target?: ValidationTarget;
  status?: ContentfulStatusCode;
  respond?: (
    result: TResult | AsyncIterable<TResult>,
    c: Context,
  ) => Response | Promise<Response>;
}

function validationHook(
  result: {
    success: boolean;
    error?: { errors: { path: (string | number)[]; message: string }[] };
  },
  c: Context,
) {
  if (!result.success && result.error) {
    return c.json(
      {
        errors: result.error.errors.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      422,
    );
  }
}

/**
 * Adapts a use case handler to a Hono route. Returns a
 * `[validator, handler]` tuple that spreads into Hono's
 * route methods, preserving RPC type inference.
 *
 * The handler class is resolved via tsyringe's container,
 * so constructor dependencies are injected automatically.
 *
 * Behaviour defaults:
 * - Invalid input returns 422 with structured validation errors
 * - `void` results return 204 with no body
 * - `AsyncIterable` results are streamed as SSE
 * - POST defaults to 201, all other verbs default to 200
 *
 * @example
 * ```typescript
 * import { routeHandler } from "@litmus/http";
 *
 * const app = new Hono()
 *   .post("/orders", ...routeHandler(PlaceOrder, PlaceOrderSchema))
 *   .get("/orders/:id", ...routeHandler(GetOrder, GetOrderSchema, { target: "param" }));
 * ```
 */
export function routeHandler<TInput extends Record<string, unknown>, TResult>(
  Handler: HandlerClass<TInput, TResult>,
  schema: ZodSchema<TInput>,
  options: RouteHandlerOptions<TResult> = {},
) {
  const target = options.target ?? "json";
  const validator = zValidator(target, schema, validationHook);
  const handler = async (
    c: Context<Env, string, { out: Record<string, TInput> }>,
  ) => {
    const input = c.req.valid(target);
    const h = container.resolve(Handler);
    const result = await h.handle(input);
    if (options.respond) {
      return options.respond(result, c);
    }
    if (result === undefined) {
      return c.body(null, 204);
    }
    if (isAsyncIterable<TResult>(result)) {
      return streamSSE(c, async (stream) => {
        for await (const chunk of result) {
          await stream.writeSSE({ data: JSON.stringify(chunk) });
        }
      });
    }
    const status = options.status ?? (c.req.method === "POST" ? 201 : 200);
    return c.json(result, status);
  };
  return [validator, handler] as const;
}

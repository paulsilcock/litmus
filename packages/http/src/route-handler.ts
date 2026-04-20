import { zValidator } from "@hono/zod-validator";
import { type HandlerClass, isAsyncIterable } from "@litmus/core";
import type { Context, Env } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { container } from "tsyringe";
import type { ZodSchema } from "zod";

type ValidationTarget = "json" | "param" | "query";

interface RouteHandlerOptionsBase<TResult = unknown> {
  target?: ValidationTarget;
  status?: ContentfulStatusCode;
  respond?: (
    result: TResult | AsyncIterable<TResult>,
    c: Context,
  ) => Response | Promise<Response>;
}

interface RouteHandlerOptionsWithInput<
  TEnv extends Env,
  TSchema,
  TInput,
  TResult = unknown,
> extends RouteHandlerOptionsBase<TResult> {
  input: (validated: TSchema, c: Context<TEnv>) => TInput;
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
 * Factory that binds a Hono `Env` type to `routeHandler` so the
 * `input` hook's context is strictly typed. Use this when your app
 * has middleware that adds typed variables (e.g. a principal from
 * auth middleware) and you want `c.get(...)` to be type-checked.
 *
 * The bare `routeHandler` export is equivalent to
 * `createRouteHandler()` with a permissive (`any`) env.
 *
 * Behaviour defaults (same as `routeHandler`):
 * - Invalid input returns 422 with structured validation errors
 * - `void` results return 204 with no body
 * - `AsyncIterable` results are streamed as SSE
 * - POST defaults to 201, all other verbs default to 200
 *
 * @example
 * ```typescript
 * import { createRouteHandler } from "@litmus/http";
 *
 * const routeHandler = createRouteHandler<{
 *   Variables: { userId: string };
 * }>();
 *
 * const app = new Hono<{ Variables: { userId: string } }>()
 *   .use(authMiddleware)
 *   .post(
 *     "/orders",
 *     ...routeHandler(PlaceOrder, PlaceOrderWireSchema, {
 *       input: (validated, c) => ({ ...validated, userId: c.get("userId") }),
 *     }),
 *   );
 * ```
 */
// biome-ignore lint/suspicious/noExplicitAny: matches Hono's Context<E = any> default
export function createRouteHandler<TEnv extends Env = any>() {
  function typedRouteHandler<TInput extends Record<string, unknown>, TResult>(
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodSchema<TInput>,
    options?: RouteHandlerOptionsBase<TResult>,
  ): readonly [
    ReturnType<typeof zValidator>,
    (c: Context<TEnv>) => Response | Promise<Response>,
  ];
  function typedRouteHandler<
    TInput extends Record<string, unknown>,
    TResult,
    TSchema extends Record<string, unknown>,
  >(
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodSchema<TSchema>,
    options: RouteHandlerOptionsWithInput<TEnv, TSchema, TInput, TResult>,
  ): readonly [
    ReturnType<typeof zValidator>,
    (c: Context<TEnv>) => Response | Promise<Response>,
  ];
  function typedRouteHandler(
    Handler: HandlerClass<Record<string, unknown>, unknown>,
    schema: ZodSchema<Record<string, unknown>>,
    options: RouteHandlerOptionsBase<unknown> & {
      input?: (
        validated: Record<string, unknown>,
        c: Context<TEnv>,
      ) => Record<string, unknown>;
    } = {},
  ) {
    const target = options.target ?? "json";
    const validator = zValidator(target, schema, validationHook);
    const handler = async (
      c: Context<
        TEnv,
        string,
        { out: Record<string, Record<string, unknown>> }
      >,
    ) => {
      const validated = c.req.valid(target);
      const input = options.input ? options.input(validated, c) : validated;
      const h = container.resolve(Handler);
      const result = await h.handle(input);
      if (options.respond) {
        return options.respond(result, c);
      }
      if (result === undefined) {
        return c.body(null, 204);
      }
      if (isAsyncIterable<unknown>(result)) {
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
  return typedRouteHandler;
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
 * @param Handler - Use case class (CommandHandler or QueryHandler). Resolved via tsyringe.
 * @param schema - Zod schema for input validation. Invalid input returns 422.
 * @param options.target - Where to read input from: `"json"` (default), `"param"`, or `"query"`.
 * @param options.status - Override the default HTTP status code.
 * @param options.respond - Custom response callback, bypasses all default response handling.
 * @param options.input - Project the validated request and Hono context into the
 *   handler's input. Use this to inject server-derived values (e.g. principal from
 *   auth middleware) into the handler without including them in the wire schema.
 *   For a type-safe `c.get(...)` see {@link createRouteHandler}.
 *
 * @example
 * ```typescript
 * import { routeHandler } from "@litmus/http";
 *
 * const app = new Hono()
 *   .post("/orders", ...routeHandler(PlaceOrder, PlaceOrderSchema))
 *   .get("/orders/:id", ...routeHandler(GetOrder, GetOrderSchema, { target: "param" }));
 * ```
 *
 * @example Injecting middleware-attached context into the handler input
 * ```typescript
 * // Middleware attaches a principal; routeHandler projects it into the command.
 * const app = new Hono<{ Variables: { userId: string } }>()
 *   .use(authMiddleware)
 *   .post(
 *     "/orders",
 *     ...routeHandler(PlaceOrder, PlaceOrderWireSchema, {
 *       input: (validated, c) => ({ ...validated, userId: c.get("userId") }),
 *     }),
 *   );
 * ```
 */
export const routeHandler = createRouteHandler();

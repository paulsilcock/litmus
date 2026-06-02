import { zValidator } from "@hono/zod-validator";
import type { HandlerClass } from "@litmus/core";
import type { Context, Env } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { container } from "tsyringe";
import type { ZodType } from "zod";

type ValidationTarget = "json" | "param" | "query";

interface CommonOptions {
  target?: ValidationTarget;
}

interface JsonOptions extends CommonOptions {
  status?: ContentfulStatusCode;
}

interface WithInput<TEnv extends Env, TSchema, TInput> {
  input: (validated: TSchema, c: Context<TEnv>) => TInput;
}

type HandlerContext<TEnv extends Env> = Context<
  TEnv,
  string,
  { out: Record<string, Record<string, unknown>> }
>;

function validationHook(
  result: {
    success: boolean;
    error?: {
      issues: { path: (string | number | symbol)[]; message: string }[];
    };
  },
  c: Context,
) {
  if (!result.success && result.error) {
    return c.json(
      {
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      },
      422,
    );
  }
}

// oxlint-disable no-unsafe-type-assertion -- when no input projection is provided,
// TSchema defaults to TInput so the validated value is structurally TInput.
function resolveInput<TEnv extends Env, TSchema, TInput>(
  validated: TSchema,
  c: HandlerContext<TEnv>,
  options: Partial<WithInput<TEnv, TSchema, TInput>>,
): TInput {
  if (options.input) {
    return options.input(validated, c);
  }
  return validated as unknown as TInput;
}
// oxlint-enable no-unsafe-type-assertion

/**
 * Factory that binds a Hono `Env` type to the `routeHandler` namespace
 * so the `input` projection's context is strictly typed. Use this when
 * your app has middleware that adds typed variables (e.g. a principal
 * from auth middleware) and you want `c.get(...)` to be type-checked.
 *
 * The bare `routeHandler` export is equivalent to `createRouteHandler()`
 * with a permissive (`any`) env.
 *
 * Returns an object exposing one method per response shape:
 *
 * - `json` — typed JSON body (`c.json`)
 * - `noContent` — 204 no body (`c.body(null, 204)`)
 * - `stream` — SSE stream (`streamSSE`)
 * - `custom` — user-built `Response` for cases that don't fit the others
 *
 * Each variant has a single response path so `hc<App>` infers a precise
 * response type on the client side.
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
 *     ...routeHandler.json(PlaceOrder, PlaceOrderWireSchema, {
 *       input: (validated, c) => ({ ...validated, userId: c.get("userId") }),
 *     }),
 *   );
 * ```
 */
export function createRouteHandler<TEnv extends Env = any>() {
  /**
   * Adapts a value-returning use case to a JSON-responding route.
   * Invalid input → 422. POST defaults to 201, other verbs to 200.
   * Override the default status via `options.status`.
   */
  function json<
    TInput extends Record<string, unknown>,
    TResult,
    TSchema extends Record<string, unknown> = TInput,
  >(
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodType<TSchema>,
    options: JsonOptions & Partial<WithInput<TEnv, TSchema, TInput>> = {},
  ) {
    const target = options.target ?? "json";
    const validator = zValidator(target, schema, validationHook);
    const handler = async (c: HandlerContext<TEnv>) => {
      const validated = c.req.valid(target);
      const input = resolveInput<TEnv, TSchema, TInput>(validated, c, options);
      const h = container.resolve(Handler);
      const result = await h.handle(input);
      const status = options.status ?? (c.req.method === "POST" ? 201 : 200);
      return c.json(result, status);
    };
    return [validator, handler] as const;
  }

  /**
   * Adapts a void-returning use case to a 204 No Content route. Always
   * responds with 204, no body. Invalid input → 422.
   *
   * Use this for command handlers that don't produce a result. For
   * value-returning use cases, use {@link createRouteHandler.json}.
   */
  function noContent<
    TInput extends Record<string, unknown>,
    TSchema extends Record<string, unknown> = TInput,
  >(
    Handler: HandlerClass<TInput, void>,
    schema: ZodType<TSchema>,
    options: CommonOptions & Partial<WithInput<TEnv, TSchema, TInput>> = {},
  ) {
    const target = options.target ?? "json";
    const validator = zValidator(target, schema, validationHook);
    const handler = async (c: HandlerContext<TEnv>) => {
      const validated = c.req.valid(target);
      const input = resolveInput<TEnv, TSchema, TInput>(validated, c, options);
      const h = container.resolve(Handler);
      await h.handle(input);
      return c.body(null, 204);
    };
    return [validator, handler] as const;
  }

  /**
   * Adapts a use case returning `AsyncIterable<TChunk>` to an SSE
   * streaming route. Each yielded chunk is written as a server-sent
   * event. Invalid input → 422.
   *
   * Hono's streaming responses are loosely typed at the body level;
   * the client consumes the stream via `ReadableStream`.
   */
  function stream<
    TInput extends Record<string, unknown>,
    TChunk,
    TSchema extends Record<string, unknown> = TInput,
  >(
    Handler: HandlerClass<TInput, TChunk>,
    schema: ZodType<TSchema>,
    options: CommonOptions & Partial<WithInput<TEnv, TSchema, TInput>> = {},
  ) {
    const target = options.target ?? "json";
    const validator = zValidator(target, schema, validationHook);
    const handler = async (c: HandlerContext<TEnv>) => {
      const validated = c.req.valid(target);
      const input = resolveInput<TEnv, TSchema, TInput>(validated, c, options);
      const h = container.resolve(Handler);
      const result = await h.handle(input);
      // oxlint-disable no-unsafe-type-assertion -- .stream requires the use case's
      // handle to return AsyncIterable<TChunk>; the HandlerClass type can't
      // statically express this constraint, so we narrow at the iteration site.
      return streamSSE(c, async (s) => {
        for await (const chunk of result as AsyncIterable<TChunk>) {
          await s.writeSSE({ data: JSON.stringify(chunk) });
        }
      });
      // oxlint-enable no-unsafe-type-assertion
    };
    return [validator, handler] as const;
  }

  /**
   * Adapts a use case to a route where you construct the `Response`
   * yourself via `respond`. Use this when none of the typed variants
   * fit — e.g. redirects, file downloads, HTML, or status that depends
   * on the result. Invalid input → 422.
   *
   * The `respond` callback receives the use case's result and the Hono
   * `Context`. Build any `Response` you like.
   */
  function custom<
    TInput extends Record<string, unknown>,
    TResult,
    TResponse extends Response,
    TSchema extends Record<string, unknown> = TInput,
  >(
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodType<TSchema>,
    respond: (
      result: TResult | AsyncIterable<TResult>,
      c: Context<TEnv>,
    ) => TResponse | Promise<TResponse>,
    options: CommonOptions & Partial<WithInput<TEnv, TSchema, TInput>> = {},
  ) {
    const target = options.target ?? "json";
    const validator = zValidator(target, schema, validationHook);
    const handler = async (c: HandlerContext<TEnv>) => {
      const validated = c.req.valid(target);
      const input = resolveInput<TEnv, TSchema, TInput>(validated, c, options);
      const h = container.resolve(Handler);
      const result = await h.handle(input);
      return respond(result, c);
    };
    return [validator, handler] as const;
  }

  return { json, noContent, stream, custom };
}

/**
 * Adapts a use case handler to a Hono route. Returns a
 * `[validator, handler]` tuple that spreads into Hono's route methods,
 * preserving RPC type inference so `hc<App>` clients see typed responses.
 *
 * Pick the variant that matches the use case's return shape:
 *
 * - `routeHandler.json(...)` — typed JSON. Use for value-returning use cases.
 * - `routeHandler.noContent(...)` — 204 no body. Use for void use cases.
 * - `routeHandler.stream(...)` — SSE. Use for `AsyncIterable<T>` returns.
 * - `routeHandler.custom(...)` — user-controlled `Response`. Escape hatch.
 *
 * The handler class is resolved via tsyringe, so constructor
 * dependencies are injected automatically. Invalid input returns 422
 * with structured validation errors regardless of variant.
 *
 * @example
 * ```typescript
 * import { routeHandler } from "@litmus/http";
 *
 * const app = new Hono()
 *   .post("/orders",   ...routeHandler.json(PlaceOrder, PlaceOrderSchema))
 *   .post("/ships",    ...routeHandler.noContent(ShipOrder, ShipOrderSchema))
 *   .get("/orders/:id", ...routeHandler.json(GetOrder, GetOrderSchema, { target: "param" }));
 * ```
 */
export const routeHandler = createRouteHandler();

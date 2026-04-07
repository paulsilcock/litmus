import { zValidator } from "@hono/zod-validator";
import { DomainError, isAsyncIterable } from "@litmus/core";
import type { Context, Env } from "hono";
import { streamSSE } from "hono/streaming";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { ZodSchema } from "zod";

type DomainErrorMap = Record<string, ContentfulStatusCode>;

export function domainErrorHandler(map: DomainErrorMap) {
  return (err: Error, c: Context) => {
    if (err instanceof DomainError) {
      const status = map[err.constructor.name] ?? 400;
      return c.json({ code: err.code, message: err.message }, status);
    }
    return c.body(null, 500);
  };
}

type HandlerClass<TInput, TResult> = new () => {
  handle(input: TInput): Promise<TResult> | AsyncIterable<TResult>;
};

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
    const h = new Handler();
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

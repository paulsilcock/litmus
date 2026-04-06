import { zValidator } from "@hono/zod-validator";
import type { Context, Env } from "hono";
import type { ZodSchema } from "zod";

type HandlerClass<TInput, TResult> = new () => {
  handle(input: TInput): Promise<TResult> | AsyncIterable<TResult>;
};

type ValidationTarget = "json" | "param" | "query";

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

function createUseCase<TInput extends Record<string, unknown>, TResult>(
  Handler: HandlerClass<TInput, TResult>,
  schema: ZodSchema<TInput>,
  target: ValidationTarget,
) {
  const validator = zValidator(target, schema, validationHook);
  const handler = async (
    c: Context<Env, string, { out: Record<string, TInput> }>,
  ) => {
    const input = c.req.valid(target);
    const h = new Handler();
    const result = await h.handle(input);
    return c.json(result);
  };
  return [validator, handler] as const;
}

export function useCase<TInput extends Record<string, unknown>, TResult>(
  Handler: HandlerClass<TInput, TResult>,
  schema: ZodSchema<TInput>,
  target: ValidationTarget = "json",
) {
  return createUseCase(Handler, schema, target);
}

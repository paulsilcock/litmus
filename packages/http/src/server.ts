import { Hono } from "hono";
import { ZodError, type ZodSchema } from "zod";

type HandlerClass<TInput, TResult> = new () => {
  handle(input: TInput): Promise<TResult> | AsyncIterable<TResult>;
};

function createServer<THono extends Hono>(hono: THono) {
  return {
    hono,

    post<TInput extends Record<string, unknown>, TResult>(
      path: string,
      Handler: HandlerClass<TInput, TResult>,
      schema: ZodSchema<TInput>,
    ) {
      const newHono = hono.post(path, async (c) => {
        const body = await c.req.json();
        const input = schema.parse(body);
        const handler = new Handler();
        const result = await handler.handle(input);
        return c.json(result);
      });
      return createServer(newHono);
    },

    request(...args: Parameters<Hono["request"]>): ReturnType<Hono["request"]> {
      return hono.request(...args);
    },
  };
}

export function httpServer() {
  return createServer(
    new Hono().onError((e, c) => {
      if (e instanceof ZodError) {
        return c.json(
          {
            errors: e.errors.map((issue) => ({
              field: issue.path.join("."),
              message: issue.message,
            })),
          },
          422,
        );
      }
      throw e;
    }),
  );
}

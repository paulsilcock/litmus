import { Hono } from "hono";
import type { ZodSchema } from "zod";

type HandlerClass<TInput, TResult> = new () => {
  handle(input: TInput): Promise<TResult> | AsyncIterable<TResult>;
};

export class HttpServer<TApp extends Hono = Hono> {
  // oxlint-disable-next-line no-unsafe-type-assertion
  constructor(readonly hono: TApp = new Hono() as TApp) {}

  post<TInput extends Record<string, unknown>, TResult>(
    path: string,
    Handler: HandlerClass<TInput, TResult>,
    schema: ZodSchema<TInput>,
  ) {
    const newHono = this.hono.post(path, async (c) => {
      const body = await c.req.json();
      const input = schema.parse(body);
      const handler = new Handler();
      const result = await handler.handle(input);
      return c.json(result);
    });
    return new HttpServer(newHono);
  }

  request(...args: Parameters<Hono["request"]>): ReturnType<Hono["request"]> {
    return this.hono.request(...args);
  }
}

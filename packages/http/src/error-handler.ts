import { DomainError } from "@litmus/core";
import type { Context } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

type DomainErrorMap = Record<string, ContentfulStatusCode>;

export function domainErrorHandler(map: DomainErrorMap) {
  return (err: Error, c: Context) => {
    if (err instanceof DomainError) {
      const status = map[err.constructor.name] ?? 400;
      c.error = undefined;
      return c.json({ code: err.code, message: err.message }, status);
    }
    return c.body(null, 500);
  };
}

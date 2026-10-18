import { routeHandler } from "@litmus-ts/http";
import { Hono } from "hono";

import { CheckOut, CheckOutSchema } from "#bookshop/use-cases/check-out.ts";

export const checkoutRoutes = new Hono().post(
  "/",
  ...routeHandler.noContent(CheckOut, CheckOutSchema),
);

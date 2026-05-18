import { routeHandler } from "@litmus/http";
import { Hono } from "hono";

import { CheckOut, CheckOutSchema } from "#bookshop/use-cases/check-out.ts";

export const checkoutRoutes = new Hono().post(
  "/",
  ...routeHandler(CheckOut, CheckOutSchema),
);

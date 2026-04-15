import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
import { z } from "zod";

import { CheckOut } from "../../../use-cases/check-out.ts";

const CheckOutSchema = z.object({
  customer: z.string(),
});

export const checkoutRoutes = new Hono().post(
  "/",
  ...routeHandler(CheckOut, CheckOutSchema),
);

import { routeHandler } from "@litmus/http";
import { Hono } from "hono";

import {
  GetCustomerOrders,
  GetCustomerOrdersSchema,
} from "#bookshop/use-cases/get-customer-orders.ts";
import {
  RegisterCustomer,
  RegisterCustomerSchema,
} from "#bookshop/use-cases/register-customer.ts";

export const customersRoutes = new Hono()
  .post(
    "/",
    ...routeHandler.noContent(RegisterCustomer, RegisterCustomerSchema),
  )
  .get(
    "/:customerEmail/orders",
    ...routeHandler.json(GetCustomerOrders, GetCustomerOrdersSchema, {
      target: "param",
    }),
  );

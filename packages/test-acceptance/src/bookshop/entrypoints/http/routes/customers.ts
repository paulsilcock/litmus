import { routeHandler } from "@litmus/http";
import { Hono } from "hono";

import {
  GetCustomerOrders,
  GetCustomerOrdersSchema,
} from "../../../use-cases/get-customer-orders.ts";
import {
  RegisterCustomer,
  RegisterCustomerSchema,
} from "../../../use-cases/register-customer.ts";

export const customersRoutes = new Hono()
  .post("/", ...routeHandler(RegisterCustomer, RegisterCustomerSchema))
  .get(
    "/:customerEmail/orders",
    ...routeHandler(GetCustomerOrders, GetCustomerOrdersSchema, {
      target: "param",
    }),
  );

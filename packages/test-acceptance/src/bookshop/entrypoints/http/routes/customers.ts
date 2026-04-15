import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
import { z } from "zod";

import { GetCustomerOrders } from "../../../use-cases/get-customer-orders.ts";
import { RegisterCustomer } from "../../../use-cases/register-customer.ts";

const RegisterCustomerSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

const GetCustomerOrdersSchema = z.object({
  customer: z.string(),
});

export const customersRoutes = new Hono()
  .post("/", ...routeHandler(RegisterCustomer, RegisterCustomerSchema))
  .get(
    "/:customer/orders",
    ...routeHandler(GetCustomerOrders, GetCustomerOrdersSchema, {
      target: "param",
    }),
  );

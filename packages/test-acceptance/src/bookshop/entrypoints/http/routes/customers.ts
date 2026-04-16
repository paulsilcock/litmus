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
  customerEmail: z.string().email(),
});

export const customersRoutes = new Hono()
  .post("/", ...routeHandler(RegisterCustomer, RegisterCustomerSchema))
  .get(
    "/:customerEmail/orders",
    ...routeHandler(GetCustomerOrders, GetCustomerOrdersSchema, {
      target: "param",
    }),
  );

import { CommandHandler } from "@litmus/core";
import { describe, expect, test } from "vite-plus/test";
import { z } from "zod";

import { HttpServer } from "#litmus-http/server.ts";

const PlaceOrderSchema = z.object({
  customerId: z.string(),
  items: z.array(z.object({ productId: z.string(), quantity: z.number() })),
});

type PlaceOrderCommand = z.infer<typeof PlaceOrderSchema>;

class PlaceOrder extends CommandHandler<
  PlaceOrderCommand,
  { orderId: string }
> {
  async handle(cmd: PlaceOrderCommand) {
    return { orderId: `order_${cmd.customerId}` };
  }
}

describe("HttpServer", () => {
  test("valid input is validated and passed to the handler", async () => {
    const server = new HttpServer().post(
      "/orders",
      PlaceOrder,
      PlaceOrderSchema,
    );

    const res = await server.request("/orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        customerId: "cust_1",
        items: [{ productId: "prod_1", quantity: 2 }],
      }),
    });

    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({ orderId: "order_cust_1" });
  });
});

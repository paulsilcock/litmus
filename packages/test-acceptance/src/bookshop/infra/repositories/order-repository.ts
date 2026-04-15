import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { singleton } from "tsyringe";

import { Order } from "../../domain/order.ts";
import { orders } from "../db/schema.ts";

@singleton()
export class OrderRepository extends DrizzlePostgresRepository<
  Order,
  typeof orders
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, orders);
  }

  nextId() {
    return prefixedUlid("order");
  }

  protected toPersistence(order: Order) {
    return {
      data: {
        customerId: order.customerId,
        status: order.status,
        lines: [...order.lines],
      },
    };
  }
}

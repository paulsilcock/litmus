import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { singleton } from "tsyringe";

import { Order } from "#bookshop/domain/order.ts";
import { orders } from "#bookshop/infra/db/schema.ts";

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
      customerId: order.customerId,
      status: order.status,
      lines: [...order.lines],
    };
  }
}

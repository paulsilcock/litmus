import { prefixedUlid } from "@litmus/core/id";
import {
  type DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { sql } from "drizzle-orm";

import { Cart } from "../domain/cart.ts";
import { carts } from "./schema.ts";

export class CartRepository extends DrizzlePostgresRepository<
  Cart,
  typeof carts
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, carts);
  }

  nextId() {
    return prefixedUlid("cart");
  }

  protected toPersistence(cart: Cart) {
    return {
      data: {
        customerId: cart.customerId,
        status: cart.status,
        lines: [...cart.items],
      },
    };
  }

  async findOpenForCustomer(customerId: string): Promise<Cart | null> {
    const rows = await this.db
      .select()
      .from(carts)
      .where(
        sql`${carts.data}->>'customerId' = ${customerId} AND ${carts.data}->>'status' = 'open'`,
      )
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Cart({
      id: row.id,
      customerId: row.data.customerId,
      status: row.data.status,
      lines: row.data.lines,
      version: row.version,
    });
  }
}

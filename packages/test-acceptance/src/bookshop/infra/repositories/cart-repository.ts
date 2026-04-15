import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { and, eq } from "drizzle-orm";
import { singleton } from "tsyringe";

import { Cart, NoOpenCart } from "../../domain/cart.ts";
import type { CustomerId } from "../../domain/customer.ts";
import { carts } from "../db/schema.ts";

@singleton()
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
      customerId: cart.customerId,
      status: cart.status,
      lines: [...cart.items],
    };
  }

  async findOpenForCustomer(customerId: CustomerId): Promise<Cart | null> {
    const rows = await this.db
      .select()
      .from(carts)
      .where(and(eq(carts.customerId, customerId), eq(carts.status, "open")))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return new Cart({
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      lines: row.lines,
      version: row.version,
    });
  }

  async findOpenForCheckout(customerId: CustomerId): Promise<Cart> {
    const cart = await this.findOpenForCustomer(customerId);
    if (!cart) throw new NoOpenCart(customerId);
    return cart;
  }
}

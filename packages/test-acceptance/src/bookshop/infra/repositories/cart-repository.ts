import { prefixedUlid } from "@litmus/core/id";
import {
  DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";
import { and, eq } from "drizzle-orm";
import { singleton } from "tsyringe";

import type { CartId, CartLine, CartStatus } from "#bookshop/domain/cart.ts";
import { Cart } from "#bookshop/domain/cart.ts";
import type { CustomerId } from "#bookshop/domain/customer.ts";
import { carts } from "#bookshop/infra/db/schema.ts";

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
    return this.hydrate(row);
  }

  async findById(id: CartId): Promise<Cart | null> {
    const rows = await this.db
      .select()
      .from(carts)
      .where(eq(carts.id, id))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    return this.hydrate(row);
  }

  private hydrate(row: {
    id: CartId;
    customerId: CustomerId;
    status: CartStatus;
    lines: CartLine[];
    version: number;
  }): Cart {
    return new Cart({
      id: row.id,
      customerId: row.customerId,
      status: row.status,
      lines: row.lines,
      version: row.version,
    });
  }
}

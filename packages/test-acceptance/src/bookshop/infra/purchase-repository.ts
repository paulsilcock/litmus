import { prefixedUlid } from "@litmus/core/id";
import {
  type DrizzleDbContext,
  DrizzlePostgresRepository,
} from "@litmus/db/drizzle/postgres";

import { Purchase } from "../domain/purchase.ts";
import { purchases } from "./schema.ts";

export class PurchaseRepository extends DrizzlePostgresRepository<
  Purchase,
  typeof purchases
> {
  constructor(ctx: DrizzleDbContext) {
    super(ctx, purchases);
  }

  nextId() {
    return prefixedUlid("purchase");
  }

  protected toPersistence(purchase: Purchase) {
    return {
      data: {
        customerId: purchase.customerId,
        bookId: purchase.bookId,
      },
    };
  }
}

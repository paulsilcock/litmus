import { DrizzlePostgresRepository } from "#litmus/db/drizzle-postgres/drizzle-postgres-repository.ts";
import { AggregateRoot } from "#litmus/domain/aggregate-root.ts";
import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { eq } from "drizzle-orm";
import { PgDatabase, integer, jsonb, pgTable, timestamp, varchar } from "drizzle-orm/pg-core";
import { type PgliteDatabase, drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";

// --- Test schema ---

const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{ status: string }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

const schema = { orders };
type Db = PgliteDatabase<typeof schema>;

// --- Test aggregate ---

class Order extends AggregateRoot {
  constructor(
    id: string,
    public status: string,
  ) {
    super(id);
  }
}

// --- Test repository ---

class OrderRepository extends DrizzlePostgresRepository<Order> {
  constructor(db: Db) {
    super(db, orders);
  }

  protected toPersistence(order: Order) {
    return { data: { status: order.status } };
  }

  async findById(id: string): Promise<Order | null> {
    const rows = await this.db.select().from(orders).where(eq(orders.id, id)).limit(1);
    if (!rows[0]) return null;
    const order = new Order(rows[0].id, rows[0].data.status);
    order._setVersion(rows[0].version);
    return order;
  }
}

// --- Tests ---

describe("DrizzlePostgresRepository", () => {
  let db: Db;
  let repo: OrderRepository;

  beforeEach(async () => {
    const client = new PGlite();

    db = drizzle(client, { schema });
    const { apply } = await pushSchema(schema, db as PgDatabase<any, any>);
    await apply();

    repo = new OrderRepository(db);
  });

  it("can persist new aggregates", async () => {
    const order = new Order("order-1", "placed");

    await repo.add(order);

    const rows = await db.select().from(orders).where(eq(orders.id, "order-1"));
    expect(rows).toHaveLength(1);
    expect(rows[0]!.data.status).toBe("placed");
    expect(rows[0]!.version).toBe(0);
    expect(rows[0]!.createdAt).toBeTruthy();
    expect(rows[0]!.updatedAt).toBeTruthy();
  });

  it("can update existing aggregates", async () => {
    const order = new Order("order-1", "placed");
    await repo.add(order);

    const found = await repo.findById("order-1");
    found!.status = "shipped";
    await repo.update(found!);

    const rows = await db.select().from(orders).where(eq(orders.id, "order-1"));
    expect(rows[0]!.data.status).toBe("shipped");
  });

  it("rejects stale updates", async () => {
    const order = new Order("order-1", "placed");
    await repo.add(order);

    // Simulate two concurrent reads
    const reader1 = await repo.findById("order-1");
    const reader2 = await repo.findById("order-1");

    // First update succeeds
    reader1!.status = "shipped";
    await repo.update(reader1!);

    // Second update should fail — it has a stale version
    reader2!.status = "cancelled";
    await expect(repo.update(reader2!)).rejects.toThrow("ConcurrencyError");
  });
});

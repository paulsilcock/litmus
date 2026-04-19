import { PGlite } from "@electric-sql/pglite";
import { pushSchema } from "drizzle-kit/api";
import { getTableName, is, sql } from "drizzle-orm";
import { PgTable } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import "reflect-metadata";
import { container } from "tsyringe";
import { beforeAll, beforeEach } from "vite-plus/test";

import { DrizzleDbContext } from "#litmus-db/drizzle/postgres/db-context.ts";

export function setupTestDb(options: {
  schema: Record<string, unknown>;
}): void {
  const tableNames = Object.values(options.schema)
    .filter((v): v is PgTable => is(v, PgTable))
    .map((t) => `"${getTableName(t)}"`)
    .join(", ");

  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    const client = new PGlite();
    const rawDb = drizzle(client);
    const { apply } = await pushSchema(options.schema, rawDb);
    await apply();

    db = drizzle(client, { schema: options.schema });
    DrizzleDbContext.register(db);
  });

  beforeEach(async () => {
    await db.execute(
      sql.raw(`TRUNCATE ${tableNames} RESTART IDENTITY CASCADE`),
    );
    container.clearInstances();
    DrizzleDbContext.register(db);
  });
}

import {
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

export const books = pgTable("books", {
  id: varchar("id").primaryKey(),
  data: jsonb("data")
    .notNull()
    .$type<{ title: string; author: string; price: number }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{ name: string }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const carts = pgTable("carts", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{
    customerId: string;
    status: "open" | "checked-out";
    lines: Array<{ bookId: string; title: string; price: number }>;
  }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey(),
  data: jsonb("data").notNull().$type<{
    customerId: string;
    status: "placed";
    lines: Array<{ bookId: string; title: string; price: number }>;
  }>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schema = { books, customers, carts, orders };

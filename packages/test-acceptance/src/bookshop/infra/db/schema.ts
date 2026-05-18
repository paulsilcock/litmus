import {
  doublePrecision,
  integer,
  jsonb,
  pgTable,
  timestamp,
  varchar,
} from "drizzle-orm/pg-core";

import type { BookId } from "#bookshop/domain/book.ts";
import type { CartId, CartStatus } from "#bookshop/domain/cart.ts";
import type { CustomerId } from "#bookshop/domain/customer.ts";
import type { OrderId, OrderStatus } from "#bookshop/domain/order.ts";

export const books = pgTable("books", {
  id: varchar("id").primaryKey().$type<BookId>(),
  title: varchar("title").notNull(),
  author: varchar("author").notNull(),
  price: doublePrecision("price").notNull(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const customers = pgTable("customers", {
  id: varchar("id").primaryKey().$type<CustomerId>(),
  name: varchar("name").notNull(),
  email: varchar("email").notNull().unique(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const carts = pgTable("carts", {
  id: varchar("id").primaryKey().$type<CartId>(),
  customerId: varchar("customer_id").notNull().$type<CustomerId>(),
  status: varchar("status").notNull().$type<CartStatus>(),
  lines: jsonb("lines")
    .notNull()
    .$type<Array<{ bookId: BookId; title: string; price: number }>>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const orders = pgTable("orders", {
  id: varchar("id").primaryKey().$type<OrderId>(),
  customerId: varchar("customer_id").notNull().$type<CustomerId>(),
  status: varchar("status").notNull().$type<OrderStatus>(),
  lines: jsonb("lines")
    .notNull()
    .$type<Array<{ bookId: BookId; title: string; price: number }>>(),
  version: integer("version").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const schema = { books, customers, carts, orders };

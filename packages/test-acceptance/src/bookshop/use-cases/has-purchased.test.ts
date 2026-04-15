import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { beforeEach, describe, expect, it } from "vite-plus/test";

import { Book } from "../domain/book.ts";
import { Customer } from "../domain/customer.ts";
import { Purchase } from "../domain/purchase.ts";
import { BookRepository } from "../infra/book-repository.ts";
import { CustomerRepository } from "../infra/customer-repository.ts";
import { PurchaseRepository } from "../infra/purchase-repository.ts";
import { schema } from "../infra/schema.ts";
import { HasPurchased } from "./has-purchased.ts";

describe("HasPurchased", () => {
  let ctx: DrizzleDbContext;
  let bookRepo: BookRepository;
  let customerRepo: CustomerRepository;
  let purchaseRepo: PurchaseRepository;
  let handler: HasPurchased;

  beforeEach(async () => {
    const pg = new PGlite();
    const rawDb = drizzle(pg);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(pg, { schema });
    ctx = new DrizzleDbContext(db, new DomainEventDispatcher());
    bookRepo = new BookRepository(ctx);
    customerRepo = new CustomerRepository(ctx);
    purchaseRepo = new PurchaseRepository(ctx);
    handler = new HasPurchased(ctx, customerRepo, bookRepo);
  });

  it("returns true when the customer owns the book", async () => {
    const alice = new Customer({ id: "customer_1", name: "Alice" });
    const hobbit = new Book({
      id: "book_1",
      title: "The Hobbit",
      author: "Tolkien",
      price: 12.99,
    });
    await customerRepo.add(alice);
    await bookRepo.add(hobbit);
    await purchaseRepo.add(
      new Purchase({
        id: "purchase_1",
        customerId: alice.id,
        bookId: hobbit.id,
      }),
    );

    const owned = await handler.handle({
      customer: "Alice",
      title: "The Hobbit",
    });

    expect(owned).toBe(true);
  });

  it("returns false when the customer doesn't own the book", async () => {
    await customerRepo.add(new Customer({ id: "customer_1", name: "Alice" }));
    await bookRepo.add(
      new Book({
        id: "book_1",
        title: "The Hobbit",
        author: "Tolkien",
        price: 12.99,
      }),
    );

    const owned = await handler.handle({
      customer: "Alice",
      title: "The Hobbit",
    });

    expect(owned).toBe(false);
  });
});

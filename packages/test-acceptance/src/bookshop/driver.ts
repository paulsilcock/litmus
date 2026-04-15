import "reflect-metadata";
import { PGlite } from "@electric-sql/pglite";
import { DomainEventDispatcher } from "@litmus/core/events";
import { DrizzleDbContext } from "@litmus/db/drizzle/postgres";
import { type LitmusServer, serve } from "@litmus/http";
import { BaseHonoDriver } from "@litmus/test";
import { pushSchema } from "drizzle-kit/api";
import { drizzle } from "drizzle-orm/pglite";
import { container } from "tsyringe";

import { type BookshopApp, createBookshopApp } from "./http/app.ts";
import { BookRepository } from "./infra/book-repository.ts";
import { CartRepository } from "./infra/cart-repository.ts";
import { CustomerRepository } from "./infra/customer-repository.ts";
import { PurchaseRepository } from "./infra/purchase-repository.ts";
import { schema } from "./infra/schema.ts";
import { StubPaymentGateway } from "./infra/stub-payment-gateway.ts";

interface BookSearchResult {
  title: string;
  author: string;
  price: number;
}

function isBookSearchResult(value: unknown): value is BookSearchResult {
  if (typeof value !== "object" || value === null) return false;
  const v: Record<string, unknown> = { ...value };
  return (
    typeof v["title"] === "string" &&
    typeof v["author"] === "string" &&
    typeof v["price"] === "number"
  );
}

export class BookshopDriver extends BaseHonoDriver<BookshopApp> {
  #server?: LitmusServer;
  #currentCustomer?: string;
  #lastSearchResults: BookSearchResult[] = [];

  constructor() {
    super({ baseUrl: "http://localhost:0" });
  }

  loginAs(name: string): void {
    this.#currentCustomer = name;
  }

  get #customer(): string {
    if (!this.#currentCustomer) {
      throw new Error("No customer is logged in");
    }
    return this.#currentCustomer;
  }

  async init(): Promise<void> {
    const pg = new PGlite();
    const rawDb = drizzle(pg);
    const { apply } = await pushSchema(schema, rawDb);
    await apply();

    const db = drizzle(pg, { schema });
    const dispatcher = new DomainEventDispatcher();
    const ctx = new DrizzleDbContext(db, dispatcher);

    const bookRepo = new BookRepository(ctx);
    const customerRepo = new CustomerRepository(ctx);
    const cartRepo = new CartRepository(ctx);
    const purchaseRepo = new PurchaseRepository(ctx);
    const paymentGateway = new StubPaymentGateway();

    container.register("BookRepository", { useValue: bookRepo });
    container.register("CustomerRepository", { useValue: customerRepo });
    container.register("CartRepository", { useValue: cartRepo });
    container.register("PurchaseRepository", { useValue: purchaseRepo });
    container.register("PaymentGateway", { useValue: paymentGateway });
    container.register("BookLookup", { useValue: bookRepo });
    container.register("CustomerLookup", { useValue: customerRepo });
    container.register("DrizzleDbContext", { useValue: ctx });

    const app = createBookshopApp();
    this.#server = await serve(app, { port: 0 });
    this.setBaseUrl(`http://localhost:${this.#server.port}`);
  }

  async cleanup(): Promise<void> {
    await this.#server?.stop();
    container.reset();
  }

  async putBookOnSale(input: {
    title: string;
    author: string;
    price: number;
  }): Promise<void> {
    const res = await this.client.books.$post({ json: input });
    if (!res.ok) {
      throw new Error(`putBookOnSale failed: ${res.status}`);
    }
  }

  async registerCustomer(name: string): Promise<void> {
    const res = await this.client.customers.$post({ json: { name } });
    if (!res.ok) {
      throw new Error(`registerCustomer failed: ${res.status}`);
    }
  }

  async searchBooksByAuthor(author: string): Promise<void> {
    const res = await this.client.books.search.$get({ query: { author } });
    if (!res.ok) {
      throw new Error(`searchBooksByAuthor failed: ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!Array.isArray(body) || !body.every(isBookSearchResult)) {
      throw new Error("searchBooksByAuthor: unexpected response shape");
    }
    this.#lastSearchResults = body;
  }

  async addBookToCart(title: string): Promise<void> {
    const inResults = this.#lastSearchResults.some((b) => b.title === title);
    if (!inResults) {
      throw new Error(
        `Book "${title}" is not among the current search results`,
      );
    }
    const res = await this.client.cart.items.$post({
      json: { customer: this.#customer, title },
    });
    if (!res.ok) {
      throw new Error(`addBookToCart failed: ${res.status}`);
    }
  }

  async checkOut(): Promise<void> {
    const res = await this.client.checkout.$post({
      json: { customer: this.#customer },
    });
    if (!res.ok) {
      throw new Error(`checkOut failed: ${res.status}`);
    }
  }

  async assertBookPurchased(title: string): Promise<void> {
    const res = await this.client.purchases.check.$get({
      query: { customer: this.#customer, title },
    });
    if (!res.ok) {
      throw new Error(`assertBookPurchased failed: ${res.status}`);
    }
    const owned: unknown = await res.json();
    if (owned !== true) {
      throw new Error(
        `Expected ${this.#customer} to own "${title}" but they do not`,
      );
    }
  }
}

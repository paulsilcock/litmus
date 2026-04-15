import { BaseHonoDriver } from "@litmus/test";

import type { BookshopApp } from "./entrypoints/http/app.ts";

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
  #currentCustomer?: string;
  #lastSearchResults: BookSearchResult[] = [];

  constructor(baseUrl: string) {
    super({ baseUrl });
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

  async cleanup(): Promise<void> {
    this.#currentCustomer = undefined;
    this.#lastSearchResults = [];
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

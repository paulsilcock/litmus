import { BaseHonoDriver } from "@litmus/http/testing";

import type { BookshopApp } from "../../entrypoints/http/app.ts";
import type { BookshopDriverApi } from "../driver.ts";
import { EmailStubClient } from "../email-stub-client.ts";

interface BookSearchResult {
  title: string;
  author: string;
  price: number;
}

interface OrderSummary {
  id: string;
  status: string;
  total: number;
  lines: Array<{ title: string; price: number }>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isBookSearchResult(value: unknown): value is BookSearchResult {
  if (!isRecord(value)) return false;
  return (
    typeof value["title"] === "string" &&
    typeof value["author"] === "string" &&
    typeof value["price"] === "number"
  );
}

function isOrderLine(
  value: unknown,
): value is { title: string; price: number } {
  if (!isRecord(value)) return false;
  return (
    typeof value["title"] === "string" && typeof value["price"] === "number"
  );
}

function isOrderSummary(value: unknown): value is OrderSummary {
  if (!isRecord(value)) return false;
  return (
    typeof value["id"] === "string" &&
    typeof value["status"] === "string" &&
    typeof value["total"] === "number" &&
    Array.isArray(value["lines"]) &&
    value["lines"].every(isOrderLine)
  );
}

function isOrderSummaryArray(value: unknown): value is OrderSummary[] {
  return Array.isArray(value) && value.every(isOrderSummary);
}

export class BookshopHttpDriver
  extends BaseHonoDriver<BookshopApp>
  implements BookshopDriverApi
{
  readonly #emailStub: EmailStubClient;
  #currentCustomerEmail?: string;
  #lastSearchResults: BookSearchResult[] = [];

  constructor(baseUrl: string, emailStubBaseUrl: string) {
    super({ baseUrl });
    this.#emailStub = new EmailStubClient(emailStubBaseUrl);
  }

  loginAs(email: string): void {
    this.#currentCustomerEmail = email;
  }

  get #customerEmail(): string {
    if (!this.#currentCustomerEmail) {
      throw new Error("No customer is logged in");
    }
    return this.#currentCustomerEmail;
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

  async registerCustomer(name: string, email: string): Promise<void> {
    const res = await this.client.customers.$post({
      json: { name, email },
    });
    if (!res.ok) {
      throw new Error(`registerCustomer failed: ${res.status}`);
    }
  }

  async assertConfirmationEmailSent(to: string): Promise<void> {
    const received = await this.#emailStub.received();
    const match = received.find(
      (email) => email.to === to && /confirm/i.test(email.subject),
    );
    if (!match) {
      throw new Error(
        `Expected a confirmation email to ${to}, got ${JSON.stringify(received)}`,
      );
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
      json: { customerEmail: this.#customerEmail, title },
    });
    if (!res.ok) {
      throw new Error(`addBookToCart failed: ${res.status}`);
    }
  }

  async checkOut(): Promise<void> {
    const res = await this.client.checkout.$post({
      json: { customerEmail: this.#customerEmail },
    });
    if (!res.ok) {
      throw new Error(`checkOut failed: ${res.status}`);
    }
  }

  async assertBookPurchased(title: string): Promise<void> {
    const res = await this.client.customers[":customerEmail"].orders.$get({
      param: { customerEmail: this.#customerEmail },
    });
    if (!res.ok) {
      throw new Error(`order history fetch failed: ${res.status}`);
    }
    const orders: unknown = await res.json();
    if (!isOrderSummaryArray(orders)) {
      throw new Error("order history: unexpected response shape");
    }
    const found = orders.some((order) =>
      order.lines.some((line) => line.title === title),
    );
    if (!found) {
      throw new Error(
        `Expected an order containing "${title}" in ${this.#customerEmail}'s history, found none`,
      );
    }
  }
}

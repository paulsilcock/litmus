import { cliClient } from "@litmus/cli";

import type { BookshopCli } from "../../entrypoints/cli/app.ts";
import type { BookshopDriverApi } from "../driver.ts";
import { EmailStubClient } from "../email-stub-client.ts";

type BookshopCliClient = ReturnType<typeof cliClient<BookshopCli>>;

interface BookSearchResult {
  title: string;
  author: string;
  price: number;
}

export class BookshopCliDriver implements BookshopDriverApi {
  readonly #client: BookshopCliClient;
  readonly #emailStub: EmailStubClient;
  #currentCustomerEmail?: string;
  #lastSearchResults: BookSearchResult[] = [];

  constructor(socketPath: string, emailStubBaseUrl: string) {
    this.#client = cliClient<BookshopCli>(socketPath);
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
    await this.#client.exec("books:put-on-sale", input);
  }

  async registerCustomer(name: string, email: string): Promise<void> {
    await this.#client.exec("customers:register", { name, email });
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
    this.#lastSearchResults = await this.#client.exec("books:search", {
      author,
    });
  }

  async addBookToCart(title: string): Promise<void> {
    const inResults = this.#lastSearchResults.some((b) => b.title === title);
    if (!inResults) {
      throw new Error(
        `Book "${title}" is not among the current search results`,
      );
    }
    await this.#client.exec("cart:add-book", {
      customerEmail: this.#customerEmail,
      title,
    });
  }

  async checkOut(): Promise<void> {
    await this.#client.exec("cart:check-out", {
      customerEmail: this.#customerEmail,
    });
  }

  async assertBookPurchased(title: string): Promise<void> {
    const orders = await this.#client.exec("orders:list", {
      customerEmail: this.#customerEmail,
    });
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

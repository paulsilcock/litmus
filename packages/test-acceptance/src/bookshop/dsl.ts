import { Dsl } from "@litmus/test";

import { BookshopDriver } from "./driver.ts";

interface BookDetails {
  title: string;
  author: string;
  price: number;
}

export class BookshopDsl extends Dsl {
  readonly #driver: BookshopDriver;

  constructor(baseUrl: string) {
    super();
    this.#driver = new BookshopDriver(baseUrl);
  }

  async cleanup(): Promise<void> {
    await this.#driver.cleanup();
  }

  async ensureBookIsInStock(details: BookDetails): Promise<void> {
    await this.#driver.putBookOnSale(details);
  }

  async ensureCustomerIsRegistered(details: { name: string }): Promise<void> {
    await this.#driver.registerCustomer(details.name);
  }

  async loginAsCustomer(details: { name: string }): Promise<void> {
    this.#driver.loginAs(details.name);
  }

  async searchForBook(criteria: { author: string }): Promise<void> {
    await this.#driver.searchBooksByAuthor(criteria.author);
  }

  async addBookToCart(selection: { title: string }): Promise<void> {
    await this.#driver.addBookToCart(selection.title);
  }

  async checkOut(): Promise<void> {
    await this.#driver.checkOut();
  }

  async assertBookPurchased(expected: { title: string }): Promise<void> {
    await this.#driver.assertBookPurchased(expected.title);
  }
}

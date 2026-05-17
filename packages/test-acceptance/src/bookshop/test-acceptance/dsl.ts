import { Dsl } from "@litmus/test";

import { BookshopDriver } from "./driver.ts";

class CustomersDsl extends Dsl {
  async hasAccount(_input: { name: string; email: string }): Promise<void> {
    throw new Error("CustomersDsl.hasAccount: not implemented");
  }

  async logIn(_input: { email: string }): Promise<void> {
    throw new Error("CustomersDsl.logIn: not implemented");
  }
}

class BooksDsl extends Dsl {
  async hasOnSale(_input: {
    title: string;
    author: string;
    price: number;
  }): Promise<void> {
    throw new Error("BooksDsl.hasOnSale: not implemented");
  }

  async searchBy(_input: { author: string }): Promise<void> {
    throw new Error("BooksDsl.searchBy: not implemented");
  }
}

class CartDsl extends Dsl {
  async addBook(_input: { title: string }): Promise<void> {
    throw new Error("CartDsl.addBook: not implemented");
  }

  async checkOut(): Promise<void> {
    throw new Error("CartDsl.checkOut: not implemented");
  }
}

class OrdersDsl extends Dsl {
  async confirmPurchased(_input: { title: string }): Promise<void> {
    throw new Error("OrdersDsl.confirmPurchased: not implemented");
  }
}

export class BookshopDsl extends Dsl {
  readonly customers: CustomersDsl;
  readonly books: BooksDsl;
  readonly cart: CartDsl;
  readonly orders: OrdersDsl;
  readonly #driver: BookshopDriver;

  constructor(baseUrl: string, emailStubBaseUrl: string) {
    super();
    this.#driver = new BookshopDriver(baseUrl, emailStubBaseUrl);
    this.customers = new CustomersDsl();
    this.books = new BooksDsl();
    this.cart = new CartDsl();
    this.orders = new OrdersDsl();
  }

  async cleanup(): Promise<void> {
    await this.#driver.cleanup();
  }
}

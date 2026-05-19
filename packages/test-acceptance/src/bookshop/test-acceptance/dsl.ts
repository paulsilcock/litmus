import { Dsl } from "@litmus/test";

import type { BookshopDriver } from "./driver.ts";
import { BooksDsl } from "./dsl/books.ts";
import { CartDsl } from "./dsl/cart.ts";
import { CustomersDsl } from "./dsl/customers.ts";
import { OrdersDsl } from "./dsl/orders.ts";

export class BookshopDsl extends Dsl<BookshopDriver> {
  readonly customers: CustomersDsl;
  readonly books: BooksDsl;
  readonly cart: CartDsl;
  readonly orders: OrdersDsl;

  constructor(driver: BookshopDriver) {
    super(driver);
    this.customers = new CustomersDsl(driver, this.context);
    this.books = new BooksDsl(driver, this.context);
    this.cart = new CartDsl(driver, this.context);
    this.orders = new OrdersDsl(driver, this.context);
  }
}

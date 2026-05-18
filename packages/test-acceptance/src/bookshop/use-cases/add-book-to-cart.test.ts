import { container } from "tsyringe";
import { describe, expect, it } from "vite-plus/test";

import { Book } from "#bookshop/domain/book.ts";
import { Customer } from "#bookshop/domain/customer.ts";
import { BookRepository } from "#bookshop/infra/repositories/book-repository.ts";
import { CartRepository } from "#bookshop/infra/repositories/cart-repository.ts";
import { CustomerRepository } from "#bookshop/infra/repositories/customer-repository.ts";
import { setupBookshopTest } from "#bookshop/test-support/init-test-container.ts";

import { AddBookToCart } from "./add-book-to-cart.ts";

describe("AddBookToCart", () => {
  setupBookshopTest();

  it("adds to the customer's existing open cart rather than creating another", async () => {
    const customers = container.resolve(CustomerRepository);
    const books = container.resolve(BookRepository);

    const alice = new Customer({
      id: customers.nextId(),
      name: "Alice",
      email: "alice@example.com",
    });
    await customers.add(alice);

    await books.add(
      new Book({
        id: books.nextId(),
        title: "The Hobbit",
        author: "Tolkien",
        price: 12.99,
      }),
    );
    await books.add(
      new Book({
        id: books.nextId(),
        title: "Dune",
        author: "Herbert",
        price: 14.5,
      }),
    );

    const addBookToCart = container.resolve(AddBookToCart);
    await addBookToCart.handle({
      customerEmail: "alice@example.com",
      title: "The Hobbit",
    });
    await addBookToCart.handle({
      customerEmail: "alice@example.com",
      title: "Dune",
    });

    const cart = await container
      .resolve(CartRepository)
      .findOpenForCustomer(alice.id);
    expect(cart?.items.map((line) => line.title)).toEqual([
      "The Hobbit",
      "Dune",
    ]);
  });
});

import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";

import type { Book } from "../domain/book.ts";
import { Cart } from "../domain/cart.ts";
import type { Customer } from "../domain/customer.ts";

interface CustomerLookup {
  findByName(name: string): Promise<Customer | null>;
}

interface BookLookup {
  findByTitle(title: string): Promise<Book | null>;
}

interface CartRepository {
  nextId(): string;
  findOpenForCustomer(customerId: string): Promise<Cart | null>;
  add(cart: Cart): Promise<void>;
  update(cart: Cart): Promise<void>;
}

interface AddBookToCartCommand extends Record<string, unknown> {
  customer: string;
  title: string;
}

@injectable()
export class AddBookToCart extends CommandHandler<AddBookToCartCommand> {
  constructor(
    @inject("CustomerLookup") private readonly customers: CustomerLookup,
    @inject("BookLookup") private readonly books: BookLookup,
    @inject("CartRepository") private readonly carts: CartRepository,
  ) {
    super();
  }

  async handle({ customer, title }: AddBookToCartCommand): Promise<void> {
    const c = await this.customers.findByName(customer);
    if (!c) throw new Error(`Unknown customer: ${customer}`);
    const b = await this.books.findByTitle(title);
    if (!b) throw new Error(`Unknown book: ${title}`);

    const existing = await this.carts.findOpenForCustomer(c.id);
    if (existing) {
      existing.add({ bookId: b.id, title: b.title, price: b.price });
      await this.carts.update(existing);
    } else {
      const cart = new Cart({ id: this.carts.nextId(), customerId: c.id });
      cart.add({ bookId: b.id, title: b.title, price: b.price });
      await this.carts.add(cart);
    }
  }
}

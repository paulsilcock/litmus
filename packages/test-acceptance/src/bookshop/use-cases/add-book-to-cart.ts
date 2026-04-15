import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";

import { Cart } from "../domain/cart.ts";
import { BookRepository } from "../infra/repositories/book-repository.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

interface AddBookToCartCommand extends Record<string, unknown> {
  customer: string;
  title: string;
}

@injectable()
export class AddBookToCart extends CommandHandler<AddBookToCartCommand> {
  constructor(
    private readonly customers: CustomerRepository,
    private readonly books: BookRepository,
    private readonly carts: CartRepository,
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

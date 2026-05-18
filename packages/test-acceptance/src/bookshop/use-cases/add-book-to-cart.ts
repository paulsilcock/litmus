import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";
import { z } from "zod";

import { Cart } from "../domain/cart.ts";
import { BookRepository } from "../infra/repositories/book-repository.ts";
import { CartRepository } from "../infra/repositories/cart-repository.ts";
import { CustomerRepository } from "../infra/repositories/customer-repository.ts";

export const AddBookToCartSchema = z.object({
  customerEmail: z.string().email(),
  title: z.string(),
});

interface AddBookToCartCommand extends Record<string, unknown> {
  customerEmail: string;
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

  async handle({ customerEmail, title }: AddBookToCartCommand): Promise<void> {
    const customer = await this.customers.findByEmail(customerEmail);
    const book = await this.books.findByTitle(title);
    const line = { bookId: book.id, title: book.title, price: book.price };

    const existing = await this.carts.findOpenForCustomer(customer.id);
    if (existing) {
      existing.add(line);
      await this.carts.update(existing);
    } else {
      const cart = new Cart({
        id: this.carts.nextId(),
        customerId: customer.id,
      });
      cart.add(line);
      await this.carts.add(cart);
    }
  }
}

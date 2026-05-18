import { Cli } from "@litmus/cli";
import { z } from "zod";

import { AddBookToCart } from "../../use-cases/add-book-to-cart.ts";
import { CheckOut } from "../../use-cases/check-out.ts";
import { GetCustomerOrders } from "../../use-cases/get-customer-orders.ts";
import { PutBookOnSale } from "../../use-cases/put-book-on-sale.ts";
import { RegisterCustomer } from "../../use-cases/register-customer.ts";
import { SearchBooksByAuthor } from "../../use-cases/search-books-by-author.ts";

const PutBookOnSaleSchema = z.object({
  title: z.string(),
  author: z.string(),
  price: z.number(),
});

const SearchBooksByAuthorSchema = z.object({
  author: z.string(),
});

const RegisterCustomerSchema = z.object({
  name: z.string(),
  email: z.string().email(),
});

const AddBookToCartSchema = z.object({
  customerEmail: z.string().email(),
  title: z.string(),
});

const CheckOutSchema = z.object({
  customerEmail: z.string().email(),
});

const GetCustomerOrdersSchema = z.object({
  customerEmail: z.string().email(),
});

export function createBookshopCli() {
  const booksCli = new Cli()
    .command("put-on-sale", PutBookOnSale, PutBookOnSaleSchema)
    .command("search", SearchBooksByAuthor, SearchBooksByAuthorSchema);

  const customersCli = new Cli().command(
    "register",
    RegisterCustomer,
    RegisterCustomerSchema,
  );

  const cartCli = new Cli()
    .command("add-book", AddBookToCart, AddBookToCartSchema)
    .command("check-out", CheckOut, CheckOutSchema);

  const ordersCli = new Cli().command(
    "list",
    GetCustomerOrders,
    GetCustomerOrdersSchema,
  );

  return new Cli()
    .command("books", booksCli)
    .command("customers", customersCli)
    .command("cart", cartCli)
    .command("orders", ordersCli);
}

export type BookshopCli = ReturnType<typeof createBookshopCli>;

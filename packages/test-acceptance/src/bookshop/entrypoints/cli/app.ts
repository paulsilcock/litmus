import { Cli } from "@litmus/cli";

import {
  AddBookToCart,
  AddBookToCartSchema,
} from "#bookshop/use-cases/add-book-to-cart.ts";
import { CheckOut, CheckOutSchema } from "#bookshop/use-cases/check-out.ts";
import {
  GetCustomerOrders,
  GetCustomerOrdersSchema,
} from "#bookshop/use-cases/get-customer-orders.ts";
import {
  PutBookOnSale,
  PutBookOnSaleSchema,
} from "#bookshop/use-cases/put-book-on-sale.ts";
import {
  RegisterCustomer,
  RegisterCustomerSchema,
} from "#bookshop/use-cases/register-customer.ts";
import {
  SearchBooksByAuthor,
  SearchBooksByAuthorSchema,
} from "#bookshop/use-cases/search-books-by-author.ts";

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

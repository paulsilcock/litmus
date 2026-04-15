import { Hono } from "hono";

import { booksRoutes } from "./routes/books.ts";
import { cartRoutes } from "./routes/cart.ts";
import { checkoutRoutes } from "./routes/checkout.ts";
import { customersRoutes } from "./routes/customers.ts";

export function createBookshopApp() {
  return new Hono()
    .route("/books", booksRoutes)
    .route("/customers", customersRoutes)
    .route("/cart", cartRoutes)
    .route("/checkout", checkoutRoutes);
}

export type BookshopApp = ReturnType<typeof createBookshopApp>;

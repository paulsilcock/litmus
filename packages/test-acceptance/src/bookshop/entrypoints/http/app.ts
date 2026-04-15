import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
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

const RegisterCustomerSchema = z.object({
  name: z.string(),
});

const SearchBooksByAuthorSchema = z.object({
  author: z.string(),
});

const AddBookToCartSchema = z.object({
  customer: z.string(),
  title: z.string(),
});

const CheckOutSchema = z.object({
  customer: z.string(),
});

const GetCustomerOrdersSchema = z.object({
  customer: z.string(),
});

const books = new Hono()
  .post("/", ...routeHandler(PutBookOnSale, PutBookOnSaleSchema))
  .get(
    "/search",
    ...routeHandler(SearchBooksByAuthor, SearchBooksByAuthorSchema, {
      target: "query",
    }),
  );

const customers = new Hono()
  .post("/", ...routeHandler(RegisterCustomer, RegisterCustomerSchema))
  .get(
    "/:customer/orders",
    ...routeHandler(GetCustomerOrders, GetCustomerOrdersSchema, {
      target: "param",
    }),
  );

const cart = new Hono().post(
  "/items",
  ...routeHandler(AddBookToCart, AddBookToCartSchema),
);

const checkout = new Hono().post(
  "/",
  ...routeHandler(CheckOut, CheckOutSchema),
);

export function createBookshopApp() {
  return new Hono()
    .route("/books", books)
    .route("/customers", customers)
    .route("/cart", cart)
    .route("/checkout", checkout);
}

export type BookshopApp = ReturnType<typeof createBookshopApp>;

import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
import { z } from "zod";

import { AddBookToCart } from "../use-cases/add-book-to-cart.ts";
import { CheckOut } from "../use-cases/check-out.ts";
import { HasPurchased } from "../use-cases/has-purchased.ts";
import { PutBookOnSale } from "../use-cases/put-book-on-sale.ts";
import { RegisterCustomer } from "../use-cases/register-customer.ts";
import { SearchBooksByAuthor } from "../use-cases/search-books-by-author.ts";

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

const HasPurchasedSchema = z.object({
  customer: z.string(),
  title: z.string(),
});

export function createBookshopApp() {
  return new Hono()
    .post("/books", ...routeHandler(PutBookOnSale, PutBookOnSaleSchema))
    .post(
      "/customers",
      ...routeHandler(RegisterCustomer, RegisterCustomerSchema),
    )
    .get(
      "/books/search",
      ...routeHandler(SearchBooksByAuthor, SearchBooksByAuthorSchema, {
        target: "query",
      }),
    )
    .post("/cart/items", ...routeHandler(AddBookToCart, AddBookToCartSchema))
    .post("/checkout", ...routeHandler(CheckOut, CheckOutSchema))
    .get(
      "/purchases/check",
      ...routeHandler(HasPurchased, HasPurchasedSchema, { target: "query" }),
    );
}

export type BookshopApp = ReturnType<typeof createBookshopApp>;

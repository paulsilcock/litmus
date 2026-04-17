import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
import { z } from "zod";

import { PutBookOnSale } from "../../../use-cases/put-book-on-sale.ts";
import { SearchBooksByAuthor } from "../../../use-cases/search-books-by-author.ts";

const PutBookOnSaleSchema = z.object({
  title: z.string(),
  author: z.string(),
  price: z.number(),
});

const SearchBooksByAuthorSchema = z.object({
  author: z.string(),
});

export const booksRoutes = new Hono()
  .post("/", ...routeHandler(PutBookOnSale, PutBookOnSaleSchema))
  .get(
    "/search",
    ...routeHandler(SearchBooksByAuthor, SearchBooksByAuthorSchema, {
      target: "query",
    }),
  );

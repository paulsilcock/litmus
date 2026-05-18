import { routeHandler } from "@litmus/http";
import { Hono } from "hono";

import {
  PutBookOnSale,
  PutBookOnSaleSchema,
} from "#bookshop/use-cases/put-book-on-sale.ts";
import {
  SearchBooksByAuthor,
  SearchBooksByAuthorSchema,
} from "#bookshop/use-cases/search-books-by-author.ts";

export const booksRoutes = new Hono()
  .post("/", ...routeHandler(PutBookOnSale, PutBookOnSaleSchema))
  .get(
    "/search",
    ...routeHandler(SearchBooksByAuthor, SearchBooksByAuthorSchema, {
      target: "query",
    }),
  );

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
  .post("/", ...routeHandler.noContent(PutBookOnSale, PutBookOnSaleSchema))
  .get(
    "/search",
    ...routeHandler.json(SearchBooksByAuthor, SearchBooksByAuthorSchema, {
      target: "query",
    }),
  );

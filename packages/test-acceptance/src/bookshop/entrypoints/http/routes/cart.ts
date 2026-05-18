import { routeHandler } from "@litmus/http";
import { Hono } from "hono";

import {
  AddBookToCart,
  AddBookToCartSchema,
} from "../../../use-cases/add-book-to-cart.ts";

export const cartRoutes = new Hono().post(
  "/items",
  ...routeHandler(AddBookToCart, AddBookToCartSchema),
);

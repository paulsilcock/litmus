import { routeHandler } from "@litmus/http";
import { Hono } from "hono";
import { z } from "zod";

import { AddBookToCart } from "../../../use-cases/add-book-to-cart.ts";

const AddBookToCartSchema = z.object({
  customerEmail: z.string().email(),
  title: z.string(),
});

export const cartRoutes = new Hono().post(
  "/items",
  ...routeHandler(AddBookToCart, AddBookToCartSchema),
);

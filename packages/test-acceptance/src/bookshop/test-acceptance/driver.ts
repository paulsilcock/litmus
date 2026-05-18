import type { RunningBookshop } from "../bookshop.ts";
import { BookshopCliDriver } from "./driver/cli.ts";
import { BookshopHttpDriver } from "./driver/http.ts";

export interface BookshopDriverApi {
  loginAs(email: string): void;
  cleanup(): Promise<void>;
  putBookOnSale(input: {
    title: string;
    author: string;
    price: number;
  }): Promise<void>;
  registerCustomer(name: string, email: string): Promise<void>;
  assertConfirmationEmailSent(to: string): Promise<void>;
  searchBooksByAuthor(author: string): Promise<void>;
  addBookToCart(title: string): Promise<void>;
  checkOut(): Promise<void>;
  assertBookPurchased(title: string): Promise<void>;
}

export function createBookshopDriver(
  bookshop: RunningBookshop,
): BookshopDriverApi {
  const protocol = process.env["BOOKSHOP_DRIVER"] ?? "http";
  switch (protocol) {
    case "http":
      return new BookshopHttpDriver(
        bookshop.baseUrl,
        bookshop.emailStubBaseUrl,
      );
    case "cli":
      return new BookshopCliDriver(
        bookshop.cliSocketPath,
        bookshop.emailStubBaseUrl,
      );
    default:
      throw new Error(
        `Unknown BOOKSHOP_DRIVER: "${protocol}". Use "http" or "cli".`,
      );
  }
}

import { AggregateRoot, type AggregateData } from "@litmus/core";
import type { PrefixedUlid } from "@litmus/core/id";

import type { BookId } from "./book.ts";
import type { CustomerId } from "./customer.ts";

export type CartId = PrefixedUlid<"cart">;

export interface CartLine {
  bookId: BookId;
  title: string;
  price: number;
}

export type CartStatus = "open" | "checked-out";

interface CartData extends AggregateData<CartId> {
  customerId: CustomerId;
  status: CartStatus;
  lines: CartLine[];
}

export class Cart extends AggregateRoot<CartData, CartId> {
  constructor(init: {
    id: CartId;
    customerId: CustomerId;
    status?: CartStatus;
    lines?: CartLine[];
    version?: number;
  }) {
    super({
      ...init,
      status: init.status ?? "open",
      lines: init.lines ?? [],
    });
  }

  get customerId(): CustomerId {
    return this.data.customerId;
  }

  get status(): CartStatus {
    return this.data.status;
  }

  get items(): readonly CartLine[] {
    return this.data.lines;
  }

  get total(): number {
    const cents = this.data.lines.reduce(
      (sum, line) => sum + Math.round(line.price * 100),
      0,
    );
    return cents / 100;
  }

  add(line: CartLine): void {
    this.data.lines.push(line);
  }

  checkOut(): void {
    if (this.data.lines.length === 0) {
      throw new Error("Cannot check out an empty cart");
    }
    this.data.status = "checked-out";
  }
}

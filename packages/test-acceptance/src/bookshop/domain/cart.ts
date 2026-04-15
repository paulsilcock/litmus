import { AggregateRoot, type AggregateData } from "@litmus/core";

export interface CartLine {
  bookId: string;
  title: string;
  price: number;
}

export type CartStatus = "open" | "checked-out";

interface CartData extends AggregateData {
  customerId: string;
  status: CartStatus;
  lines: CartLine[];
}

export class Cart extends AggregateRoot<CartData> {
  constructor(init: {
    id: string;
    customerId: string;
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

  get customerId(): string {
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

import { describe, expect, it } from "vite-plus/test";

import { ValueObject } from "#litmus/domain/value-object.ts";

class Money extends ValueObject {
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {
    super();
  }

  protected properties() {
    return { amount: this.amount, currency: this.currency };
  }
}

class Price extends ValueObject {
  constructor(
    readonly amount: number,
    readonly currency: string,
  ) {
    super();
  }

  protected properties() {
    return { amount: this.amount, currency: this.currency };
  }
}

describe("ValueObject", () => {
  it("equality is based on value", () => {
    const tenUsd1 = new Money(10, "USD");
    const tenUsd2 = new Money(10, "USD");
    const twentyUsd = new Money(20, "USD");
    const tenGbp = new Money(10, "GBP");

    expect(tenUsd1.equals(tenUsd2)).toBe(true);
    expect(tenUsd1.equals(twentyUsd)).toBe(false);
    expect(tenUsd1.equals(tenGbp)).toBe(false);
  });

  it("different value object types with the same values are not equal", () => {
    const money = new Money(10, "USD");
    const price = new Price(10, "USD");

    expect(money.equals(price)).toBe(false);
  });
});

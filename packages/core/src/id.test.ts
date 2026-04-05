import { describe, expect, it } from "vite-plus/test";

import { prefixedUlid } from "#litmus/id.ts";

describe("prefixedUlid", () => {
  it("generates an id with the given prefix", () => {
    const id = prefixedUlid("order");

    expect(id).toMatch(/^order_[0-9A-Z]{26}$/);
  });
});

import { describe, expect, it } from "vite-plus/test";

import { Dsl, DslContext } from "#litmus-test/dsl.ts";

describe("DslContext", () => {
  it("prefixes a suffix to the aliased value", () => {
    const ctx = new DslContext();
    expect(ctx.alias("hello")).toMatch(/^\d+hello$/);
  });

  it("returns the same alias for the same input within one instance", () => {
    const ctx = new DslContext();
    const first = ctx.alias("alice@example.com");
    const second = ctx.alias("alice@example.com");
    expect(first).toBe(second);
  });

  it("yields different aliases across instances for the same input", () => {
    const a = new DslContext();
    const b = new DslContext();
    expect(a.alias("x")).not.toBe(b.alias("x"));
  });
});

describe("Dsl", () => {
  class ExposingDsl extends Dsl {
    getContext(): DslContext {
      return this.context;
    }
  }

  it("creates a fresh context when none is provided", () => {
    const a = new ExposingDsl();
    const b = new ExposingDsl();
    expect(a.getContext()).toBeInstanceOf(DslContext);
    expect(a.getContext()).not.toBe(b.getContext());
  });

  it("reuses a provided context so sub-DSLs share aliases with the root", () => {
    const shared = new DslContext();
    const root = new ExposingDsl(shared);
    const child = new ExposingDsl(shared);
    expect(root.getContext()).toBe(shared);
    expect(child.getContext()).toBe(shared);
    expect(root.getContext().alias("x")).toBe(child.getContext().alias("x"));
  });
});

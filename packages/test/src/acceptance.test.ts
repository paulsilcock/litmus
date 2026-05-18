import { describe, expect, it } from "vite-plus/test";

import { acceptance } from "#litmus-test/acceptance.ts";
import { Dsl } from "#litmus-test/dsl.ts";

describe("acceptance", () => {
  describe("it", () => {
    let constructed = 0;
    let disposed = 0;

    class DisposableTestDsl extends Dsl {
      readonly id = ++constructed;
      async [Symbol.asyncDispose](): Promise<void> {
        disposed += 1;
      }
    }

    const { it: acceptIt } = acceptance(() => new DisposableTestDsl());

    acceptIt("injects a fresh dsl into the test body", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(DisposableTestDsl);
    });

    acceptIt("constructs a new dsl per test", ({ dsl }) => {
      expect(dsl.id).toBeGreaterThan(0);
    });

    it("disposes the dsl after each acceptance test that ran above", () => {
      expect(disposed).toBe(2);
      expect(constructed).toBe(2);
    });
  });

  describe("dsl without Symbol.asyncDispose", () => {
    class PlainTestDsl extends Dsl {}

    const { it: acceptIt } = acceptance(() => new PlainTestDsl());

    acceptIt("does not throw when the dsl has no disposer", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(PlainTestDsl);
    });
  });

  describe("test alias", () => {
    class PlainTestDsl extends Dsl {}
    const { it: acceptIt, test: acceptTest } = acceptance(
      () => new PlainTestDsl(),
    );

    it("exposes test as an alias for it", () => {
      expect(acceptTest).toBe(acceptIt);
    });
  });
});

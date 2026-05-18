import { describe, expect, it } from "vite-plus/test";

import { acceptance } from "#litmus-test/acceptance.ts";
import { Dsl } from "#litmus-test/dsl.ts";

describe("acceptance", () => {
  describe("synchronous factory", () => {
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

  describe("asynchronous factory", () => {
    class AsyncTestDsl extends Dsl {
      readonly resolvedAt: number;
      constructor(resolvedAt: number) {
        super();
        this.resolvedAt = resolvedAt;
      }
    }

    const { it: acceptIt } = acceptance(async () => {
      await Promise.resolve();
      return new AsyncTestDsl(Date.now());
    });

    acceptIt("awaits the factory before injecting the dsl", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(AsyncTestDsl);
      expect(dsl.resolvedAt).toBeGreaterThan(0);
    });
  });

  describe("disposal on failure", () => {
    let disposed = false;

    class FailingTestDsl extends Dsl {
      async [Symbol.asyncDispose](): Promise<void> {
        disposed = true;
      }
    }

    const { it: acceptIt } = acceptance(() => new FailingTestDsl());

    acceptIt.fails(
      "the test body throws — dispose still runs",
      ({ dsl: _dsl }) => {
        throw new Error("boom");
      },
    );

    it("dispose ran even though the previous test threw", () => {
      expect(disposed).toBe(true);
    });
  });

  describe("dsl without Symbol.asyncDispose", () => {
    class PlainTestDsl extends Dsl {}

    const { it: acceptIt } = acceptance(() => new PlainTestDsl());

    acceptIt("does not throw when the dsl has no disposer", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(PlainTestDsl);
    });
  });
});

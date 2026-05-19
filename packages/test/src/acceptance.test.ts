import { describe, expect, it } from "vite-plus/test";

import { acceptance } from "#litmus-test/acceptance.ts";
import { Dsl } from "#litmus-test/dsl.ts";

class StubDriver implements AsyncDisposable {
  disposed = 0;
  async [Symbol.asyncDispose](): Promise<void> {
    this.disposed += 1;
  }
}

describe("acceptance", () => {
  describe("synchronous factory", () => {
    let constructed = 0;
    const drivers: StubDriver[] = [];

    class TestDsl extends Dsl<StubDriver> {
      readonly id = ++constructed;
    }

    const { it: acceptIt } = acceptance(() => {
      const driver = new StubDriver();
      drivers.push(driver);
      return new TestDsl(driver);
    });

    acceptIt("injects a fresh dsl into the test body", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(TestDsl);
    });

    acceptIt("constructs a new dsl per test", ({ dsl }) => {
      expect(dsl.id).toBeGreaterThan(0);
    });

    it("disposes the driver after each acceptance test that ran above", () => {
      expect(constructed).toBe(2);
      expect(drivers).toHaveLength(2);
      for (const driver of drivers) {
        expect(driver.disposed).toBe(1);
      }
    });
  });

  describe("asynchronous factory", () => {
    class AsyncTestDsl extends Dsl<StubDriver> {
      readonly resolvedAt: number;
      constructor(driver: StubDriver, resolvedAt: number) {
        super(driver);
        this.resolvedAt = resolvedAt;
      }
    }

    const { it: acceptIt } = acceptance(async () => {
      await Promise.resolve();
      return new AsyncTestDsl(new StubDriver(), Date.now());
    });

    acceptIt("awaits the factory before injecting the dsl", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(AsyncTestDsl);
      expect(dsl.resolvedAt).toBeGreaterThan(0);
    });
  });

  describe("disposal on failure", () => {
    const driver = new StubDriver();

    class FailingTestDsl extends Dsl<StubDriver> {}

    const { it: acceptIt } = acceptance(() => new FailingTestDsl(driver));

    acceptIt.fails(
      "the test body throws — driver dispose still runs",
      ({ dsl: _dsl }) => {
        throw new Error("boom");
      },
    );

    it("driver was disposed even though the previous test threw", () => {
      expect(driver.disposed).toBe(1);
    });
  });

  describe("dsl subclass overriding asyncDispose", () => {
    let extraDispose = 0;

    class CustomDisposeDsl extends Dsl<StubDriver> {
      async [Symbol.asyncDispose](): Promise<void> {
        extraDispose += 1;
        await super[Symbol.asyncDispose]();
      }
    }

    const driver = new StubDriver();
    const { it: acceptIt } = acceptance(() => new CustomDisposeDsl(driver));

    acceptIt("runs the subclass dispose hook", ({ dsl }) => {
      expect(dsl).toBeInstanceOf(CustomDisposeDsl);
    });

    it("subclass dispose ran and the driver was disposed", () => {
      expect(extraDispose).toBe(1);
      expect(driver.disposed).toBe(1);
    });
  });
});

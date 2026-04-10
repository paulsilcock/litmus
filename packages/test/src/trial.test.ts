import { describe, expect, it } from "vite-plus/test";

import { trial } from "#litmus-test/trial.ts";

describe("trial", () => {
  it("passes when all samples succeed", async () => {
    let runs = 0;

    await trial({ samples: 3 }).each("always passes", async () => {
      runs++;
    });

    expect(runs).toBe(3);
  });

  it("passes when enough samples succeed to meet pass rate", async () => {
    let run = 0;

    await trial({ samples: 5, passRate: 0.6 }).each("some fail", async () => {
      run++;
      if (run <= 2) throw new Error("fail");
    });
  });

  it("fails when too many samples fail to meet pass rate", async () => {
    let run = 0;

    await expect(
      trial({ samples: 5, passRate: 0.8 }).each("most fail", async () => {
        run++;
        if (run <= 3) throw new Error("fail");
      }),
    ).rejects.toThrow("Trial failed: 2/5 passed (40%), required 80%");
  });

  it("iterates fixtures and passes each to the test function", async () => {
    const fixtures = [
      { name: "alice", role: "admin" },
      { name: "bob", role: "user" },
    ];
    const seen: string[] = [];

    await trial({ fixtures }).each("check $name", async (fixture) => {
      seen.push(fixture.name);
    });

    expect(seen).toEqual(["alice", "bob"]);
  });

  it("extend provides fresh context per run", async () => {
    const contextIds: number[] = [];
    let setupCount = 0;

    const withContext = trial.extend<{ id: number }>(async (use) => {
      setupCount++;
      await use({ id: setupCount });
    });

    await withContext({ samples: 3 }).each("with context", async (_ctx) => {
      contextIds.push(_ctx.id);
    });

    expect(contextIds).toEqual([1, 2, 3]);
    expect(setupCount).toBe(3);
  });

  it("extend runs teardown after each run", async () => {
    const events: string[] = [];

    const withTeardown = trial.extend<{ id: number }>(async (use) => {
      events.push("setup");
      await use({ id: 1 });
      events.push("teardown");
    });

    await withTeardown({ samples: 2 }).each("with teardown", async () => {
      events.push("test");
    });

    expect(events).toEqual([
      "setup",
      "test",
      "teardown",
      "setup",
      "test",
      "teardown",
    ]);
  });

  it("concurrent respects concurrency limit", async () => {
    const sleep = (ms: number) =>
      new Promise((resolve) => setTimeout(resolve, ms));

    let active = 0;
    let maxActive = 0;

    await trial({ samples: 10 }).concurrent.each(
      "limited",
      async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await sleep(1);
        active--;
      },
      { concurrency: 3 },
    );

    expect(maxActive).toBe(3);
  });
});

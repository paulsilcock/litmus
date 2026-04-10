import { trial } from "@litmus/test";
import { describe, expect, it } from "vite-plus/test";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

describe("trial runner", () => {
  it("executes runs sequentially", async () => {
    let active = 0;
    let maxActive = 0;

    await trial({ samples: 5 }).each("sequential", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(1);
      active--;
    });

    expect(maxActive).toBe(1);
  });

  it("executes runs concurrently", async () => {
    let active = 0;
    let maxActive = 0;

    await trial({ samples: 5 }).concurrent.each("concurrent", async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(1);
      active--;
    });

    expect(maxActive).toEqual(5);
  });
});

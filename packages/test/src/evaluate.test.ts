import { spawn } from "node:child_process";
import { join } from "node:path";

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  it,
  test,
} from "vite-plus/test";

import { evaluate } from "#litmus-test/evaluate.ts";

describe("each requested repeat runs the body once", () => {
  let runs = 0;

  evaluate({ samples: 3 }).each("body counts invocations", async () => {
    runs++;
  });

  test("body invoked exactly N times", () => {
    expect(runs).toBe(3);
  });
});

describe("tolerates failures up to a configured threshold", () => {
  let calls = 0;

  evaluate({ samples: 5, passRate: 0.6 }).each(
    "two fail, three pass",
    async () => {
      calls++;
      if (calls <= 2) throw new Error("fail");
    },
  );

  test("body invoked once per repeat even when some fail", () => {
    expect(calls).toBe(5);
  });
});

describe("runs the body against each scenario in turn", () => {
  const seen: string[] = [];
  const scenarios = [
    { name: "alice", role: "admin" },
    { name: "bob", role: "user" },
  ];

  evaluate({ scenarios }).each("checks $name", async (scenario) => {
    seen.push(scenario.name);
  });

  test("each scenario is observed by the body", () => {
    expect(seen).toEqual(["alice", "bob"]);
  });
});

describe("a failing scenario is identified by its caller-defined label", () => {
  const scenarios = [
    { name: "alice", role: "admin" },
    { name: "bob", role: "user" },
  ];
  const warnings: string[] = [];
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
  });
  afterAll(() => {
    console.warn = originalWarn;
  });

  evaluate({ scenarios, passRate: 0.5 }).each(
    ({ name, role }) => `${name} (${role})`,
    async (scenario) => {
      if (scenario.name === "bob") throw new Error("denied");
    },
  );

  test("the failure warning carries the caller's dynamic label", () => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("bob (user)");
    expect(warnings[0]).toContain("denied");
  });
});

describe("every repeat sees a freshly built environment", () => {
  const ids: number[] = [];
  let setupCount = 0;

  const withFixtures = evaluate.extend<{ id: number }>(async (use) => {
    setupCount++;
    await use({ id: setupCount });
  });

  withFixtures({ samples: 3 }).each("captures id", async ({ id }) => {
    ids.push(id);
  });

  test("setup ran once per repeat with a unique id", () => {
    expect(ids).toEqual([1, 2, 3]);
    expect(setupCount).toBe(3);
  });
});

describe("the previous environment is torn down before the next starts", () => {
  const events: string[] = [];

  const withTeardown = evaluate.extend<{ id: number }>(async (use) => {
    events.push("setup");
    await use({ id: 1 });
    events.push("teardown");
  });

  withTeardown({ samples: 2 }).each("records lifecycle", async () => {
    events.push("test");
  });

  test("setup → test → teardown order holds across repeats", () => {
    expect(events).toEqual([
      "setup",
      "test",
      "teardown",
      "setup",
      "test",
      "teardown",
    ]);
  });
});

describe("parallel runs respect the configured limit", () => {
  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));
  const scenarios = [
    { name: "a" },
    { name: "b" },
    { name: "c" },
    { name: "d" },
    { name: "e" },
    { name: "f" },
  ];
  let active = 0;
  let maxActive = 0;

  const withFixtures = evaluate.extend<{ id: number }>(async (use) => {
    await use({ id: 1 });
  });

  withFixtures({ scenarios }).concurrent.each(
    "tracks max parallelism",
    async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await sleep(2);
      active--;
    },
    { concurrency: 3 },
  );

  test("never exceeds the configured concurrency", () => {
    expect(maxActive).toBe(3);
  });
});

describe("a failing repeat is reported even when the run as a whole passes", () => {
  const warnings: string[] = [];
  let originalWarn: typeof console.warn;

  beforeAll(() => {
    originalWarn = console.warn;
    console.warn = (...args: unknown[]) => warnings.push(String(args[0]));
  });
  afterAll(() => {
    console.warn = originalWarn;
  });

  let run = 0;
  evaluate({ samples: 3, passRate: 0.5 }).each(
    "middle repeat fails",
    async () => {
      run++;
      if (run === 2) throw new Error("boom");
    },
  );

  test("the failing repeat produces a warning identifying it", () => {
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("sample 2");
    expect(warnings[0]).toContain("boom");
  });
});

describe("a run that fails the threshold is reported as a failed test", () => {
  let report: JsonReport;

  beforeAll(async () => {
    report = await runVitestOnFixture();
  }, 30_000);

  it("breaching the pass-rate threshold fails the registered test", () => {
    const result = report.testResults[0]!.assertionResults.find((r) =>
      r.fullName.startsWith("breaches pass rate"),
    );
    expect(result?.status).toBe("failed");
    expect(result?.failureMessages.join("\n")).toMatch(
      /Evaluate failed: 2\/5 passed/,
    );
  });

  it("a body that exceeds the timeout fails the registered test", () => {
    const result = report.testResults[0]!.assertionResults.find((r) =>
      r.fullName.startsWith("exceeds timeout"),
    );
    expect(result?.status).toBe("failed");
    expect(result?.failureMessages.join("\n")).toMatch(
      /Evaluate failed: 0\/1 passed/,
    );
  });
});

interface AssertionResult {
  fullName: string;
  status: "passed" | "failed" | "skipped";
  failureMessages: string[];
}

interface JsonReport {
  numFailedTests: number;
  testResults: { assertionResults: AssertionResult[] }[];
}

function runVitestOnFixture(): Promise<JsonReport> {
  const fixturesDir = join(import.meta.dirname, "fixtures");
  return new Promise((resolve, reject) => {
    const child = spawn(
      "vp",
      [
        "test",
        "-c",
        join(fixturesDir, "vite.config.ts"),
        join(fixturesDir, "evaluate-failures.test.ts"),
        "--reporter=json",
      ],
      { stdio: ["ignore", "pipe", "pipe"] },
    );

    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", () => {
      const jsonStart = stdout.indexOf("{");
      try {
        const parsed: JsonReport = JSON.parse(stdout.slice(jsonStart));
        resolve(parsed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        reject(
          new Error(`Could not parse vitest JSON report:\n${stdout}\n${msg}`),
        );
      }
    });
  });
}

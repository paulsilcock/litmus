import { spawn } from "node:child_process";
import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vite-plus/test";

describe("samples mode", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("samples.test.ts");
  }, 30_000);

  it("the test body runs once per requested sample", () => {
    expect(run.logLines.filter((l) => l === "inv")).toHaveLength(3);
  });

  it("sample failures are tolerated up to the configured threshold", () => {
    const calls = run.logLines.filter((l) => l.startsWith("tolerance-call:"));
    expect(calls).toHaveLength(5);
    const test = run.report.testResults[0]!.assertionResults.find((r) =>
      r.fullName.startsWith("first two samples fail"),
    );
    expect(test?.status).toBe("passed");
  });

  it("parallel execution never exceeds the configured limit", () => {
    const peaks = run.logLines
      .filter((l) => l.startsWith("active:"))
      .map((l) => Number(l.slice("active:".length)));
    expect(Math.max(...peaks)).toBe(3);
  });
});

describe("scenarios mode", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("scenarios.test.ts");
  }, 30_000);

  it("the test body runs once for each scenario in the array", () => {
    const order = run.logLines.filter((l) => l.startsWith("iter:"));
    expect(order).toEqual(["iter:alice", "iter:bob"]);
  });

  it("a passing scenario surfaces as a passed test, named via labelBy", () => {
    const passed = run.report.testResults[0]!.assertionResults.find(
      (r) => r.fullName === "declines refund c1 for $50",
    );
    expect(passed?.status).toBe("passed");
  });

  it("a failing scenario surfaces as a failed test, named via labelBy", () => {
    const failed = run.report.testResults[0]!.assertionResults.find(
      (r) => r.fullName === "declines refund c2 for $120",
    );
    expect(failed?.status).toBe("failed");
  });
});

describe("scenarios synthesize mode", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("scenarios-synthesize.test.ts");
  }, 30_000);

  it("the test body runs once for each synthesised scenario", () => {
    const order = run.logLines.filter((l) => l.startsWith("iter:"));
    expect(order).toEqual(["iter:seed", "iter:alice", "iter:bob"]);
  });
});

describe("fixtures lifecycle", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("extend-lifecycle.test.ts");
  }, 30_000);

  it("each sample sees a freshly built fixtures bag", () => {
    const ids = run.logLines
      .filter((l) => l.startsWith("id:"))
      .map((l) => Number(l.slice("id:".length)));
    expect(ids).toEqual([1, 2, 3]);
  });

  it("setup → test → teardown completes in order, once per sample", () => {
    const lifecycle = run.logLines.filter((l) =>
      ["setup", "test", "teardown"].includes(l),
    );
    expect(lifecycle).toEqual([
      "setup",
      "test",
      "teardown",
      "setup",
      "test",
      "teardown",
    ]);
  });
});

describe("modifiers", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("modifiers.test.ts");
  }, 30_000);

  function statusOf(name: string): string | undefined {
    return run.report.testResults[0]!.assertionResults.find(
      (r) => r.fullName === name,
    )?.status;
  }

  it("an explicitly skipped eval is reported as skipped and never runs the body", () => {
    expect(statusOf("skip-direct")).toBe("skipped");
    expect(run.logLines).not.toContain("skip-direct");
  });

  it("skipIf with a truthy condition skips; with a falsy condition runs", () => {
    expect(statusOf("skipif-true")).toBe("skipped");
    expect(statusOf("skipif-false")).toBe("passed");
    expect(run.logLines).not.toContain("skipif-true");
    expect(run.logLines).toContain("skipif-false");
  });

  it("runIf inverts the gate compared to skipIf", () => {
    expect(statusOf("runif-true")).toBe("passed");
    expect(statusOf("runif-false")).toBe("skipped");
    expect(run.logLines).toContain("runif-true");
    expect(run.logLines).not.toContain("runif-false");
  });

  it("a todo eval surfaces as a `todo` entry in the report", () => {
    expect(statusOf("not yet written")).toBe("todo");
  });

  it("a skip modifier composes with scenarios — every scenario is skipped", () => {
    const scenarioStatuses = run.report.testResults[0]!.assertionResults.filter(
      (r) => r.fullName.startsWith("skip composes with scenarios"),
    ).map((r) => r.status);
    expect(scenarioStatuses).toEqual(["skipped", "skipped"]);
    expect(run.logLines).not.toContain("composed-skip-scenarios");
  });
});

describe("only mode", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("only.test.ts");
  }, 30_000);

  it("focusing one eval skips siblings without the focus marker", () => {
    expect(run.logLines).toEqual(["focused"]);
    expect(run.logLines).not.toContain("not-focused");
  });
});

describe("failure modes", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("evaluate-failures.test.ts");
  }, 30_000);

  it("a body that breaches the pass-rate threshold fails the registered test", () => {
    const result = run.report.testResults[0]!.assertionResults.find((r) =>
      r.fullName.startsWith("breaches pass rate"),
    );
    expect(result?.status).toBe("failed");
    expect(result?.failureMessages.join("\n")).toMatch(
      /Evaluate failed: 2\/5 passed/,
    );
  });

  it("a body that exceeds the timeout fails the registered test", () => {
    const result = run.report.testResults[0]!.assertionResults.find((r) =>
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

interface FixtureRun {
  report: JsonReport;
  logLines: string[];
}

async function runFixture(fixtureFile: string): Promise<FixtureRun> {
  const fixturesDir = join(import.meta.dirname, "fixtures");
  const logPath = join(
    tmpdir(),
    `litmus-evaluate-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );

  try {
    const report = await spawnVitest(fixturesDir, fixtureFile, logPath);
    let logLines: string[] = [];
    try {
      logLines = readFileSync(logPath, "utf8").split("\n").filter(Boolean);
    } catch {
      // fixture didn't write any log entries
    }
    return { report, logLines };
  } finally {
    try {
      rmSync(logPath, { force: true });
    } catch {
      // best effort
    }
  }
}

function spawnVitest(
  fixturesDir: string,
  fixtureFile: string,
  logPath: string,
): Promise<JsonReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "vp",
      [
        "test",
        "-c",
        join(fixturesDir, "vite.config.ts"),
        join(fixturesDir, fixtureFile),
        "--reporter=json",
        // Subprocess is a fixture for testing `.only`, not the real CI
        // invocation. Override vitest's `allowOnly: !isCI()` default so
        // the focus marker isn't suppressed under any CI provider.
        "--allowOnly",
      ],
      {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, LITMUS_TEST_LOG: logPath },
      },
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

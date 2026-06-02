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

  it("every sample runs even when earlier samples fail", () => {
    const calls = run.logLines.filter((l) => l.startsWith("tolerance-call:"));
    expect(calls).toHaveLength(5);
  });

  it("an eval passes when failures stay within the pass-rate threshold", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("first two samples fail"),
    );
    expect(result.status).toBe("passed");
  });

  it("the concurrent option runs samples in parallel, not one after another", () => {
    // The fixture blocks every sample until all have started, so the
    // "overlap" line is logged once per sample only if they truly ran
    // at the same time. See samples.test.ts for the latch.
    const overlaps = run.logLines.filter((l) => l === "overlap");
    expect(overlaps).toHaveLength(3);
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
    const passed = assertionFor(run, (n) => n === "declines refund c1 for $50");
    expect(passed.status).toBe("passed");
  });

  it("a failing scenario surfaces as a failed test, named via labelBy", () => {
    const failed = assertionFor(
      run,
      (n) => n === "declines refund c2 for $120",
    );
    expect(failed.status).toBe("failed");
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

  it("synthesised scenarios are positionally named in the report", () => {
    const scenarioTests = run.report.testResults[0]!.assertionResults.filter(
      (r) => r.fullName.startsWith("agent handles generated user"),
    ).map((r) => r.fullName);
    expect(scenarioTests).toHaveLength(3);
    for (const name of scenarioTests) {
      expect(name).toMatch(/^agent handles generated user scenario \d+$/);
    }
  });

  it("synthesis happens once per eval, not once per test", () => {
    const calls = run.logLines.filter((l) => l === "model-called");
    expect(calls).toHaveLength(1);
  });
});

describe("scenarios synthesize strict cache hit", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("scenarios-synthesize-cached.test.ts");
  }, 30_000);

  it("each scenario's test name reflects its data", () => {
    const tests = run.report.testResults[0]!.assertionResults.filter((r) =>
      r.fullName.startsWith("decline refunds"),
    ).map((r) => r.fullName);
    expect(tests).toContain("decline refunds c1 for $50");
    expect(tests).toContain("decline refunds c2 for $75");
    expect(tests).toContain("decline refunds c3 for $125");
  });
});

describe("scenarios synthesize stale cache", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("scenarios-synthesize-stale.test.ts");
  }, 30_000);

  it("a stale cache surfaces as a single failed test, not one per scenario", () => {
    const fullNames = run.report.testResults[0]!.assertionResults.map(
      (r) => r.fullName,
    );
    expect(fullNames).toContain("stale eval");
    expect(fullNames.filter((n) => n.startsWith("stale eval "))).toHaveLength(
      0,
    );
  });

  it("the stale-cache failure points users at the regenerate command", () => {
    const stale = assertionFor(run, (n) => n === "stale eval");
    expect(stale.status).toBe("failed");
    expect(stale.failureMessages.join("\n")).toMatch(
      /LITMUS_SYNTH_MODE=regenerate/,
    );
  });

  it("the test body is not invoked when the cache is stale", () => {
    expect(run.logLines).not.toContain("should-not-run:stale-content");
  });

  it("an unrelated test in the same file still runs", () => {
    const unrelated = assertionFor(
      run,
      (n) => n === "unrelated test runs fine",
    );
    expect(unrelated.status).toBe("passed");
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

  function statusOf(name: string): string {
    return assertionFor(run, (n) => n === name).status;
  }

  it("an explicitly skipped eval is reported as skipped and never runs the body", () => {
    expect(statusOf("skip-direct")).toBe("skipped");
    expect(run.logLines).not.toContain("skip-direct");
  });

  it("skipIf with a truthy condition skips the eval", () => {
    expect(statusOf("skipif-true")).toBe("skipped");
    expect(run.logLines).not.toContain("skipif-true");
  });

  it("skipIf with a falsy condition runs the eval", () => {
    expect(statusOf("skipif-false")).toBe("passed");
    expect(run.logLines).toContain("skipif-false");
  });

  it("runIf with a truthy condition runs the eval", () => {
    expect(statusOf("runif-true")).toBe("passed");
    expect(run.logLines).toContain("runif-true");
  });

  it("runIf with a falsy condition skips the eval", () => {
    expect(statusOf("runif-false")).toBe("skipped");
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

describe("guardrails", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("guardrails.test.ts");
  }, 30_000);

  it("a passing grader is invoked with the body's return value", () => {
    expect(run.logLines).toContain("single:hello");
  });

  it("a passing grader leaves the scenario passing", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("passing grader records each input"),
    );
    expect(result.status).toBe("passed");
  });

  it(".withGuardrails with no registered graders still injects the fixture", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("eval registered with .withGuardrails({})"),
    );
    expect(result.status).toBe("passed");
  });

  it("scenarios-form invokes the grader once per (scenario, sample) with that run's body output", () => {
    const recorded = run.logLines.filter((l) => l.startsWith("scenario:"));
    expect(recorded).toHaveLength(4);
    expect(recorded.filter((l) => l === "scenario:hello alice")).toHaveLength(
      2,
    );
    expect(recorded.filter((l) => l === "scenario:hello bob")).toHaveLength(2);
  });
});

describe("guardrails: failure", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("guardrails-failure.test.ts");
  }, 30_000);

  it("a rejecting grader fails the scenario", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("grader rejects with 'violates content policy'"),
    );
    expect(result.status).toBe("failed");
  });

  it("the failure message names the grader and includes its reason", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("grader rejects with 'violates content policy'"),
    );
    const message = result.failureMessages.join("\n");
    expect(message).toContain("policy check");
    expect(message).toContain("violates content policy");
  });

  it("every failing grader's reason surfaces in one message", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("two graders reject with distinct"),
    );
    const message = result.failureMessages.join("\n");
    expect(message).toContain("tone check");
    expect(message).toContain("tone too curt");
    expect(message).toContain("policy check");
    expect(message).toContain("violates content policy");
  });

  it("chained .withGuardrails calls accumulate — downstream sees every registration", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("first grader registered, then second appended"),
    );
    const message = result.failureMessages.join("\n");
    expect(message).toContain("tone check");
    expect(message).toContain("policy check");
  });

  it("forgetting to invoke the guardrails fixture fails the sample", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("guardrails registered but body never calls them"),
    );
    expect(result.status).toBe("failed");
    const message = result.failureMessages.join("\n");
    expect(message).toContain("policy check");
    expect(message).toContain("never invoked");
  });
});

describe("guardrails: modifier composition", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("guardrails-modifier.test.ts");
  }, 30_000);

  it("modifiers preserve registered guardrails through composition", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("rejecting grader registered, then .only applied"),
    );
    expect(result.status).toBe("failed");
    expect(result.failureMessages.join("\n")).toContain("policy check");
  });
});

describe("guardrails with synthesized scenarios", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("scenarios-synthesize-extended.test.ts");
  }, 30_000);

  it("the body runs once for each synthesised scenario", () => {
    const iters = run.logLines.filter((l) => l.startsWith("iter:"));
    expect(iters).toHaveLength(3); // 1 seed + 2 variants
  });

  it("fixtures and guardrails are both injected into the body", () => {
    expect(run.logLines).toContain("iter:alice:ready");
  });

  it("the grader is invoked once per synthesised scenario", () => {
    const graderCalls = run.logLines.filter((l) => l.startsWith("grader:"));
    expect(graderCalls).toHaveLength(3);
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

describe("chain modifiers", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("chain-modifiers.test.ts");
  }, 30_000);

  it(".samples(n) runs the body n times", () => {
    const samples = run.logLines.filter((l) => l === "chain-sample");
    expect(samples).toHaveLength(3);
  });

  it(".samples(n).passRate(r) tolerates failures up to the configured threshold", () => {
    const calls = run.logLines.filter((l) =>
      l.startsWith("chain-passrate-call:"),
    );
    expect(calls).toHaveLength(5);
    const result = assertionFor(run, (n) =>
      n.startsWith("chain-passrate tolerates threshold failures"),
    );
    expect(result.status).toBe("passed");
  });

  it(".timeout(ms) fails an eval whose body exceeds the limit", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("chain-timeout fails a body that exceeds the limit"),
    );
    expect(result.status).toBe("failed");
    expect(result.failureMessages.join("\n")).toMatch(/timed out after 50ms/);
  });

  it("a chain modifier value overrides the same option passed at the call site", () => {
    const calls = run.logLines.filter((l) => l.startsWith("chain-precedence:"));
    expect(calls).toHaveLength(5);
  });

  it(".concurrent runs samples in parallel, not one after another", () => {
    // Same deterministic latch as the samples-mode parallelism test:
    // all three "chain-overlap" lines appear only if .concurrent ran
    // the samples at the same time.
    const overlaps = run.logLines.filter((l) => l === "chain-overlap");
    expect(overlaps).toHaveLength(3);
  });

  it(".samples(n).scenarios(cases) runs n samples per scenario", () => {
    const alice = run.logLines.filter((l) => l === "chain-scenario:alice");
    const bob = run.logLines.filter((l) => l === "chain-scenario:bob");
    expect(alice).toHaveLength(2);
    expect(bob).toHaveLength(2);
  });

  it(".skip composed with a chain modifier skips the eval", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("chain-skip does not run body"),
    );
    expect(result.status).toBe("skipped");
    expect(run.logLines).not.toContain("chain-skip-ran");
  });

  it(".skipIf(false) with a chain modifier runs the eval", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("chain-skipif-false runs"),
    );
    expect(result.status).toBe("passed");
    expect(run.logLines).toContain("chain-skipif-false");
  });
});

describe("vitest maxConcurrency setting", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture(
      "max-concurrency.test.ts",
      "vite.config.max-concurrency.ts",
    );
  }, 30_000);

  it("the configured pool size limits how many samples run simultaneously", () => {
    const result = assertionFor(run, (n) =>
      n.startsWith("pool-constrained deadlock"),
    );
    expect(result.status).toBe("failed");
    expect(result.failureMessages.join("\n")).toMatch(/timed out after 300ms/);
  });
});

describe("failure modes", () => {
  let run: FixtureRun;

  beforeAll(async () => {
    run = await runFixture("evaluate-failures.test.ts");
  }, 30_000);

  it("a body that breaches the pass-rate threshold fails the registered test", () => {
    const result = assertionFor(run, (n) => n.startsWith("breaches pass rate"));
    expect(result.status).toBe("failed");
    expect(result.failureMessages.join("\n")).toMatch(
      /Evaluate failed: 2\/5 passed/,
    );
  });

  it("a body that exceeds the timeout fails the registered test", () => {
    const result = assertionFor(run, (n) => n.startsWith("exceeds timeout"));
    expect(result.status).toBe("failed");
    expect(result.failureMessages.join("\n")).toMatch(/timed out after 10ms/);
  });

  it("a single-sample failure surfaces the original error directly, not a wrapper", () => {
    const result = assertionFor(run, (n) => n.startsWith("exceeds timeout"));
    const msg = result.failureMessages.join("\n");
    expect(msg).not.toMatch(/Evaluate failed:/);
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

/**
 * Find the reported sub-test whose name matches, throwing with the full
 * list of reported names if none does. Returning a non-optional result
 * means a fixture rename surfaces as "no test matched — reported: …"
 * rather than a misleading `expected undefined to be 'passed'`.
 */
function assertionFor(
  run: FixtureRun,
  matcher: (fullName: string) => boolean,
): AssertionResult {
  const results = run.report.testResults[0]!.assertionResults;
  const found = results.find((r) => matcher(r.fullName));
  if (!found) {
    throw new Error(
      `No reported test matched. Reported tests: ${results
        .map((r) => r.fullName)
        .join(", ")}`,
    );
  }
  return found;
}

async function runFixture(
  fixtureFile: string,
  configFile = "vite.config.ts",
): Promise<FixtureRun> {
  const fixturesDir = join(import.meta.dirname, "fixtures");
  const logPath = join(
    tmpdir(),
    `litmus-evaluate-test-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}.log`,
  );

  try {
    const report = await spawnVitest(
      fixturesDir,
      fixtureFile,
      logPath,
      configFile,
    );
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
  configFile = "vite.config.ts",
): Promise<JsonReport> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      "vp",
      [
        "test",
        "-c",
        join(fixturesDir, configFile),
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

import { describe, test } from "vite-plus/test";

import { runConcurrent, runSequential, type RunTask } from "./runner.ts";

/**
 * Adapter between our evaluation model and vitest's test/describe
 * primitives. Owns the mapping `mode → vitest function` and the
 * lifecycle of registering a single eval as a vitest test.
 */

export type RunMode = "run" | "skip" | "only";

export interface RegisterArgs {
  label: string;
  tasks: RunTask[];
  passRate: number;
  timeout?: number;
  concurrent: boolean;
  mode?: RunMode;
  /**
   * Optional setup that runs before the tasks. Errors propagate
   * directly to vitest as the test failure, bypassing the per-task
   * pass-rate gate — use for failures the user must see verbatim
   * (e.g. stale-cache instructions).
   */
  setup?: () => Promise<void>;
}

const DEFAULT_CONCURRENCY = 5;

declare global {
  // oxlint-disable-next-line no-var
  var __vitest_worker__: { config: { maxConcurrency: number } } | undefined;
}

/**
 * Returns the pool size for concurrent sample execution. Reads
 * `maxConcurrency` from the vitest worker config so callers can tune
 * parallelism project-wide via their `vitest.config.ts` without
 * touching individual evals. Falls back to `DEFAULT_CONCURRENCY` when
 * running outside a vitest worker (e.g. unit tests of this module).
 */
function configuredConcurrency(): number {
  return (
    globalThis.__vitest_worker__?.config?.maxConcurrency ?? DEFAULT_CONCURRENCY
  );
}

type TestFn = (
  name: string,
  body: () => Promise<void>,
  timeout?: number,
) => void;

/** Pick the vitest test variant matching the requested mode. */
export function testFor(mode: RunMode): TestFn {
  if (mode === "skip") return test.skip;
  if (mode === "only") return test.only;
  return test;
}

/** Pick the vitest describe variant matching the requested mode. */
export function describeFor(
  mode: RunMode,
): (name: string, body: () => void) => void {
  if (mode === "skip") return describe.skip;
  if (mode === "only") return describe.only;
  return describe;
}

/**
 * Register an evaluation as a single vitest test that runs the supplied
 * tasks and asserts the configured pass rate.
 */
export function register({
  label,
  tasks,
  passRate,
  timeout,
  concurrent,
  mode = "run",
  setup,
}: RegisterArgs): void {
  const concurrency = configuredConcurrency();
  testFor(mode)(
    label,
    async () => {
      if (setup) await setup();
      if (concurrent) {
        await runConcurrent(tasks, passRate, concurrency, timeout);
      } else {
        await runSequential(tasks, passRate, timeout);
      }
    },
    totalTimeout(timeout, tasks.length, concurrent, concurrency),
  );
}

/**
 * Vitest needs a per-test timeout that covers every sample plus
 * room for setup/teardown overhead. We multiply the user's per-run
 * timeout by the number of runs (or, when concurrent, by the number
 * of batches), then add a fixed slack so vitest doesn't time out the
 * test before our own per-run timeouts surface a clear error.
 */
function totalTimeout(
  perRun: number | undefined,
  runs: number,
  concurrent: boolean,
  concurrency: number,
): number | undefined {
  if (perRun === undefined) return undefined;
  // Slack to absorb fixture setup/teardown so the user-facing timeout
  // surfaces as the failure cause rather than vitest's own cap.
  const SLACK_MS = 10_000;
  return concurrent
    ? perRun * Math.ceil(runs / concurrency) + SLACK_MS
    : perRun * runs + SLACK_MS;
}

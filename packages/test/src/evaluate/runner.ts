/**
 * Sequential and concurrent run strategies for a list of tasks, plus
 * the per-task timeout wrapper, pass-rate gate, and failure logging.
 *
 * The vitest-aware wrapping (test/describe registration, mode handling)
 * lives in `register.ts` — this file is purely the execution engine.
 */

export interface RunTask {
  label: string;
  run: () => Promise<void>;
}

export async function runSequential(
  tasks: RunTask[],
  passRate: number,
  timeout?: number,
): Promise<void> {
  const failures: Error[] = [];
  for (const task of tasks) {
    const failure = await runTask(task, timeout);
    if (failure !== null) failures.push(failure);
  }
  assertPassRate(
    tasks.length - failures.length,
    tasks.length,
    passRate,
    failures,
  );
}

export async function runConcurrent(
  tasks: RunTask[],
  passRate: number,
  concurrency: number,
  timeout?: number,
): Promise<void> {
  const failures: Error[] = [];
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const task = tasks[index++]!;
      const failure = await runTask(task, timeout);
      if (failure !== null) failures.push(failure);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  assertPassRate(
    tasks.length - failures.length,
    tasks.length,
    passRate,
    failures,
  );
}

async function runTask(task: RunTask, timeout?: number): Promise<Error | null> {
  try {
    const p = task.run();
    await (timeout ? withTimeout(p, timeout, task.label) : p);
    return null;
  } catch (e) {
    const err = e instanceof Error ? e : new Error(String(e));
    console.warn(`Evaluate warning: ${task.label} failed — ${err.message}`);
    return err;
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(
        () => reject(new Error(`${label} timed out after ${ms}ms`)),
        ms,
      ),
    ),
  ]);
}

function assertPassRate(
  passed: number,
  total: number,
  required: number,
  failures: Error[],
): void {
  const actual = passed / total;
  if (actual < required) {
    // When only one failure caused the eval to fail, re-throw it directly so
    // the user sees the exact error (with its original stack trace) rather than
    // a wrapped aggregation — this is the common samples=1 case.
    if (failures.length === 1) {
      throw failures[0];
    }

    // Multiple failures: build an aggregated message that includes every
    // failure's stack trace so nothing is lost.
    const reasons =
      failures.length > 0
        ? "\n" + failures.map((f) => `  - ${f.stack ?? f.message}`).join("\n")
        : "";
    throw new Error(
      `Evaluate failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%${reasons}`,
    );
  }
}

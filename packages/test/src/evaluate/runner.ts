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
  let passed = 0;
  for (const task of tasks) {
    if (await runTask(task, timeout)) passed++;
  }
  assertPassRate(passed, tasks.length, passRate);
}

export async function runConcurrent(
  tasks: RunTask[],
  passRate: number,
  concurrency: number,
  timeout?: number,
): Promise<void> {
  let passed = 0;
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const task = tasks[index++]!;
      if (await runTask(task, timeout)) passed++;
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  assertPassRate(passed, tasks.length, passRate);
}

async function runTask(task: RunTask, timeout?: number): Promise<boolean> {
  try {
    const p = task.run();
    await (timeout ? withTimeout(p, timeout, task.label) : p);
    return true;
  } catch (e) {
    warnFailure(task.label, e);
    return false;
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

function warnFailure(label: string, e: unknown): void {
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`Evaluate warning: ${label} failed — ${message}`);
}

function assertPassRate(passed: number, total: number, required: number): void {
  const actual = passed / total;
  if (actual < required) {
    throw new Error(
      `Evaluate failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%`,
    );
  }
}

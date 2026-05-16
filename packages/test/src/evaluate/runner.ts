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
  const failures: string[] = [];
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
  const failures: string[] = [];
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

async function runTask(
  task: RunTask,
  timeout?: number,
): Promise<string | null> {
  try {
    const p = task.run();
    await (timeout ? withTimeout(p, timeout, task.label) : p);
    return null;
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn(`Evaluate warning: ${task.label} failed — ${message}`);
    return message;
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
  failures: string[],
): void {
  const actual = passed / total;
  if (actual < required) {
    const reasons =
      failures.length > 0
        ? "\n" + failures.map((f) => `  - ${f}`).join("\n")
        : "";
    throw new Error(
      `Evaluate failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%${reasons}`,
    );
  }
}

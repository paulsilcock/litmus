import { test } from "vite-plus/test";

interface SamplesOptions {
  samples: number;
  passRate?: number;
}

interface FixturesOptions<T> {
  fixtures: T[];
  passRate?: number;
}

interface EachOptions {
  concurrency?: number;
  timeout?: number;
}

interface SamplesRunner {
  each(name: string, fn: () => Promise<void>, options?: EachOptions): void;
  concurrent: {
    each(name: string, fn: () => Promise<void>, options?: EachOptions): void;
  };
}

interface FixturesRunner<T> {
  each(
    name: string | ((fixture: T) => string),
    fn: (fixture: T) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string | ((fixture: T) => string),
      fn: (fixture: T) => Promise<void>,
      options?: EachOptions,
    ): void;
  };
}

function fixtureLabel(fixture: unknown): string {
  if (typeof fixture === "object" && fixture !== null) {
    if ("name" in fixture && typeof fixture.name === "string")
      return fixture.name;
    if ("id" in fixture && typeof fixture.id === "string") return fixture.id;
  }
  return "fixture";
}

function resolveLabel<T>(
  name: string | ((fixture: T) => string),
  fixture: T,
): string {
  return typeof name === "function" ? name(fixture) : fixtureLabel(fixture);
}

function warnFailure(label: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`Trial warning: ${label} failed — ${message}`);
}

function assertPassRate(passed: number, total: number, required: number) {
  const actual = passed / total;
  if (actual < required) {
    throw new Error(
      `Trial failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%`,
    );
  }
}

interface RunTask {
  label: string;
  run: () => Promise<void>;
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

async function runSequential(
  tasks: RunTask[],
  passRate: number,
  timeout?: number,
) {
  let passed = 0;
  for (const task of tasks) {
    try {
      const p = task.run();
      await (timeout ? withTimeout(p, timeout, task.label) : p);
      passed++;
    } catch (e) {
      warnFailure(task.label, e);
    }
  }
  assertPassRate(passed, tasks.length, passRate);
}

async function runConcurrent(
  tasks: RunTask[],
  passRate: number,
  concurrency: number,
  timeout?: number,
) {
  let passed = 0;
  let index = 0;

  async function worker() {
    while (index < tasks.length) {
      const task = tasks[index++]!;
      try {
        const p = task.run();
        await (timeout ? withTimeout(p, timeout, task.label) : p);
        passed++;
      } catch (e) {
        warnFailure(task.label, e);
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()),
  );
  assertPassRate(passed, tasks.length, passRate);
}

type SetupFn<TContext> = (
  use: (ctx: TContext) => Promise<void>,
) => Promise<void>;

interface ContextSamplesRunner<TContext> {
  each(
    name: string,
    fn: (ctx: TContext) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string,
      fn: (ctx: TContext) => Promise<void>,
      options?: EachOptions,
    ): void;
  };
}

interface ContextFixturesRunner<TFixture, TContext> {
  each(
    name: string | ((fixture: TFixture) => string),
    fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string | ((fixture: TFixture) => string),
      fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
      options?: EachOptions,
    ): void;
  };
}

function totalTimeout(
  perRun: number | undefined,
  runs: number,
  concurrent: boolean,
  concurrency: number,
): number | undefined {
  if (perRun === undefined) return undefined;
  const slack = 10_000;
  return concurrent
    ? perRun * Math.ceil(runs / concurrency) + slack
    : perRun * runs + slack;
}

/**
 * Creates a trial runner with per-run setup and teardown.
 * Each run gets a fresh context — essential for concurrent execution
 * where shared state would cause interference.
 *
 * @param setup - Async function that creates context, passes it to
 *   `use()`, and runs teardown after `use()` returns.
 *
 * @example
 * ```typescript
 * const withDsl = trial.extend<{ dsl: Dsl }>(async (use) => {
 *   const dsl = new Dsl();
 *   await dsl.setup();
 *   await use({ dsl });
 *   await dsl.cleanup();
 * });
 *
 * withDsl({ fixtures, passRate: 0.8 })
 *   .concurrent.each("screens $name correctly", async (fixture, { dsl }) => {
 *     await dsl.submitApplication(fixture.cv);
 *     await dsl.assertScreeningResult(fixture.expected);
 *   });
 * ```
 */
trial.extend = function extend<TContext>(setup: SetupFn<TContext>) {
  function extended(options: SamplesOptions): ContextSamplesRunner<TContext>;
  function extended<TFixture>(
    options: FixturesOptions<TFixture>,
  ): ContextFixturesRunner<TFixture, TContext>;
  function extended<TFixture>(
    options: SamplesOptions | FixturesOptions<TFixture>,
  ):
    | ContextSamplesRunner<TContext>
    | ContextFixturesRunner<TFixture, TContext> {
    const passRate = options.passRate ?? 1;

    if ("fixtures" in options) {
      const fixtures = options.fixtures;
      return {
        each(
          name: string | ((fixture: TFixture) => string),
          fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: trialLabel(name, fixtures, "fixtures", passRate),
            tasks: () =>
              fixtures.map((fixture) => ({
                label: resolveLabel(name, fixture),
                run: () =>
                  setup(async (ctx: TContext) => {
                    await fn(fixture, ctx);
                  }),
              })),
            passRate,
            eachOptions,
            concurrent: false,
          });
        },
        concurrent: {
          each(
            name: string | ((fixture: TFixture) => string),
            fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
            eachOptions?: EachOptions,
          ) {
            register({
              label: trialLabel(name, fixtures, "fixtures", passRate),
              tasks: () =>
                fixtures.map((fixture) => ({
                  label: resolveLabel(name, fixture),
                  run: () =>
                    setup(async (ctx: TContext) => {
                      await fn(fixture, ctx);
                    }),
                })),
              passRate,
              eachOptions,
              concurrent: true,
            });
          },
        },
      };
    }

    const samples = options.samples;
    return {
      each(
        name: string,
        fn: (ctx: TContext) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        register({
          label: samplesLabel(name, samples, passRate),
          tasks: () =>
            Array.from({ length: samples }, (_, i) => ({
              label: `sample ${i + 1}`,
              run: () =>
                setup(async (ctx: TContext) => {
                  await fn(ctx);
                }),
            })),
          passRate,
          eachOptions,
          concurrent: false,
        });
      },
      concurrent: {
        each(
          name: string,
          fn: (ctx: TContext) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: samplesLabel(name, samples, passRate),
            tasks: () =>
              Array.from({ length: samples }, (_, i) => ({
                label: `sample ${i + 1}`,
                run: () =>
                  setup(async (ctx: TContext) => {
                    await fn(ctx);
                  }),
              })),
            passRate,
            eachOptions,
            concurrent: true,
          });
        },
      },
    };
  }

  return extended;
};

interface RegisterArgs {
  label: string;
  tasks: () => RunTask[];
  passRate: number;
  eachOptions?: EachOptions;
  concurrent: boolean;
}

function register({
  label,
  tasks,
  passRate,
  eachOptions,
  concurrent,
}: RegisterArgs): void {
  const concurrency = eachOptions?.concurrency ?? 5;
  const perRun = eachOptions?.timeout;

  test(
    label,
    async () => {
      const ts = tasks();
      if (concurrent) {
        await runConcurrent(ts, passRate, concurrency, perRun);
      } else {
        await runSequential(ts, passRate, perRun);
      }
    },
    totalTimeout(perRun, taskCount(tasks), concurrent, concurrency),
  );
}

function taskCount(tasks: () => RunTask[]): number {
  return tasks().length;
}

function trialLabel<T>(
  name: string | ((fixture: T) => string),
  fixtures: T[],
  unit: "fixtures" | "samples",
  passRate: number,
): string {
  const base = typeof name === "string" ? name : "trial";
  return `${base} [${fixtures.length} ${unit}, ${(passRate * 100).toFixed(0)}% pass]`;
}

function samplesLabel(name: string, samples: number, passRate: number): string {
  return `${name} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`;
}

/**
 * Probabilistic test runner for non-deterministic behaviour.
 * Top-level equivalent to vitest's `test`/`it` — registers a vitest
 * test that runs N samples or fixtures internally and asserts the
 * overall pass rate.
 *
 * Two modes:
 * - **Samples**: run N times with random/repeated input
 * - **Fixtures**: run once per fixture from an array
 *
 * Supports sequential (default) and concurrent execution via
 * `.concurrent.each()`, with configurable concurrency limits
 * and per-run timeouts.
 *
 * @param options.samples - Number of times to run the test.
 * @param options.fixtures - Array of test cases to iterate.
 * @param options.passRate - Minimum pass ratio (0–1, default 1).
 *
 * @example
 * ```typescript
 * // Top-level — registers a vitest test, no it() wrapper needed
 * trial({ samples: 10, passRate: 0.8 })
 *   .each("classifies intent", async () => {
 *     const result = await classifier.run("I want a refund");
 *     expect(result.intent).toBe("refund");
 *   });
 *
 * trial({ fixtures: candidates, passRate: 0.8 })
 *   .concurrent.each(
 *     ({ name }) => `screens ${name}`,
 *     async (fixture) => { ... },
 *     { concurrency: 5, timeout: 30_000 },
 *   );
 * ```
 */
export function trial(options: SamplesOptions): SamplesRunner;
export function trial<T>(options: FixturesOptions<T>): FixturesRunner<T>;
export function trial<T>(
  options: SamplesOptions | FixturesOptions<T>,
): SamplesRunner | FixturesRunner<T> {
  const passRate = options.passRate ?? 1;

  if ("fixtures" in options) {
    const fixtures = options.fixtures;
    return {
      each(
        name: string | ((fixture: T) => string),
        fn: (fixture: T) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        register({
          label: trialLabel(name, fixtures, "fixtures", passRate),
          tasks: () =>
            fixtures.map((fixture) => ({
              label: resolveLabel(name, fixture),
              run: () => fn(fixture),
            })),
          passRate,
          eachOptions,
          concurrent: false,
        });
      },
      concurrent: {
        each(
          name: string | ((fixture: T) => string),
          fn: (fixture: T) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: trialLabel(name, fixtures, "fixtures", passRate),
            tasks: () =>
              fixtures.map((fixture) => ({
                label: resolveLabel(name, fixture),
                run: () => fn(fixture),
              })),
            passRate,
            eachOptions,
            concurrent: true,
          });
        },
      },
    };
  }

  const samples = options.samples;
  return {
    each(name: string, fn: () => Promise<void>, eachOptions?: EachOptions) {
      register({
        label: samplesLabel(name, samples, passRate),
        tasks: () =>
          Array.from({ length: samples }, (_, i) => ({
            label: `sample ${i + 1}`,
            run: fn,
          })),
        passRate,
        eachOptions,
        concurrent: false,
      });
    },
    concurrent: {
      each(name: string, fn: () => Promise<void>, eachOptions?: EachOptions) {
        register({
          label: samplesLabel(name, samples, passRate),
          tasks: () =>
            Array.from({ length: samples }, (_, i) => ({
              label: `sample ${i + 1}`,
              run: fn,
            })),
          passRate,
          eachOptions,
          concurrent: true,
        });
      },
    },
  };
}

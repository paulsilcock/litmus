import { test } from "vite-plus/test";

interface SamplesOptions {
  samples: number;
  passRate?: number;
}

interface ScenariosOptions<T> {
  scenarios: T[];
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

interface ScenariosRunner<T> {
  each(
    name: string | ((scenario: T) => string),
    fn: (scenario: T) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string | ((scenario: T) => string),
      fn: (scenario: T) => Promise<void>,
      options?: EachOptions,
    ): void;
  };
}

function scenarioLabel(scenario: unknown): string {
  if (typeof scenario === "object" && scenario !== null) {
    if ("name" in scenario && typeof scenario.name === "string")
      return scenario.name;
    if ("id" in scenario && typeof scenario.id === "string") return scenario.id;
  }
  return "scenario";
}

function resolveLabel<T>(
  name: string | ((scenario: T) => string),
  scenario: T,
): string {
  return typeof name === "function" ? name(scenario) : scenarioLabel(scenario);
}

function warnFailure(label: string, e: unknown) {
  const message = e instanceof Error ? e.message : String(e);
  console.warn(`Evaluate warning: ${label} failed — ${message}`);
}

function assertPassRate(passed: number, total: number, required: number) {
  const actual = passed / total;
  if (actual < required) {
    throw new Error(
      `Evaluate failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%`,
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

type SetupFn<TFixtures> = (
  use: (fixtures: TFixtures) => Promise<void>,
) => Promise<void>;

interface FixturesSamplesRunner<TFixtures> {
  each(
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string,
      fn: (fixtures: TFixtures) => Promise<void>,
      options?: EachOptions,
    ): void;
  };
}

interface FixturesScenariosRunner<TScenario, TFixtures> {
  each(
    name: string | ((scenario: TScenario) => string),
    fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
    options?: EachOptions,
  ): void;
  concurrent: {
    each(
      name: string | ((scenario: TScenario) => string),
      fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
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
 * Creates an evaluate runner with per-run setup and teardown that
 * provides a freshly built fixtures object to every repeat. Essential
 * for concurrent execution where shared state would cause interference.
 *
 * @param setup - Async function that builds fixtures, passes them to
 *   `use()`, and runs teardown after `use()` returns.
 *
 * @example
 * ```typescript
 * const withDsl = evaluate.extend<{ dsl: Dsl }>(async (use) => {
 *   const dsl = new Dsl();
 *   await dsl.setup();
 *   await use({ dsl });
 *   await dsl.cleanup();
 * });
 *
 * withDsl({ scenarios, passRate: 0.8 })
 *   .concurrent.each("screens $name correctly", async (scenario, { dsl }) => {
 *     await dsl.submitApplication(scenario.cv);
 *     await dsl.assertScreeningResult(scenario.expected);
 *   });
 * ```
 */
evaluate.extend = function extend<TFixtures>(setup: SetupFn<TFixtures>) {
  function extended(options: SamplesOptions): FixturesSamplesRunner<TFixtures>;
  function extended<TScenario>(
    options: ScenariosOptions<TScenario>,
  ): FixturesScenariosRunner<TScenario, TFixtures>;
  function extended<TScenario>(
    options: SamplesOptions | ScenariosOptions<TScenario>,
  ):
    | FixturesSamplesRunner<TFixtures>
    | FixturesScenariosRunner<TScenario, TFixtures> {
    const passRate = options.passRate ?? 1;

    if ("scenarios" in options) {
      const scenarios = options.scenarios;
      return {
        each(
          name: string | ((scenario: TScenario) => string),
          fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: scenariosTitle(name, scenarios, passRate),
            tasks: () =>
              scenarios.map((scenario) => ({
                label: resolveLabel(name, scenario),
                run: () =>
                  setup(async (fixtures: TFixtures) => {
                    await fn(scenario, fixtures);
                  }),
              })),
            passRate,
            eachOptions,
            concurrent: false,
          });
        },
        concurrent: {
          each(
            name: string | ((scenario: TScenario) => string),
            fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
            eachOptions?: EachOptions,
          ) {
            register({
              label: scenariosTitle(name, scenarios, passRate),
              tasks: () =>
                scenarios.map((scenario) => ({
                  label: resolveLabel(name, scenario),
                  run: () =>
                    setup(async (fixtures: TFixtures) => {
                      await fn(scenario, fixtures);
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
        fn: (fixtures: TFixtures) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        register({
          label: samplesTitle(name, samples, passRate),
          tasks: () =>
            Array.from({ length: samples }, (_, i) => ({
              label: `sample ${i + 1}`,
              run: () =>
                setup(async (fixtures: TFixtures) => {
                  await fn(fixtures);
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
          fn: (fixtures: TFixtures) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: samplesTitle(name, samples, passRate),
            tasks: () =>
              Array.from({ length: samples }, (_, i) => ({
                label: `sample ${i + 1}`,
                run: () =>
                  setup(async (fixtures: TFixtures) => {
                    await fn(fixtures);
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

function scenariosTitle<T>(
  name: string | ((scenario: T) => string),
  scenarios: T[],
  passRate: number,
): string {
  const base = typeof name === "string" ? name : "evaluate";
  return `${base} [${scenarios.length} scenarios, ${(passRate * 100).toFixed(0)}% pass]`;
}

function samplesTitle(name: string, samples: number, passRate: number): string {
  return `${name} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`;
}

/**
 * Probabilistic evaluation runner for non-deterministic behaviour.
 * Top-level equivalent to vitest's `test`/`it` — registers a vitest
 * test that runs N samples or scenarios internally and asserts the
 * overall pass rate.
 *
 * Two modes:
 * - **Samples**: run N times with random/repeated input
 * - **Scenarios**: run once per scenario from an array
 *
 * Supports sequential (default) and concurrent execution via
 * `.concurrent.each()`, with configurable concurrency limits
 * and per-run timeouts.
 *
 * @param options.samples - Number of times to run the body.
 * @param options.scenarios - Array of test cases to iterate.
 * @param options.passRate - Minimum pass ratio (0–1, default 1).
 *
 * @example
 * ```typescript
 * // Top-level — registers a vitest test, no it() wrapper needed
 * evaluate({ samples: 10, passRate: 0.8 })
 *   .each("classifies intent", async () => {
 *     const result = await classifier.run("I want a refund");
 *     expect(result.intent).toBe("refund");
 *   });
 *
 * evaluate({ scenarios: candidates, passRate: 0.8 })
 *   .concurrent.each(
 *     ({ name }) => `screens ${name}`,
 *     async (scenario) => { ... },
 *     { concurrency: 5, timeout: 30_000 },
 *   );
 * ```
 */
export function evaluate(options: SamplesOptions): SamplesRunner;
export function evaluate<T>(options: ScenariosOptions<T>): ScenariosRunner<T>;
export function evaluate<T>(
  options: SamplesOptions | ScenariosOptions<T>,
): SamplesRunner | ScenariosRunner<T> {
  const passRate = options.passRate ?? 1;

  if ("scenarios" in options) {
    const scenarios = options.scenarios;
    return {
      each(
        name: string | ((scenario: T) => string),
        fn: (scenario: T) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        register({
          label: scenariosTitle(name, scenarios, passRate),
          tasks: () =>
            scenarios.map((scenario) => ({
              label: resolveLabel(name, scenario),
              run: () => fn(scenario),
            })),
          passRate,
          eachOptions,
          concurrent: false,
        });
      },
      concurrent: {
        each(
          name: string | ((scenario: T) => string),
          fn: (scenario: T) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          register({
            label: scenariosTitle(name, scenarios, passRate),
            tasks: () =>
              scenarios.map((scenario) => ({
                label: resolveLabel(name, scenario),
                run: () => fn(scenario),
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
        label: samplesTitle(name, samples, passRate),
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
          label: samplesTitle(name, samples, passRate),
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

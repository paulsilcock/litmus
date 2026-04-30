import { describe, test } from "vite-plus/test";

interface EvaluateOptions {
  samples?: number;
  passRate?: number;
  timeout?: number;
  concurrent?: boolean;
  concurrency?: number;
}

interface ScenariosFnOptions<T = unknown> {
  samples?: number;
  passRate?: number;
  timeout?: number;
  concurrent?: boolean;
  concurrency?: number;
  /**
   * Derives the per-scenario test label shown in the vitest report.
   * Useful when scenarios don't have a `name` or `id` field. Defaults
   * to `scenario.name`, then `scenario.id`, then `"scenario"`.
   */
  labelBy?: (scenario: T) => string;
}

type SetupFn<TFixtures> = (
  use: (fixtures: TFixtures) => Promise<void>,
) => Promise<void>;

interface RunTask {
  label: string;
  run: () => Promise<void>;
}

type RunMode = "run" | "skip" | "only";

interface RegisterArgs {
  label: string;
  tasks: () => RunTask[];
  passRate: number;
  timeout?: number;
  concurrent: boolean;
  concurrency?: number;
  mode?: RunMode;
}

function scenarioLabel(scenario: unknown): string {
  if (typeof scenario === "object" && scenario !== null) {
    if ("name" in scenario && typeof scenario.name === "string")
      return scenario.name;
    if ("id" in scenario && typeof scenario.id === "string") return scenario.id;
  }
  return "scenario";
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

function register({
  label,
  tasks,
  passRate,
  timeout,
  concurrent,
  concurrency = 5,
  mode = "run",
}: RegisterArgs): void {
  const testFn =
    mode === "skip" ? test.skip : mode === "only" ? test.only : test;
  testFn(
    label,
    async () => {
      const ts = tasks();
      if (concurrent) {
        await runConcurrent(ts, passRate, concurrency, timeout);
      } else {
        await runSequential(ts, passRate, timeout);
      }
    },
    totalTimeout(timeout, tasks().length, concurrent, concurrency),
  );
}

function bareEvaluateLabel(
  name: string,
  samples: number,
  passRate: number,
): string {
  if (samples <= 1) return name;
  return `${name} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`;
}

function registerBareNoFixtures(
  name: string,
  fn: () => Promise<void>,
  options: EvaluateOptions,
  mode: RunMode = "run",
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  register({
    label: bareEvaluateLabel(name, samples, passRate),
    tasks: () =>
      Array.from({ length: samples }, (_, i) => ({
        label: samples === 1 ? name : `sample ${i + 1}`,
        run: fn,
      })),
    passRate,
    timeout: options.timeout,
    concurrent: options.concurrent ?? false,
    concurrency: options.concurrency,
    mode,
  });
}

function registerBareWithFixtures<TFixtures>(
  name: string,
  fn: (fixtures: TFixtures) => Promise<void>,
  setup: SetupFn<TFixtures>,
  options: EvaluateOptions,
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  register({
    label: bareEvaluateLabel(name, samples, passRate),
    tasks: () =>
      Array.from({ length: samples }, (_, i) => ({
        label: samples === 1 ? name : `sample ${i + 1}`,
        run: () =>
          setup(async (fixtures: TFixtures) => {
            await fn(fixtures);
          }),
      })),
    passRate,
    timeout: options.timeout,
    concurrent: options.concurrent ?? false,
    concurrency: options.concurrency,
  });
}

function labelForScenario<T>(
  scenario: T,
  labelBy?: (scenario: T) => string,
): string {
  return labelBy ? labelBy(scenario) : scenarioLabel(scenario);
}

function registerScenariosNoFixtures<TScenario>(
  cases: TScenario[],
  options: ScenariosFnOptions<TScenario>,
  evalName: string,
  fn: (scenario: TScenario) => Promise<void>,
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  describe(evalName, () => {
    for (const scenario of cases) {
      const label = labelForScenario(scenario, options.labelBy);
      register({
        label:
          samples === 1
            ? label
            : `${label} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`,
        tasks: () =>
          Array.from({ length: samples }, (_, i) => ({
            label: samples === 1 ? label : `sample ${i + 1}`,
            run: () => fn(scenario),
          })),
        passRate,
        timeout: options.timeout,
        concurrent: options.concurrent ?? false,
        concurrency: options.concurrency,
      });
    }
  });
}

function registerScenariosWithFixtures<TScenario, TFixtures>(
  cases: TScenario[],
  options: ScenariosFnOptions<TScenario>,
  setup: SetupFn<TFixtures>,
  evalName: string,
  fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  describe(evalName, () => {
    for (const scenario of cases) {
      const label = labelForScenario(scenario, options.labelBy);
      register({
        label:
          samples === 1
            ? label
            : `${label} [${samples} samples, ${(passRate * 100).toFixed(0)}% pass]`,
        tasks: () =>
          Array.from({ length: samples }, (_, i) => ({
            label: samples === 1 ? label : `sample ${i + 1}`,
            run: () =>
              setup(async (fixtures: TFixtures) => {
                await fn(scenario, fixtures);
              }),
          })),
        passRate,
        timeout: options.timeout,
        concurrent: options.concurrent ?? false,
        concurrency: options.concurrency,
      });
    }
  });
}

interface ExtendedEvaluate<TFixtures> {
  (
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    opts?: EvaluateOptions,
  ): void;
  scenarios<TScenario>(
    cases: TScenario[],
    opts?: ScenariosFnOptions<TScenario>,
  ): (
    name: string,
    fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
  ) => void;
}

interface BareEvaluate {
  (name: string, fn: () => Promise<void>, opts?: EvaluateOptions): void;
}

interface Evaluate extends BareEvaluate {
  scenarios<T>(
    cases: T[],
    opts?: ScenariosFnOptions<T>,
  ): (name: string, fn: (scenario: T) => Promise<void>) => void;
  extend<TFixtures>(setup: SetupFn<TFixtures>): ExtendedEvaluate<TFixtures>;
  skip: BareEvaluate;
  only: BareEvaluate;
  todo: (name: string) => void;
  skipIf: (condition: boolean) => BareEvaluate;
  runIf: (condition: boolean) => BareEvaluate;
}

function bareEvaluate(
  name: string,
  fn: () => Promise<void>,
  opts: EvaluateOptions = {},
): void {
  registerBareNoFixtures(name, fn, opts);
}

function makeScenarios<T>(cases: T[], opts: ScenariosFnOptions<T> = {}) {
  return function registerEval(
    name: string,
    fn: (scenario: T) => Promise<void>,
  ): void {
    registerScenariosNoFixtures(cases, opts, name, fn);
  };
}

function makeExtend<TFixtures>(
  setup: SetupFn<TFixtures>,
): ExtendedEvaluate<TFixtures> {
  function extendedBare(
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerBareWithFixtures(name, fn, setup, opts);
  }

  function extendedScenarios<TScenario>(
    cases: TScenario[],
    opts: ScenariosFnOptions<TScenario> = {},
  ) {
    return function registerEval(
      name: string,
      fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
    ): void {
      registerScenariosWithFixtures(cases, opts, setup, name, fn);
    };
  }

  return Object.assign(extendedBare, { scenarios: extendedScenarios });
}

/**
 * Top-level eval primitive. Registers a vitest test that runs the body
 * once (or `samples` times if specified) and asserts the configured
 * pass rate.
 *
 * @example
 * ```typescript
 * evaluate(
 *   "classifies refund intent",
 *   async () => {
 *     const result = await classifier.run("I want a refund");
 *     expect(result.intent).toBe("refund");
 *   },
 *   { samples: 10, passRate: 0.8 },
 * );
 * ```
 *
 * `evaluate.scenarios(cases, opts)(name, body)` registers one vitest
 * test per scenario, grouped under a `describe` named after the eval.
 * Each per-scenario test runs `samples` repeats of the body and asserts
 * the configured `passRate` for that scenario.
 *
 * `evaluate.extend(setup)` returns a new evaluate-shaped namespace
 * where every registered eval runs through the provided setup function,
 * which builds and tears down a fresh fixtures bag per repeat.
 */
function bareEvaluateSkip(
  name: string,
  fn: () => Promise<void>,
  opts: EvaluateOptions = {},
): void {
  registerBareNoFixtures(name, fn, opts, "skip");
}

function bareEvaluateOnly(
  name: string,
  fn: () => Promise<void>,
  opts: EvaluateOptions = {},
): void {
  registerBareNoFixtures(name, fn, opts, "only");
}

function bareEvaluateTodo(name: string): void {
  test.todo(name);
}

function bareEvaluateSkipIf(condition: boolean): BareEvaluate {
  return condition ? bareEvaluateSkip : bareEvaluate;
}

function bareEvaluateRunIf(condition: boolean): BareEvaluate {
  return condition ? bareEvaluate : bareEvaluateSkip;
}

export const evaluate: Evaluate = Object.assign(bareEvaluate, {
  scenarios: makeScenarios,
  extend: makeExtend,
  skip: bareEvaluateSkip,
  only: bareEvaluateOnly,
  todo: bareEvaluateTodo,
  skipIf: bareEvaluateSkipIf,
  runIf: bareEvaluateRunIf,
});

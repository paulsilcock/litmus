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
  mode: RunMode = "run",
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
    mode,
  });
}

function labelForScenario<T>(
  scenario: T,
  labelBy?: (scenario: T) => string,
): string {
  return labelBy ? labelBy(scenario) : scenarioLabel(scenario);
}

function describeFor(mode: RunMode): (name: string, body: () => void) => void {
  if (mode === "skip") return describe.skip;
  if (mode === "only") return describe.only;
  return describe;
}

function registerScenariosNoFixtures<TScenario>(
  cases: TScenario[],
  options: ScenariosFnOptions<TScenario>,
  evalName: string,
  fn: (scenario: TScenario) => Promise<void>,
  mode: RunMode = "run",
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  describeFor(mode)(evalName, () => {
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
  mode: RunMode = "run",
): void {
  const samples = options.samples ?? 1;
  const passRate = options.passRate ?? 1;

  describeFor(mode)(evalName, () => {
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

/**
 * An evaluate-shaped namespace whose registered evals run through a
 * `setup` function that builds and tears down a fresh fixtures bag per
 * repeat. Returned by `evaluate.extend(setup)`.
 */
interface ExtendedEvaluate<TFixtures> {
  /**
   * Registers a single vitest test that runs the body once (or
   * `samples` times if specified), with `fixtures` injected from
   * `setup`. Asserts the configured pass rate.
   */
  (
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    opts?: EvaluateOptions,
  ): void;
  /**
   * Registers one vitest test per scenario, grouped under a `describe`.
   * Each per-scenario test runs `samples` repeats of the body (with
   * `fixtures` injected) and asserts the per-scenario pass rate.
   */
  scenarios<TScenario>(
    cases: TScenario[],
    opts?: ScenariosFnOptions<TScenario>,
  ): (
    name: string,
    fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
  ) => void;
  /** Skip variant — registered evals are reported as skipped. */
  skip: ExtendedEvaluate<TFixtures>;
  /** Focus variant — only this eval and other `.only` evals run. */
  only: ExtendedEvaluate<TFixtures>;
  /** Skip when `condition` is true; otherwise behave like the base. */
  skipIf: (condition: boolean) => ExtendedEvaluate<TFixtures>;
  /** Run only when `condition` is true; otherwise skip. */
  runIf: (condition: boolean) => ExtendedEvaluate<TFixtures>;
}

/**
 * The base callable shape: registers a single evaluation as a vitest
 * test. Modifiers and parameterised forms hang off `evaluate`.
 */
interface BareEvaluate {
  (name: string, fn: () => Promise<void>, opts?: EvaluateOptions): void;
}

/**
 * Public surface for `evaluate`.
 *
 * - `evaluate(name, fn, opts?)` — single eval (optionally stochastic).
 * - `evaluate.scenarios(cases, opts?)(name, fn)` — one vitest test per
 *   scenario, grouped under a `describe`.
 * - `evaluate.extend(setup)` — returns a namespace where every eval
 *   runs through the setup function, which builds a fresh fixtures bag
 *   per repeat.
 * - `evaluate.skip` / `.only` — modifier namespaces; both expose the
 *   same shape (`.scenarios`, `.extend`, `.skipIf`, `.runIf`) so the
 *   modifier propagates through composition.
 * - `evaluate.todo(name)` — placeholder for an eval not yet written.
 * - `evaluate.skipIf(cond)` / `.runIf(cond)` — conditional modifiers
 *   returning a namespace that either runs or skips based on `cond`.
 */
interface Evaluate extends BareEvaluate {
  /**
   * Parameterised eval. Registers one vitest test per scenario under a
   * `describe(name)`. Per-scenario `samples` and `passRate` apply
   * inside each scenario test.
   */
  scenarios<T>(
    cases: T[],
    opts?: ScenariosFnOptions<T>,
  ): (name: string, fn: (scenario: T) => Promise<void>) => void;
  /**
   * Returns an evaluate-shaped namespace where every registered eval
   * runs through the provided setup function. Setup builds and tears
   * down a fresh fixtures bag per repeat — essential for concurrent
   * execution where shared state would interfere.
   */
  extend<TFixtures>(setup: SetupFn<TFixtures>): ExtendedEvaluate<TFixtures>;
  /** Skip variant — registered evals are reported as skipped. */
  skip: Evaluate;
  /** Focus variant — only this eval and other `.only` evals run. */
  only: Evaluate;
  /**
   * Placeholder for an eval not yet written. Surfaces as a `todo` entry
   * in the vitest report; takes no body.
   */
  todo: (name: string) => void;
  /** Skip when `condition` is true; otherwise behave like the base. */
  skipIf: (condition: boolean) => Evaluate;
  /** Run only when `condition` is true; otherwise skip. */
  runIf: (condition: boolean) => Evaluate;
}

function makeEvaluate(mode: RunMode): Evaluate {
  function bare(
    name: string,
    fn: () => Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerBareNoFixtures(name, fn, opts, mode);
  }

  function scenarios<T>(cases: T[], opts: ScenariosFnOptions<T> = {}) {
    return function registerEval(
      name: string,
      fn: (scenario: T) => Promise<void>,
    ): void {
      registerScenariosNoFixtures(cases, opts, name, fn, mode);
    };
  }

  const target = Object.assign(bare, {
    scenarios,
    extend: <TFixtures>(setup: SetupFn<TFixtures>) => makeExtended(setup, mode),
    todo: (name: string) => {
      test.todo(name);
    },
    skipIf: (condition: boolean): Evaluate =>
      makeEvaluate(condition ? "skip" : mode),
    runIf: (condition: boolean): Evaluate =>
      makeEvaluate(condition ? mode : "skip"),
  });

  Object.defineProperty(target, "skip", {
    get: () => makeEvaluate("skip"),
    enumerable: true,
  });
  Object.defineProperty(target, "only", {
    get: () => makeEvaluate("only"),
    enumerable: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return target as Evaluate;
}

function makeExtended<TFixtures>(
  setup: SetupFn<TFixtures>,
  mode: RunMode,
): ExtendedEvaluate<TFixtures> {
  function bare(
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerBareWithFixtures(name, fn, setup, opts, mode);
  }

  function scenarios<TScenario>(
    cases: TScenario[],
    opts: ScenariosFnOptions<TScenario> = {},
  ) {
    return function registerEval(
      name: string,
      fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
    ): void {
      registerScenariosWithFixtures(cases, opts, setup, name, fn, mode);
    };
  }

  const target = Object.assign(bare, {
    scenarios,
    skipIf: (condition: boolean): ExtendedEvaluate<TFixtures> =>
      makeExtended(setup, condition ? "skip" : mode),
    runIf: (condition: boolean): ExtendedEvaluate<TFixtures> =>
      makeExtended(setup, condition ? mode : "skip"),
  });

  Object.defineProperty(target, "skip", {
    get: () => makeExtended(setup, "skip"),
    enumerable: true,
  });
  Object.defineProperty(target, "only", {
    get: () => makeExtended(setup, "only"),
    enumerable: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return target as ExtendedEvaluate<TFixtures>;
}

/**
 * Top-level eval primitive. See {@link Evaluate} for the full surface.
 */
export const evaluate: Evaluate = makeEvaluate("run");

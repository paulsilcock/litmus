import { test } from "vite-plus/test";

import { evaluationLabel, scenarioLabel } from "./labels.ts";
import { describeFor, register, type RunMode } from "./register.ts";
import { type RunTask } from "./runner.ts";

/** Options accepted by every form of `evaluate`. */
export interface EvaluateOptions {
  /** Number of times to run the body. Defaults to 1. */
  samples?: number;
  /** Minimum pass ratio (0–1) for the eval to succeed. Defaults to 1. */
  passRate?: number;
  /** Per-run timeout in milliseconds. */
  timeout?: number;
  /** Run repeats in parallel rather than sequentially. */
  concurrent?: boolean;
  /** Maximum parallel runs when `concurrent: true`. Defaults to 5. */
  concurrency?: number;
}

/** Options accepted by `evaluate.scenarios(cases, opts)`. */
export interface ScenariosFnOptions<T = unknown> extends EvaluateOptions {
  /**
   * Derives the per-scenario test label shown in the vitest report.
   * Useful when scenarios don't have a `name` or `id` field. Defaults
   * to `scenario.name`, then `scenario.id`, then `"scenario"`.
   */
  labelBy?: (scenario: T) => string;
}

/**
 * Lifecycle hook used by `evaluate.extend(setup)`. Builds a fresh
 * fixtures bag, hands it to `use()`, then runs teardown after `use()`
 * resolves. Mirrors vitest's `test.extend` setup callback shape.
 */
export type SetupFn<TFixtures> = (
  use: (fixtures: TFixtures) => Promise<void>,
) => Promise<void>;

/**
 * An evaluate-shaped namespace whose registered evals run through a
 * `setup` function that builds and tears down a fresh fixtures bag per
 * repeat. Returned by `evaluate.extend(setup)`.
 */
export interface ExtendedEvaluate<TFixtures> {
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
export interface Evaluate {
  /**
   * Registers a single evaluation as a vitest test. Body runs once
   * (or `samples` times if specified); pass-rate is asserted at the
   * end.
   */
  (name: string, fn: () => Promise<void>, opts?: EvaluateOptions): void;
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

// ── Task building ────────────────────────────────────────────────────
//
// All four registration paths (single/scenarios × no-fixtures/with-
// fixtures) share the same shape: build a list of RunTasks and hand
// them to `register`. The only differences are how each task's `run`
// is built and whether the registration is wrapped in a `describe`.

function sampleTasks(
  parentLabel: string,
  samples: number,
  buildRun: () => () => Promise<void>,
): RunTask[] {
  return Array.from({ length: samples }, (_, i) => ({
    label: samples === 1 ? parentLabel : `sample ${i + 1}`,
    run: buildRun(),
  }));
}

function withFixturesRun<TFixtures>(
  fn: (fixtures: TFixtures) => Promise<void>,
  setup: SetupFn<TFixtures>,
): () => Promise<void> {
  return () => setup(async (fixtures) => fn(fixtures));
}

function scenarioWithFixturesRun<TScenario, TFixtures>(
  fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
  setup: SetupFn<TFixtures>,
  scenario: TScenario,
): () => Promise<void> {
  return () => setup(async (fixtures) => fn(scenario, fixtures));
}

// ── Registration entry points ────────────────────────────────────────

function registerSingle(
  name: string,
  buildRun: () => () => Promise<void>,
  opts: EvaluateOptions,
  mode: RunMode,
): void {
  const samples = opts.samples ?? 1;
  const passRate = opts.passRate ?? 1;
  register({
    label: evaluationLabel(name, samples, passRate),
    tasks: sampleTasks(name, samples, buildRun),
    passRate,
    timeout: opts.timeout,
    concurrent: opts.concurrent ?? false,
    concurrency: opts.concurrency,
    mode,
  });
}

function registerScenarios<TScenario>(
  cases: TScenario[],
  opts: ScenariosFnOptions<TScenario>,
  evalName: string,
  buildRun: (scenario: TScenario) => () => Promise<void>,
  mode: RunMode,
): void {
  const samples = opts.samples ?? 1;
  const passRate = opts.passRate ?? 1;
  describeFor(mode)(evalName, () => {
    for (const scenario of cases) {
      const label = opts.labelBy?.(scenario) ?? scenarioLabel(scenario);
      register({
        label: evaluationLabel(label, samples, passRate),
        tasks: sampleTasks(label, samples, () => buildRun(scenario)),
        passRate,
        timeout: opts.timeout,
        concurrent: opts.concurrent ?? false,
        concurrency: opts.concurrency,
      });
    }
  });
}

// ── Public factories ─────────────────────────────────────────────────

function makeEvaluate(mode: RunMode): Evaluate {
  function evaluateOne(
    name: string,
    fn: () => Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(name, () => fn, opts, mode);
  }

  function scenarios<T>(cases: T[], opts: ScenariosFnOptions<T> = {}) {
    return (name: string, fn: (scenario: T) => Promise<void>): void =>
      registerScenarios(
        cases,
        opts,
        name,
        (scenario) => () => fn(scenario),
        mode,
      );
  }

  const target = Object.assign(evaluateOne, {
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
  function evaluateOne(
    name: string,
    fn: (fixtures: TFixtures) => Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(name, () => withFixturesRun(fn, setup), opts, mode);
  }

  function scenarios<TScenario>(
    cases: TScenario[],
    opts: ScenariosFnOptions<TScenario> = {},
  ) {
    return (
      name: string,
      fn: (scenario: TScenario, fixtures: TFixtures) => Promise<void>,
    ): void =>
      registerScenarios(
        cases,
        opts,
        name,
        (scenario) => scenarioWithFixturesRun(fn, setup, scenario),
        mode,
      );
  }

  const target = Object.assign(evaluateOne, {
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

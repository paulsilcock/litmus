import { test } from "vite-plus/test";

import { type Grader } from "#litmus-test/grader.ts";
import {
  readCachedScenariosSync,
  resolveMode,
  synthesize,
  type SynthesizeOptions,
} from "#litmus-test/synthesize.ts";

import { evaluationLabel, scenarioLabel } from "./labels.ts";
import { describeFor, register, testFor, type RunMode } from "./register.ts";
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
 * Synthesize-form input for `evaluate.scenarios`. Synthesises scenarios
 * via the configured model on first run, caches them next to the test
 * file, and reuses the cache on subsequent runs.
 */
export interface ScenariosSynthesizeInput<T> extends ScenariosFnOptions<T> {
  synthesize: SynthesizeOptions<T>;
}

/**
 * Lifecycle hook used by `evaluate.extend(setup)`. Builds a fresh
 * fixtures bag, hands it to `use()`, then runs teardown after `use()`
 * resolves. Mirrors vitest's `test.extend` setup callback shape.
 */
export type SetupFn<TFixtures> = (
  use: (fixtures: TFixtures) => Promise<void>,
) => Promise<void>;

/** Map of guardrail registration key → grader. */
export type GuardrailMap = Record<string, Grader<string>>;

/**
 * Body return type required by the eval. With no guardrails registered
 * (`K = never`), the body may return anything. Once a guardrail is
 * registered, the body must return a string-typed value to feed each
 * grader.
 */
export type BodyReturn<K extends string> = [K] extends [never]
  ? unknown
  : string | Promise<string>;

/**
 * An evaluate-shaped namespace whose registered evals run through a
 * `setup` function that builds and tears down a fresh fixtures bag per
 * repeat. Returned by `evaluate.extend(setup)`.
 *
 * The second type parameter is the union of guardrail names already
 * registered via `.guardrails(...)`. It defaults to `never` (no
 * guardrails) and accumulates with each chained call, enabling a
 * compile-time check against duplicate registrations.
 */
export interface ExtendedEvaluate<TFixtures, K extends string = never> {
  /**
   * Registers a single vitest test that runs the body once (or
   * `samples` times if specified), with `fixtures` injected from
   * `setup`. Asserts the configured pass rate.
   */
  (
    name: string,
    fn: (fixtures: TFixtures) => BodyReturn<K>,
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
    fn: (scenario: TScenario, fixtures: TFixtures) => void | Promise<void>,
  ) => void;
  /**
   * Register a set of guardrails on this extended evaluate. Every
   * registered eval body returns the value to grade; each guardrail's
   * grader is invoked with that value after the body completes. A
   * grader returning `pass: false` fails the sample, counting against
   * the configured pass rate. All graders run before the failure is
   * reported, so reasons from multiple failing guardrails surface
   * together in the failure message.
   *
   * Chained calls accumulate — the returned extended evaluate sees
   * every guardrail registered on the chain so far. Re-registering an
   * existing name is a compile-time error. An empty map is a no-op
   * and leaves the body return type unconstrained.
   */
  guardrails<G extends { [P in keyof G]: Grader<string> }>(
    map: G & { [P in keyof G & K]: never },
  ): ExtendedEvaluate<TFixtures, K | (keyof G & string)>;
  /** Skip variant — registered evals are reported as skipped. */
  skip: ExtendedEvaluate<TFixtures, K>;
  /** Focus variant — only this eval and other `.only` evals run. */
  only: ExtendedEvaluate<TFixtures, K>;
  /** Skip when `condition` is true; otherwise behave like the base. */
  skipIf: (condition: boolean) => ExtendedEvaluate<TFixtures, K>;
  /** Run only when `condition` is true; otherwise skip. */
  runIf: (condition: boolean) => ExtendedEvaluate<TFixtures, K>;
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
  (name: string, fn: () => void | Promise<void>, opts?: EvaluateOptions): void;
  /**
   * Parameterised eval. Registers one vitest test per scenario under a
   * `describe(name)`. Per-scenario `samples` and `passRate` apply
   * inside each scenario test.
   */
  scenarios<T>(
    cases: T[],
    opts?: ScenariosFnOptions<T>,
  ): (name: string, fn: (scenario: T) => void | Promise<void>) => void;
  /**
   * Synthesize-form: produces scenarios via `synthesize` and registers
   * one vitest test per scenario, grouped under a `describe(name)`.
   * Registration is synchronous so vitest can collect tests normally.
   *
   * Behaviour depends on the resolved cache mode:
   * - `"strict"` (default) — the cache file is read and validated at
   *   registration time. On hit, scenarios are known up-front and
   *   tests are named via `labelBy` (or the scenario's name/id field).
   *   On miss or stale, a single failing test surfaces the regen
   *   instruction; per-scenario tests don't appear, and unrelated
   *   tests in the same file are unaffected.
   * - `"regenerate"` — synthesis is deferred to the first test
   *   execution and shared across all tests in the eval. Tests are
   *   named by position (`scenario 1`, `scenario 2`, …) because
   *   scenarios aren't known at registration time.
   *
   * The cache path is auto-derived from the test file (and the eval
   * name as a slug) unless `synthesize.cache` is supplied explicitly.
   */
  scenarios<T>(
    input: ScenariosSynthesizeInput<T>,
  ): (name: string, fn: (scenario: T) => void | Promise<void>) => void;
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
  fn: (fixtures: TFixtures) => unknown,
  setup: SetupFn<TFixtures>,
  guardrails: GuardrailMap = {},
): () => Promise<void> {
  return () =>
    setup(async (fixtures) => {
      const output = await fn(fixtures);
      const failures: string[] = [];
      for (const [name, grade] of Object.entries(guardrails)) {
        const verdict = await grade(String(output));
        if (!verdict.pass) {
          failures.push(`guardrail "${name}" failed: ${verdict.reason}`);
        }
      }
      if (failures.length > 0) {
        throw new Error(failures.join("; "));
      }
    });
}

function scenarioWithFixturesRun<TScenario, TFixtures>(
  fn: (scenario: TScenario, fixtures: TFixtures) => void | Promise<void>,
  setup: SetupFn<TFixtures>,
  scenario: TScenario,
): () => Promise<void> {
  return () =>
    setup(async (fixtures) => {
      await fn(scenario, fixtures);
    });
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

function registerSynthesizedScenarios<TScenario>(
  input: ScenariosSynthesizeInput<TScenario>,
  evalName: string,
  buildRun: (scenario: TScenario) => () => Promise<void>,
  mode: RunMode,
): void {
  const samples = input.samples ?? 1;
  const passRate = input.passRate ?? 1;
  const expectedCount =
    input.synthesize.seeds.length + input.synthesize.variants;

  let resolvedScenarios: TScenario[] = [];
  let cachedPromise: Promise<TScenario[]> | undefined;
  async function ensureScenarios(): Promise<void> {
    cachedPromise ??= synthesize({ name: evalName, ...input.synthesize }).then(
      (s) => {
        resolvedScenarios = s;
        return s;
      },
    );
    await cachedPromise;
  }

  describeFor(mode)(evalName, () => {
    for (let i = 0; i < expectedCount; i++) {
      const label = `scenario ${i + 1}`;
      register({
        label: evaluationLabel(label, samples, passRate),
        setup: ensureScenarios,
        tasks: sampleTasks(label, samples, () => async () => {
          const scenario = resolvedScenarios[i];
          if (scenario === undefined) {
            throw new Error(
              `Synthesised scenario at index ${i} is undefined — ` +
                `expected ${expectedCount} scenarios, got ${resolvedScenarios.length}.`,
            );
          }
          await buildRun(scenario)();
        }),
        passRate,
        timeout: input.timeout,
        concurrent: input.concurrent ?? false,
        concurrency: input.concurrency,
      });
    }
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
    fn: () => void | Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(name, () => async () => fn(), opts, mode);
  }

  function scenarios<T>(
    casesOrInput: T[] | ScenariosSynthesizeInput<T>,
    opts: ScenariosFnOptions<T> = {},
  ) {
    if (Array.isArray(casesOrInput)) {
      return (name: string, fn: (scenario: T) => void | Promise<void>): void =>
        registerScenarios(
          casesOrInput,
          opts,
          name,
          (scenario) => async () => fn(scenario),
          mode,
        );
    }
    const input = casesOrInput;
    return (name: string, fn: (scenario: T) => void | Promise<void>): void => {
      const synthOpts = { name, ...input.synthesize };

      if (resolveMode(synthOpts.mode) === "regenerate") {
        registerSynthesizedScenarios(
          input,
          name,
          (scenario) => async () => fn(scenario),
          mode,
        );
        return;
      }

      try {
        const cached = readCachedScenariosSync<T>(synthOpts);
        registerScenarios(
          cached,
          input,
          name,
          (scenario) => async () => fn(scenario),
          mode,
        );
      } catch (err) {
        // Cache missing or stale: register a single failing test that
        // surfaces the regen instruction. Other tests in the file are
        // unaffected — only the eval whose cache is bad fails.
        testFor(mode)(name, () => {
          throw err;
        });
      }
    };
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

function makeExtended<TFixtures, K extends string = never>(
  setup: SetupFn<TFixtures>,
  mode: RunMode,
  guardrails: GuardrailMap = {},
): ExtendedEvaluate<TFixtures, K> {
  const withMode = (m: RunMode): ExtendedEvaluate<TFixtures, K> =>
    makeExtended<TFixtures, K>(setup, m, guardrails);

  function evaluateOne(
    name: string,
    fn: (fixtures: TFixtures) => unknown,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(
      name,
      () => withFixturesRun(fn, setup, guardrails),
      opts,
      mode,
    );
  }

  function scenarios<TScenario>(
    cases: TScenario[],
    opts: ScenariosFnOptions<TScenario> = {},
  ) {
    return (
      name: string,
      fn: (scenario: TScenario, fixtures: TFixtures) => void | Promise<void>,
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
    guardrails: <G extends { [P in keyof G]: Grader<string> }>(
      map: G & { [P in keyof G & K]: never },
    ): ExtendedEvaluate<TFixtures, K | (keyof G & string)> =>
      makeExtended<TFixtures, K | (keyof G & string)>(setup, mode, {
        ...guardrails,
        ...map,
      }),
    skipIf: (condition: boolean): ExtendedEvaluate<TFixtures, K> =>
      withMode(condition ? "skip" : mode),
    runIf: (condition: boolean): ExtendedEvaluate<TFixtures, K> =>
      withMode(condition ? mode : "skip"),
  });

  Object.defineProperty(target, "skip", {
    get: () => withMode("skip"),
    enumerable: true,
  });
  Object.defineProperty(target, "only", {
    get: () => withMode("only"),
    enumerable: true,
  });

  // eslint-disable-next-line @typescript-eslint/no-unsafe-type-assertion
  return target as ExtendedEvaluate<TFixtures, K>;
}

/**
 * Top-level eval primitive. See {@link Evaluate} for the full surface.
 */
export const evaluate: Evaluate = makeEvaluate("run");

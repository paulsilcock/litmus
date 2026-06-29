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
}

/** Options accepted by `evaluate.scenarios(cases, opts)`. */
export interface ScenariosFnOptions<T = unknown> {
  /**
   * Derives the per-scenario test label shown in the vitest report.
   * Useful when scenarios don't have a `name` or `id` field. Defaults
   * to `scenario.name`, then `scenario.id`, then `"scenario"`.
   */
  labelBy?: (scenario: T) => string;
  samples?: number;
  passRate?: number;
  timeout?: number;
  concurrent?: boolean;
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

/** Map of policy registration key → grader. */
export type PolicyMap = Record<string, Grader<string>>;

/**
 * Fixture injected by `.withPolicies(...)`. The eval body calls it
 * with the value to grade; the fixture runs every registered grader
 * and throws an aggregated error on any rejection.
 */
export type PoliciesFixture = (input: string) => Promise<void>;

/**
 * An evaluate-shaped namespace whose registered evals run through a
 * `setup` function that builds and tears down a fresh fixtures bag per
 * repeat. Returned by `evaluate.extend(setup)`.
 *
 * The second type parameter is the union of policy names already
 * registered via `.withPolicies(...)`. It defaults to `never` (no
 * policies) and accumulates with each chained call, enabling a
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
    fn: (fixtures: TFixtures) => unknown,
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
    fn: (scenario: TScenario, fixtures: TFixtures) => unknown,
  ) => void;
  scenarios<TScenario>(
    input: ScenariosSynthesizeInput<TScenario>,
  ): (
    name: string,
    fn: (scenario: TScenario, fixtures: TFixtures) => unknown,
  ) => void;
  /**
   * Register a set of policies on this extended evaluate. The
   * returned evaluate injects a `policies` fixture into every eval
   * body — calling `policies(input)` runs each registered grader
   * against `input` and throws an aggregated error if any reject.
   * Forgetting to call `policies(...)` fails the sample with a
   * message naming every registered grader.
   *
   * Chained calls accumulate — the returned extended evaluate sees
   * every policy registered on the chain so far. Re-registering an
   * existing name is a compile-time error. An empty map is a no-op.
   *
   * **Intended for acceptance-level evals**, where the same cross-
   * cutting checks (PII leakage, disclaimer presence, vulnerable-user
   * tone) apply across many scenarios driven through a DSL. Compose
   * with `acceptance(createDsl).evaluate.withPolicies({...})` to get
   * both the `dsl` and `policies` fixtures on every body.
   *
   * For component-level evals (testing a single agent or prompt),
   * prefer calling shared `Grader<string>` functions directly rather
   * than reaching for this — the wrapper's value is in sharing checks
   * across many evals, which component tests rarely do.
   *
   * @example
   * ```typescript
   * const { evaluate } = acceptance(() => new TelcoDsl(driver));
   *
   * const guarded = evaluate.withPolicies({
   *   "no PII leakage": noPiiGrader,
   *   "no upsell after refusal": noUpsellGrader,
   * });
   *
   * guarded("agent stays on policy", async ({ dsl, policies }) => {
   *   const conversation = await dsl.customerCallsSupport({ ... });
   *   await policies(renderTranscript(conversation));
   * });
   * ```
   */
  withPolicies<G extends { [P in keyof G]: Grader<string> }>(
    map: G & { [P in keyof G & K]: never },
  ): ExtendedEvaluate<
    TFixtures & { policies: PoliciesFixture },
    K | (keyof G & string)
  >;
  /** Skip variant — registered evals are reported as skipped. */
  skip: ExtendedEvaluate<TFixtures, K>;
  /** Focus variant — only this eval and other `.only` evals run. */
  only: ExtendedEvaluate<TFixtures, K>;
  /** Skip when `condition` is true; otherwise behave like the base. */
  skipIf: (condition: boolean) => ExtendedEvaluate<TFixtures, K>;
  /** Run only when `condition` is true; otherwise skip. */
  runIf: (condition: boolean) => ExtendedEvaluate<TFixtures, K>;
  /** Sets per-run timeout (ms). Overrides the `timeout` option. */
  timeout(ms: number): ExtendedEvaluate<TFixtures, K>;
  /** Sets number of samples. Overrides the `samples` option. */
  samples(n: number): ExtendedEvaluate<TFixtures, K>;
  /** Sets pass ratio (0-1). Overrides the `passRate` option. */
  passRate(r: number): ExtendedEvaluate<TFixtures, K>;
  /** Enables concurrent mode. */
  readonly concurrent: ExtendedEvaluate<TFixtures, K>;
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
  /** Sets per-run timeout (ms). Overrides the `timeout` option. */
  timeout(ms: number): Evaluate;
  /** Sets number of samples. Overrides the `samples` option. */
  samples(n: number): Evaluate;
  /** Sets pass ratio (0-1). Overrides the `passRate` option. */
  passRate(r: number): Evaluate;
  /** Enables concurrent mode. */
  readonly concurrent: Evaluate;
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

/**
 * Run every registered grader against `input`, accumulating per-
 * policy failure reasons. Throws once with all reasons concatenated
 * if any grader returned `pass: false`.
 */
async function runPolicies(input: string, policies: PolicyMap): Promise<void> {
  const failures: string[] = [];
  for (const [name, grade] of Object.entries(policies)) {
    const verdict = await grade(input);
    if (!verdict.pass) {
      failures.push(`policy "${name}" failed: ${verdict.reason}`);
    }
  }
  if (failures.length > 0) {
    throw new Error(failures.join("; "));
  }
}

/**
 * Build the `policies` fixture handed to eval bodies. Returns the
 * fixture plus an `assertInvoked()` callback the run wrapper calls
 * after a successful body, which throws if policies were registered
 * but never invoked.
 */
function buildPoliciesFixture(policies: PolicyMap): {
  fixture: PoliciesFixture;
  assertInvoked: () => void;
} {
  let called = false;
  const fixture: PoliciesFixture = async (input) => {
    called = true;
    await runPolicies(input, policies);
  };
  const assertInvoked = (): void => {
    const names = Object.keys(policies);
    if (names.length > 0 && !called) {
      throw new Error(
        `policies [${names.join(", ")}] registered but never invoked — ` +
          `call the \`policies\` fixture with the value to grade.`,
      );
    }
  };
  return { fixture, assertInvoked };
}

function withFixturesRun<TFixtures>(
  fn: (fixtures: TFixtures) => unknown,
  setup: SetupFn<TFixtures>,
  policies: PolicyMap = {},
): () => Promise<void> {
  return () =>
    setup(async (fixtures) => {
      const { fixture, assertInvoked } = buildPoliciesFixture(policies);
      // oxlint-disable-next-line no-unsafe-type-assertion
      await fn({ ...fixtures, policies: fixture } as TFixtures);
      assertInvoked();
    });
}

function scenarioWithFixturesRun<TScenario, TFixtures>(
  fn: (scenario: TScenario, fixtures: TFixtures) => unknown,
  setup: SetupFn<TFixtures>,
  scenario: TScenario,
  policies: PolicyMap = {},
): () => Promise<void> {
  return () =>
    setup(async (fixtures) => {
      const { fixture, assertInvoked } = buildPoliciesFixture(policies);
      // oxlint-disable-next-line no-unsafe-type-assertion
      await fn(scenario, { ...fixtures, policies: fixture } as TFixtures);
      assertInvoked();
    });
}

// ── Registration entry points ────────────────────────────────────────

function mergeOpts(
  chainOpts: EvaluateOptions,
  callOpts: EvaluateOptions,
): EvaluateOptions {
  return { ...callOpts, ...chainOpts };
}

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
      });
    }
  });
}

// ── Public factories ─────────────────────────────────────────────────

function makeEvaluate(
  mode: RunMode,
  chainOpts: EvaluateOptions = {},
): Evaluate {
  function evaluateOne(
    name: string,
    fn: () => void | Promise<void>,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(
      name,
      () => async () => fn(),
      mergeOpts(chainOpts, opts),
      mode,
    );
  }

  function scenarios<T>(
    casesOrInput: T[] | ScenariosSynthesizeInput<T>,
    opts: ScenariosFnOptions<T> = {},
  ) {
    const merged = mergeOpts(chainOpts, opts);
    if (Array.isArray(casesOrInput)) {
      return (name: string, fn: (scenario: T) => void | Promise<void>): void =>
        registerScenarios(
          casesOrInput,
          merged,
          name,
          (scenario) => async () => fn(scenario),
          mode,
        );
    }
    const input = casesOrInput;
    const mergedInput: ScenariosSynthesizeInput<T> = { ...input, ...chainOpts };
    return (name: string, fn: (scenario: T) => void | Promise<void>): void => {
      const synthOpts = { name, ...mergedInput.synthesize };

      if (resolveMode(synthOpts.mode) === "regenerate") {
        registerSynthesizedScenarios(
          mergedInput,
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
          mergedInput,
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
    extend: <TFixtures>(setup: SetupFn<TFixtures>) =>
      makeExtended(setup, mode, {}, chainOpts),
    todo: (name: string) => {
      test.todo(name);
    },
    skipIf: (condition: boolean): Evaluate =>
      makeEvaluate(condition ? "skip" : mode, chainOpts),
    runIf: (condition: boolean): Evaluate =>
      makeEvaluate(condition ? mode : "skip", chainOpts),
    timeout: (ms: number): Evaluate =>
      makeEvaluate(mode, { ...chainOpts, timeout: ms }),
    samples: (n: number): Evaluate =>
      makeEvaluate(mode, { ...chainOpts, samples: n }),
    passRate: (r: number): Evaluate =>
      makeEvaluate(mode, { ...chainOpts, passRate: r }),
  });

  Object.defineProperty(target, "skip", {
    get: () => makeEvaluate("skip", chainOpts),
    enumerable: true,
  });
  Object.defineProperty(target, "only", {
    get: () => makeEvaluate("only", chainOpts),
    enumerable: true,
  });
  Object.defineProperty(target, "concurrent", {
    get: () => makeEvaluate(mode, { ...chainOpts, concurrent: true }),
    enumerable: true,
  });

  // oxlint-disable-next-line no-unsafe-type-assertion
  return target as Evaluate;
}

function makeExtended<TFixtures, K extends string = never>(
  setup: SetupFn<TFixtures>,
  mode: RunMode,
  policies: PolicyMap = {},
  chainOpts: EvaluateOptions = {},
): ExtendedEvaluate<TFixtures, K> {
  const withMode = (m: RunMode): ExtendedEvaluate<TFixtures, K> =>
    makeExtended<TFixtures, K>(setup, m, policies, chainOpts);

  function evaluateOne(
    name: string,
    fn: (fixtures: TFixtures) => unknown,
    opts: EvaluateOptions = {},
  ): void {
    registerSingle(
      name,
      () => withFixturesRun(fn, setup, policies),
      mergeOpts(chainOpts, opts),
      mode,
    );
  }

  function scenarios<TScenario>(
    casesOrInput: TScenario[] | ScenariosSynthesizeInput<TScenario>,
    opts: ScenariosFnOptions<TScenario> = {},
  ) {
    if (Array.isArray(casesOrInput)) {
      const merged = mergeOpts(chainOpts, opts);
      return (
        name: string,
        fn: (scenario: TScenario, fixtures: TFixtures) => unknown,
      ): void =>
        registerScenarios(
          casesOrInput,
          merged,
          name,
          (scenario) => scenarioWithFixturesRun(fn, setup, scenario, policies),
          mode,
        );
    }
    const input = casesOrInput;
    return (
      name: string,
      fn: (scenario: TScenario, fixtures: TFixtures) => unknown,
    ): void => {
      const synthOpts = {
        name,
        ...input.synthesize,
        ...mergeOpts(chainOpts, opts),
      };

      if (resolveMode(synthOpts.mode) === "regenerate") {
        registerSynthesizedScenarios(
          input,
          name,
          (scenario) => scenarioWithFixturesRun(fn, setup, scenario, policies),
          mode,
        );
        return;
      }

      try {
        const cached = readCachedScenariosSync<TScenario>(synthOpts);
        registerScenarios(
          cached,
          input,
          name,
          (scenario) => scenarioWithFixturesRun(fn, setup, scenario, policies),
          mode,
        );
      } catch (err) {
        testFor(mode)(name, () => {
          throw err;
        });
      }
    };
  }

  const target = Object.assign(evaluateOne, {
    scenarios,
    withPolicies: <G extends { [P in keyof G]: Grader<string> }>(
      map: G & { [P in keyof G & K]: never },
    ): ExtendedEvaluate<
      TFixtures & { policies: PoliciesFixture },
      K | (keyof G & string)
    > =>
      makeExtended<
        TFixtures & { policies: PoliciesFixture },
        K | (keyof G & string)
      >(
        // The user's setup produces TFixtures; the run wrapper layers
        // the policies fixture on top before invoking the body, so
        // the runtime shape matches the widened TFixtures.
        // oxlint-disable-next-line no-unsafe-type-assertion
        setup as SetupFn<TFixtures & { policies: PoliciesFixture }>,
        mode,
        { ...policies, ...map },
        chainOpts,
      ),
    skipIf: (condition: boolean): ExtendedEvaluate<TFixtures, K> =>
      withMode(condition ? "skip" : mode),
    runIf: (condition: boolean): ExtendedEvaluate<TFixtures, K> =>
      withMode(condition ? mode : "skip"),
    timeout: (ms: number): ExtendedEvaluate<TFixtures, K> =>
      makeExtended<TFixtures, K>(setup, mode, policies, {
        ...chainOpts,
        timeout: ms,
      }),
    samples: (n: number): ExtendedEvaluate<TFixtures, K> =>
      makeExtended<TFixtures, K>(setup, mode, policies, {
        ...chainOpts,
        samples: n,
      }),
    passRate: (r: number): ExtendedEvaluate<TFixtures, K> =>
      makeExtended<TFixtures, K>(setup, mode, policies, {
        ...chainOpts,
        passRate: r,
      }),
  });

  Object.defineProperty(target, "skip", {
    get: () => withMode("skip"),
    enumerable: true,
  });
  Object.defineProperty(target, "only", {
    get: () => withMode("only"),
    enumerable: true,
  });
  Object.defineProperty(target, "concurrent", {
    get: () =>
      makeExtended<TFixtures, K>(setup, mode, policies, {
        ...chainOpts,
        concurrent: true,
      }),
    enumerable: true,
  });

  // oxlint-disable-next-line no-unsafe-type-assertion
  return target as ExtendedEvaluate<TFixtures, K>;
}

/**
 * Top-level eval primitive. See {@link Evaluate} for the full surface.
 */
export const evaluate: Evaluate = makeEvaluate("run");

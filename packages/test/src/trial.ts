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
  each(
    name: string,
    fn: () => Promise<void>,
    options?: EachOptions,
  ): Promise<void>;
  concurrent: {
    each(
      name: string,
      fn: () => Promise<void>,
      options?: EachOptions,
    ): Promise<void>;
  };
}

interface FixturesRunner<T> {
  each(
    name: string | ((fixture: T) => string),
    fn: (fixture: T) => Promise<void>,
    options?: EachOptions,
  ): Promise<void>;
  concurrent: {
    each(
      name: string | ((fixture: T) => string),
      fn: (fixture: T) => Promise<void>,
      options?: EachOptions,
    ): Promise<void>;
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
  ): Promise<void>;
  concurrent: {
    each(
      name: string,
      fn: (ctx: TContext) => Promise<void>,
      options?: EachOptions,
    ): Promise<void>;
  };
}

interface ContextFixturesRunner<TFixture, TContext> {
  each(
    name: string | ((fixture: TFixture) => string),
    fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
    options?: EachOptions,
  ): Promise<void>;
  concurrent: {
    each(
      name: string | ((fixture: TFixture) => string),
      fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
      options?: EachOptions,
    ): Promise<void>;
  };
}

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
        async each(
          name: string | ((fixture: TFixture) => string),
          fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          const tasks = fixtures.map((fixture) => ({
            label: resolveLabel(name, fixture),
            run: () =>
              setup(async (ctx) => {
                await fn(fixture, ctx);
              }),
          }));
          await runSequential(tasks, passRate, eachOptions?.timeout);
        },
        concurrent: {
          async each(
            name: string | ((fixture: TFixture) => string),
            fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
            eachOptions?: EachOptions,
          ) {
            const tasks = fixtures.map((fixture) => ({
              label: resolveLabel(name, fixture),
              run: () =>
                setup(async (ctx) => {
                  await fn(fixture, ctx);
                }),
            }));
            await runConcurrent(
              tasks,
              passRate,
              eachOptions?.concurrency ?? 5,
              eachOptions?.timeout,
            );
          },
        },
      };
    }

    const samples = options.samples;
    return {
      async each(
        _name: string,
        fn: (ctx: TContext) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        const tasks = Array.from({ length: samples }, (_, i) => ({
          label: `sample ${i + 1}`,
          run: () =>
            setup(async (ctx) => {
              await fn(ctx);
            }),
        }));
        await runSequential(tasks, passRate, eachOptions?.timeout);
      },
      concurrent: {
        async each(
          _name: string,
          fn: (ctx: TContext) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          const tasks = Array.from({ length: samples }, (_, i) => ({
            label: `sample ${i + 1}`,
            run: () =>
              setup(async (ctx) => {
                await fn(ctx);
              }),
          }));
          await runConcurrent(
            tasks,
            passRate,
            eachOptions?.concurrency ?? 5,
            eachOptions?.timeout,
          );
        },
      },
    };
  }

  return extended;
};

export function trial(options: SamplesOptions): SamplesRunner;
export function trial<T>(options: FixturesOptions<T>): FixturesRunner<T>;
export function trial<T>(
  options: SamplesOptions | FixturesOptions<T>,
): SamplesRunner | FixturesRunner<T> {
  const passRate = options.passRate ?? 1;

  if ("fixtures" in options) {
    const fixtures = options.fixtures;
    return {
      async each(
        name: string | ((fixture: T) => string),
        fn: (fixture: T) => Promise<void>,
        eachOptions?: EachOptions,
      ) {
        const tasks = fixtures.map((fixture) => ({
          label: resolveLabel(name, fixture),
          run: () => fn(fixture),
        }));
        await runSequential(tasks, passRate, eachOptions?.timeout);
      },
      concurrent: {
        async each(
          name: string | ((fixture: T) => string),
          fn: (fixture: T) => Promise<void>,
          eachOptions?: EachOptions,
        ) {
          const tasks = fixtures.map((fixture) => ({
            label: resolveLabel(name, fixture),
            run: () => fn(fixture),
          }));
          await runConcurrent(
            tasks,
            passRate,
            eachOptions?.concurrency ?? 5,
            eachOptions?.timeout,
          );
        },
      },
    };
  }

  const samples = options.samples;
  return {
    async each(
      _name: string,
      fn: () => Promise<void>,
      eachOptions?: EachOptions,
    ) {
      const tasks = Array.from({ length: samples }, (_, i) => ({
        label: `sample ${i + 1}`,
        run: fn,
      }));
      await runSequential(tasks, passRate, eachOptions?.timeout);
    },
    concurrent: {
      async each(
        _name: string,
        fn: () => Promise<void>,
        options?: EachOptions,
      ) {
        const tasks = Array.from({ length: samples }, (_, i) => ({
          label: `sample ${i + 1}`,
          run: fn,
        }));
        await runConcurrent(
          tasks,
          passRate,
          options?.concurrency ?? 5,
          options?.timeout,
        );
      },
    },
  };
}

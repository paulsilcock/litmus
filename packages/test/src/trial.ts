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
}

interface SamplesRunner {
  each(name: string, fn: () => Promise<void>): Promise<void>;
  concurrent: {
    each(
      name: string,
      fn: () => Promise<void>,
      options?: EachOptions,
    ): Promise<void>;
  };
}

interface FixturesRunner<T> {
  each(name: string, fn: (fixture: T) => Promise<void>): Promise<void>;
}

function assertPassRate(passed: number, total: number, required: number) {
  const actual = passed / total;
  if (actual < required) {
    throw new Error(
      `Trial failed: ${passed}/${total} passed (${(actual * 100).toFixed(0)}%), required ${(required * 100).toFixed(0)}%`,
    );
  }
}

type SetupFn<TContext> = (
  use: (ctx: TContext) => Promise<void>,
) => Promise<void>;

interface ContextSamplesRunner<TContext> {
  each(name: string, fn: (ctx: TContext) => Promise<void>): Promise<void>;
}

interface ContextFixturesRunner<TFixture, TContext> {
  each(
    name: string,
    fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
  ): Promise<void>;
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
          _name: string,
          fn: (fixture: TFixture, ctx: TContext) => Promise<void>,
        ) {
          let passed = 0;
          for (const fixture of fixtures) {
            try {
              await setup(async (ctx) => {
                await fn(fixture, ctx);
              });
              passed++;
            } catch {
              // tracked as failure
            }
          }
          assertPassRate(passed, fixtures.length, passRate);
        },
      };
    }

    const samples = options.samples;
    return {
      async each(_name: string, fn: (ctx: TContext) => Promise<void>) {
        let passed = 0;
        for (let i = 0; i < samples; i++) {
          try {
            await setup(async (ctx) => {
              await fn(ctx);
            });
            passed++;
          } catch {
            // tracked as failure
          }
        }
        assertPassRate(passed, samples, passRate);
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
      async each(_name: string, fn: (fixture: T) => Promise<void>) {
        let passed = 0;
        for (const fixture of fixtures) {
          try {
            await fn(fixture);
            passed++;
          } catch {
            // tracked as failure
          }
        }
        assertPassRate(passed, fixtures.length, passRate);
      },
    };
  }

  const samples = options.samples;
  return {
    async each(_name: string, fn: () => Promise<void>) {
      let passed = 0;
      for (let i = 0; i < samples; i++) {
        try {
          await fn();
          passed++;
        } catch {
          // tracked as failure
        }
      }
      assertPassRate(passed, samples, passRate);
    },
    concurrent: {
      async each(
        _name: string,
        fn: () => Promise<void>,
        options?: EachOptions,
      ) {
        const limit = options?.concurrency ?? 5;
        let passed = 0;
        let index = 0;

        async function runNext() {
          while (index < samples) {
            index++;
            try {
              await fn();
              passed++;
            } catch {
              // tracked as failure
            }
          }
        }

        await Promise.all(
          Array.from({ length: Math.min(limit, samples) }, () => runNext()),
        );
        assertPassRate(passed, samples, passRate);
      },
    },
  };
}

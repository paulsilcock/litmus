import { test as baseTest } from "vite-plus/test";

import { Dsl } from "#litmus-test/dsl.ts";
import { evaluate as baseEvaluate } from "#litmus-test/evaluate/index.ts";

function isAsyncDisposable(value: unknown): value is AsyncDisposable {
  return (
    typeof value === "object" && value !== null && Symbol.asyncDispose in value
  );
}

/**
 * Build a customized test/eval namespace that injects a fresh `Dsl`
 * into every test via the `dsl` fixture and disposes it after the
 * test completes (via `[Symbol.asyncDispose]()` if the dsl implements
 * it). Test authors never construct or dispose a dsl themselves.
 *
 * @param factory - Called per-test. Closes over whatever the project
 *   set up in `beforeAll` (running SUT, config, etc.) and returns a
 *   fresh dsl. Sync or async.
 *
 * @returns `{ it, test, evaluate }`. `it` and `test` are the same
 *   extended vitest function under both names — pick whichever your
 *   team prefers. `evaluate` is the litmus eval primitive with the
 *   same `dsl` fixture wired in.
 *
 * @example
 * ```typescript
 * describe("bookshop", () => {
 *   let bookshop: RunningBookshop;
 *   beforeAll(async () => { bookshop = await bootstrapBookshop(); });
 *   afterAll(async () => { await bookshop.stop(); });
 *
 *   const { it, evaluate } = acceptance(
 *     () => new BookshopDsl(createBookshopDriver(bookshop)),
 *   );
 *
 *   it("customer can purchase a book", async ({ dsl }) => {
 *     await dsl.books.hasOnSale({ ... });
 *     // dsl auto-disposed after this test
 *   });
 *
 *   evaluate.scenarios(scenarios, { samples: 20 })(
 *     "agent handles bereavement",
 *     async (scenario, { dsl }) => { ... },
 *   );
 * });
 * ```
 */
export function acceptance<TDsl extends Dsl>(
  factory: () => Promise<TDsl> | TDsl,
) {
  const extendedTest = baseTest.extend<{ dsl: TDsl }>({
    // oxlint-disable-next-line no-empty-pattern -- vitest fixture parser requires object destructuring
    dsl: async ({}, use) => {
      const dsl = await factory();
      try {
        await use(dsl);
      } finally {
        if (isAsyncDisposable(dsl)) {
          await dsl[Symbol.asyncDispose]();
        }
      }
    },
  });

  const extendedEvaluate = baseEvaluate.extend<{ dsl: TDsl }>(async (use) => {
    const dsl = await factory();
    try {
      await use({ dsl });
    } finally {
      if (isAsyncDisposable(dsl)) {
        await dsl[Symbol.asyncDispose]();
      }
    }
  });

  return {
    it: extendedTest,
    test: extendedTest,
    evaluate: extendedEvaluate,
  };
}

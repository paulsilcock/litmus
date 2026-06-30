import { it } from "vite-plus/test";

import { evaluate } from "#litmus-test/evaluate/index.ts";
import { type Grader } from "#litmus-test/grader.ts";

const noop: Grader<string> = async () => ({ pass: true, reason: "" });

const guardedEval = evaluate
  .extend<{ x: string }>(async (use) => {
    await use({ x: "" });
  })
  .withPolicies({ "policy check": noop });

// @ts-expect-error re-registering an existing policy name is a compile error
guardedEval.withPolicies({ "policy check": noop });

// Type-only assertions; never invoked at runtime, but the function body is
// still type-checked so the @ts-expect-error directives apply.
function policiesFixtureInputConstraint(): void {
  // @ts-expect-error the policies fixture rejects non-string inputs
  guardedEval("number input", async ({ policies }) => policies(42));

  guardedEval.scenarios([{}])(
    "number input in scenarios",
    // @ts-expect-error same constraint in the scenarios-form body
    async (_, { policies }) => policies(42),
  );
}

it("re-registering a policy name is a compile-time error", () => {});

it("the policies fixture only accepts string inputs", () => {
  void policiesFixtureInputConstraint;
});

import { it } from "vite-plus/test";

import { evaluate } from "#litmus-test/evaluate/index.ts";
import { type Grader } from "#litmus-test/grader.ts";

const noop: Grader<string> = async () => ({ pass: true, reason: "" });

const guardedEval = evaluate
  .extend<{ x: string }>(async (use) => {
    await use({ x: "" });
  })
  .withGuardrails({ "policy check": noop });

// @ts-expect-error re-registering an existing guardrail name is a compile error
guardedEval.withGuardrails({ "policy check": noop });

// Type-only assertions; never invoked at runtime, but the function body is
// still type-checked so the @ts-expect-error directives apply.
function guardrailsFixtureInputConstraint(): void {
  // @ts-expect-error the guardrails fixture rejects non-string inputs
  guardedEval("number input", async ({ guardrails }) => guardrails(42));

  guardedEval.scenarios([{}])(
    "number input in scenarios",
    // @ts-expect-error same constraint in the scenarios-form body
    async (_, { guardrails }) => guardrails(42),
  );
}

it("re-registering a guardrail name is a compile-time error", () => {});

it("the guardrails fixture only accepts string inputs", () => {
  // Reference the type-only function so the compiler considers it used.
  void guardrailsFixtureInputConstraint;
});

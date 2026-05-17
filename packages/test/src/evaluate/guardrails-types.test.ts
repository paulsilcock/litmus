import { it } from "vite-plus/test";

import { evaluate } from "#litmus-test/evaluate/index.ts";
import { type Grader } from "#litmus-test/grader.ts";

const noop: Grader<string> = async () => ({ pass: true, reason: "" });

const guardedEval = evaluate
  .extend<{ x: string }>(async (use) => {
    await use({ x: "" });
  })
  .guardrails({ "policy check": noop });

// @ts-expect-error re-registering an existing guardrail name is a compile error
guardedEval.guardrails({ "policy check": noop });

// Type-only assertions; never invoked at runtime, but the function body is
// still type-checked so the @ts-expect-error directives apply.
function bodyReturnTypeConstraints(): void {
  // @ts-expect-error body must return a string when guardrails are registered
  guardedEval("returns a non-string", async () => 42);

  // @ts-expect-error body must return *something* when guardrails are registered
  guardedEval("returns void", async () => {});

  const cases = [{ id: "a" }, { id: "b" }];

  // @ts-expect-error scenarios body must return a string when guardrails are registered
  guardedEval.scenarios(cases)("non-string", async () => 42);

  // @ts-expect-error scenarios body must return *something* when guardrails are registered
  guardedEval.scenarios(cases)("void", async () => {});
}

it("re-registering a guardrail name is a compile-time error", () => {});

it("eval body return type is constrained by registered guardrails", () => {
  // Reference the type-only function so the compiler considers it used.
  void bodyReturnTypeConstraints;
});

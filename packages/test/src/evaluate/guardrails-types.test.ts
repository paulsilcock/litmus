import { it } from "vite-plus/test";

import { evaluate } from "#litmus-test/evaluate/index.ts";
import { type Grader } from "#litmus-test/grader.ts";

const noop: Grader<string> = async () => ({ pass: true, reason: "" });

const base = evaluate
  .extend<{ x: string }>(async (use) => {
    await use({ x: "" });
  })
  .guardrails({ "policy check": noop });

// @ts-expect-error re-registering an existing guardrail name is a compile error
base.guardrails({ "policy check": noop });

it("guardrail name uniqueness is enforced at compile time", () => {});

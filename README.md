# Litmus

> [!WARNING]
> **Pre-release — not yet published to npm.** Litmus is in active development. There's nothing to install yet, and the APIs will change without notice, so it isn't ready for production use. The code samples below show the intended shape of the API rather than something you can import today.

Litmus is a TypeScript framework for building reliable AI-powered apps. Most agent frameworks either reinvent or ignore decades of software engineering. Litmus exploits the overlap instead: proven primitives keep the deterministic parts simple, the same primitives make AI components tractable, and one testing discipline covers both deterministic logic and AI behaviour. Agent-as-actor falls out as a natural consequence: AI agents drive the same use cases that fire when a person clicks a button or runs a CLI command — different entrypoint, one system.

> **Agent or workflow?** An "agent" is an LLM choosing its own steps at runtime. It's tempting to personify AI and reach straight for full autonomy, but most features don't need it — at least to begin with. When the steps are known up front, prefer a _workflow_: compose `AiTask`s inside a `CommandHandler` with ordinary control flow. Easier to debug, cheaper, faster, and still tested through the same use case surface — and easier to evaluate, since known steps give you a state space you can reason about. Reach for [`Agent`](#agent) only when the path through the system genuinely can't be enumerated in advance.

## Why Litmus

Modern AI apps drift fast. LLM calls scatter through business logic. Evals lag the code they're meant to test. AI coding agents struggle to keep extending a codebase that's losing its shape.

**App as system; agent as actor.** Most agent frameworks treat the agent as the system. Litmus treats your application as the system. Steering an agent to behave reliably is its own discipline; Litmus doesn't pretend otherwise. What it does do is make the system the agent acts on stable, well-tested, and easy to extend — so the agent's job becomes "pick the right tool" rather than "reimplement the application". AI agents reach the system through the same use cases as a person hitting an HTTP route or running a CLI command.

**Bounded autonomy.** An `Agent` has a defined scope: the tools it can pick from, the goal it's pursuing. Tools are wrapped use cases, so an agent's reach into the system is the same surface a human or a script would use. The rest of your code never sees an LLM directly.

**TDD-first, including for AI.** Litmus encourages outside-in TDD — [acceptance tests](https://continuous-delivery.co.uk/downloads/ATDD%20Guide%2026-03-21.pdf) on the outside, smaller tests inside. Evaluations are acceptance tests with a probabilistic shell, not a separate testing universe, and written the same way: one behaviour at a time. The CLI adapter doubles as a fast feedback loop: pipe text at a use case from the terminal and explore an agent's behaviour without standing up a UI.

## Architecture

```mermaid
flowchart LR
    subgraph Actors
      U[User]
      A[AI Agent]
    end

    subgraph Entrypoints
      H[HTTP route]
      C[CLI command]
      T[Tool]
    end

    subgraph UseCases[Use cases]
      direction TB
      UC1[RegisterCustomer]
      UC2[AddBookToCart]
      UC3[CheckOut]
      UC4[GetCustomerOrders]
    end

    D[Domain<br/>Aggregates · Value objects · Domain events]
    I[Infrastructure<br/>Repositories · AiTasks · Logger]

    U --> H
    U --> C
    A --> T
    H --> UseCases
    C --> UseCases
    T --> UseCases
    UseCases --> D
    UseCases --> I
    D -. event .-> EH[Event handler]
    EH -.-> UseCases
```

A use case is **a thing a user wants the system to do** — realised as either a `CommandHandler` (changes state: loads aggregates, invokes domain methods, persists results) or a `QueryHandler` (returns a shape-tailored DTO; no state change). Business logic lives on the domain itself; use cases just orchestrate. Entrypoints — HTTP routes, CLI commands, an agent's tool call — adapt the outside world into use case invocations.

Domain events name something important that happened in the domain (`OrderPlaced`, `RefundIssued`). Other parts of the system can react — send a confirmation email, update inventory, notify a partner — without the originating use case knowing or caring. Reactions re-enter the system through the same use case layer as everything else.

## What it looks like

### Acceptance test

This is the outermost test of an example bookshop — it boots the real app and exercises a customer purchase the way a customer would.

The `dsl.*` calls are a small domain-specific language — methods named in the user's vocabulary. A protocol driver underneath translates each call into the action a real user would take (clicks in a browser, HTTP requests, CLI invocations). When the implementation changes — a new UI, a different transport, a refactored endpoint — only the driver moves; test code stays stable because it speaks in domain terms, not implementation terms.

Start with one failing test. It exercises the system the way a user would; it fails because the system doesn't yet support the behaviour. Drop into the inner loop and build what's missing until the test goes green. There's no fixed mapping from a DSL step to a piece of code — one might already be supported, another might need several use cases and a new aggregate.

```ts
import { it } from "vite-plus/test";

it("customer can purchase a book", async () => {
  await dsl.ensureBookIsInStock({
    title: "The Hobbit",
    author: "Tolkien",
    price: 12.99,
  });
  await dsl.ensureCustomerIsRegistered({
    name: "Alice",
    email: "alice@example.com",
  });

  await dsl.loginAsCustomer({ email: "alice@example.com" });
  await dsl.searchForBook({ author: "Tolkien" });
  await dsl.addBookToCart({ title: "The Hobbit" });
  await dsl.checkOut();

  await dsl.assertBookPurchased({ title: "The Hobbit" });
});
```

### Use case

Under the DSL, the work happens in use cases. Here's one from later in the same app — issuing a refund — a `CommandHandler` (or `QueryHandler`) with its input schema co-located, so HTTP routes, CLI commands, and agent tools all share one source of truth.

```ts
import { CommandHandler } from "@litmus/core";
import { inject, injectable } from "tsyringe";
import { z } from "zod";

export const IssueRefundSchema = z.object({
  chargeId: z.string(),
  reason: z.enum([
    "duplicate_charge",
    "fraudulent",
    "requested_by_customer",
    "product_damaged",
  ]),
});

// A use case — orchestrates, doesn't make business decisions.
@injectable()
export class IssueRefund extends CommandHandler<
  z.infer<typeof IssueRefundSchema>
> {
  constructor(
    @inject(PaymentRepository)
    private payments: IPaymentRepository,
  ) {
    super();
  }

  async handle(input: z.infer<typeof IssueRefundSchema>) {
    const charge = await this.payments.find(input.chargeId);
    // The rules live on Charge itself — already refunded, over the
    // captured total, outside the refund window. .refund() either
    // succeeds or throws. CRUD could check these before saving, but
    // then the rules get duplicated wherever a refund is issued. On
    // the domain, they exist once.
    charge.refund(input.reason);
    await this.payments.update(charge);
  }
}
```

### Agent

A use case can take an agent as a collaborator the same way it takes any other dependency. The agent itself uses tools — wrapped use cases plus a few internal utilities — to take action.

```ts
import { CommandHandler } from "@litmus/core";
import { injectable } from "tsyringe";

@injectable()
export class RespondToCustomerSupport extends CommandHandler<
  { conversationId: string; message: string },
  string
> {
  constructor(
    private agent: SupportAgent,
    private conversations: ConversationRepository,
  ) {
    super();
  }

  async handle(input: { conversationId: string; message: string }) {
    const { customerId } = await this.conversations.find(input.conversationId);
    return this.agent.run({ customerId, ...input });
  }
}
```

The agent picks tools from a `Toolbox` scoped per-agent — capability surface is explicit and auditable.

```ts
import { Agent, Toolbox } from "@litmus/core/ai";
import { toVercelTools } from "@litmus/ai/vercel";
import { type LanguageModel, generateText, stepCountIs, tool } from "ai";
import { inject, injectable } from "tsyringe";
import { z } from "zod";

const supportTools = new Toolbox()
  .tool("getCustomerOrders", GetCustomerOrders, GetCustomerOrdersSchema, {
    description: "List a customer's recent orders.",
  })
  .tool("getOrderDetails", GetOrderDetails, GetOrderDetailsSchema, {
    description: "Get full details for a specific order.",
  })
  .tool("issueRefund", IssueRefund, IssueRefundSchema, {
    description:
      "Issue a refund against a charge. Only after confirming the order, the customer, and the reason.",
  });

// A symbol token so each agent picks its own model configuration —
// different agents want different models, temperatures, and tool sets.
// Tests can inject Vercel's MockLanguageModelV3 here for deterministic
// coverage of the agent's routing and orchestration without calling an LLM.
export const SUPPORT_AGENT_MODEL = Symbol("SUPPORT_AGENT_MODEL");

@injectable()
export class SupportAgent extends Agent<
  { customerId: string; conversationId: string; message: string },
  string
> {
  constructor(
    @inject(SUPPORT_AGENT_MODEL) private model: LanguageModel,
    @inject(MessageRepository) private messages: IMessageRepository,
  ) {
    super();
  }

  async run(input: {
    customerId: string;
    conversationId: string;
    message: string;
  }) {
    // Conversation history is infra, not a tool — the agent calls it
    // programmatically. Keeps the agent decoupled from any particular
    // store, which makes it cheap to fake in tests.
    const history = await this.messages.byConversation(input.conversationId);

    const { text } = await generateText({
      model: this.model,
      tools: {
        // System tools — use cases. Side effects (notifications,
        // follow-up workflows) fire from domain event handlers, not
        // from the agent.
        ...toVercelTools(supportTools),
        // Internal tool — pure agent utility, no system interaction.
        calculator: tool({
          description: "Evaluate an arithmetic expression like '49.99 * 0.5'.",
          parameters: z.object({ expression: z.string() }),
          execute: async ({ expression }) =>
            Function(`"use strict"; return (${expression})`)(),
        }),
      },
      messages: [...history, { role: "user", content: input.message }],
      stopWhen: stepCountIs(10),
    });

    await this.messages.add({
      conversationId: input.conversationId,
      role: "user",
      content: input.message,
    });
    await this.messages.add({
      conversationId: input.conversationId,
      role: "assistant",
      content: text,
    });

    return text;
  }
}
```

Two things to notice. The agent can hallucinate, pick the wrong customer, or fabricate a reason — but every refund still goes through `charge.refund()`. The domain enforces the rules; the LLM can be confidently wrong without storing damage.

And `IssueRefund` doesn't know who's calling it. Human staff in an admin UI hit it via an HTTP route, back-office scripts via the CLI, the AI agent via the tool. One implementation, one test surface, no parallel path to bypass a rule from the "agent side".

### Evaluation

That agent is non-deterministic: the same scenario can pass on one run and fail on the next. The DSL is the same. The assertions are the same. The body just runs many times against varied scenarios and asserts a pass rate.

```ts
import { evaluate, UserSimulator } from "@litmus/test";

evaluate.scenarios(damageComplaints, { samples: 20, passRate: 0.9 })(
  "customer gets a replacement when their book arrived damaged",
  async (complaint) => {
    await dsl.aCustomerHasOrdered({
      email: complaint.email,
      title: complaint.title,
    });

    const customer = new UserSimulator({
      model,
      persona: complaint.persona,
      goal: "get a replacement for my damaged book",
    });

    await dsl.customerSpeaksToSupport({
      email: complaint.email,
      asUser: customer,
    });

    // The goal, checked deterministically — a replacement order exists.
    await dsl.assertReplacementOrdered({ to: complaint.email });
  },
);
```

Both deterministic and probabilistic tests run as ordinary tests in CI. Synthesised scenarios are hash-pinned so the suite is reproducible across runs and machines.

This one is expensive, though: it boots the app, drives a simulated user through a whole conversation, and repeats that twenty times. Keep a handful of these at most — most checks belong closer to the component that failed.

Notice the eval asserts a goal the customer cares about, not a list of ways the agent might misbehave. Writing those up front is the most common way eval suites go wrong. See [Evaluating AI features](#evaluating-ai-features).

`packages/test-acceptance` is a worked example — domain, use cases, entrypoints, and ATDD end-to-end.

## Evaluating AI features

**Small test, minimal implementation, refactor, repeat.** Write one failing test for one behaviour, do the simplest thing that passes it, then improve the design before moving on. The refactor step is what keeps a codebase healthy as it grows, and nothing about an AI feature exempts it. Evals are written in that same loop — the next one comes from what building the last one taught you, not from a list drawn up in advance.

**A new AI feature is more than LLM calls.** It usually needs new use cases, domain rules, persistence, entrypoints — ordinary code, and usually the bulk of the work. That part gets ordinary TDD. Only the non-deterministic boundary needs an eval.

**Day 0: start from the goal.** With no usage yet, you still know what the feature is for. Write one acceptance test asserting the goal was met from the user's perspective ("a customer can get a refund") and check it deterministically. A failure mode you haven't seen is a guess, and evals for guesses grow the design to satisfy behaviour that may never occur.

**Then observe.** Later evals come from failures you've seen: read traces, cluster them, write an eval for one. With no users yet, a domain expert reviewing output is the same loop with an earlier observer. What they reject becomes an eval, or seeds for `synthesize`.

**Scenario sets.** `synthesize` fans hand-written seeds out into a larger set. Seeds describe situations the system will meet, not the responses it should give — the assertions define correctness. Cover the axes that actually vary (user type, complexity, edge cases); a gap in the seeds is a gap in coverage. Start with a handful while the prompt is still moving, and scale up once the eval is stable — more scenarios surface rare failures, more samples per scenario measure reliability on a single input. Commit the generated files.

**Deterministic first, judges where you must.** Deterministic assertions are cheap, fast, and need no validating, so use one wherever the property allows. Some don't — whether a reply acknowledged a problem before proposing a fix, whether a summary invented a claim — and those need a judge. A judge is another non-deterministic component, so it needs its own evaluation against labels from someone who holds the real quality bar — on the order of a hundred labelled examples, kept current as the product moves. Reach for one deliberately: an unaligned judge applies a standard no expert holds, on every run. Keep each judge to one question with a binary verdict. "Was the reply empathetic?" won't get a consistent answer from two people. "Did the reply acknowledge the damage before offering a replacement?" will.

```ts
import { llmJudge } from "@litmus/test";

// One question, pass/fail — so it can be aligned against expert labels.
const acknowledgedDamage = llmJudge<string>({
  model,
  rubric:
    "The reply acknowledges the damaged book before offering a replacement.",
});
```

**Outside-in, then inward.** A system-tier eval answers whether the goal was met, and it's the most expensive test you can write — a booted app, a simulated conversation, many samples. Keep a few; put the rest closer to the failure, on a single `AiTask`. Most failures don't need the full conversation either: reproduce the simplest version first, and if one turn still fails, context was never the problem. When it genuinely is, replay the real first N-1 turns of the conversation that failed and test what comes next. A real prefix beats a re-simulated one, and it replays deterministically.

**Plateaus are architectural.** When a failure cluster stops responding to prompt changes, change the structure: decompose into smaller `AiTask`s, push rules into domain code, fix retrieval, fine-tune last. Do it against a measured cluster, not a hunch.

## Packages

```
packages/
├── core             Domain primitives, use case types (CommandHandler/QueryHandler), DI conventions
├── http             HTTP entrypoint built on Hono — routeHandler, error → status mapping, SSE streaming
├── cli              CLI entrypoint with typed command groups and a unix socket transport
├── db               Postgres support via Drizzle
├── log              Pino-backed structured logging with AsyncLocalStorage context propagation
├── ai               AI SDK bridges — currently Vercel AI SDK
├── test             ATDD + AI eval toolkit (evaluate, synthesize, UserSimulator, llmJudge, drivers)
└── test-acceptance  The bookshop — realistic example app exercising everything end-to-end
```

Sub-package READMEs (and hyperlinks from this tree) follow in a separate PR.

## License

MIT.

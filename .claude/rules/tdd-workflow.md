# TDD Workflow

TDD is a design methodology, not a testing strategy. Each test is a question: "what should happen when...?" The answer shapes the interface, and the interface shapes the design. Implementation is discovery — we learn what the code should be by building it one behaviour at a time.

**One test at a time. Always.**

Default to **autonomous** mode: clarify the behaviours, then run the loop independently. Switch to **guided** mode (propose each test, wait for approval) only when the user explicitly asks for it.

TDD applies by default to changes that **add, change, or fix behaviour**. It does **not** apply by default to pure docs, mechanical renames, formatting-only changes, read-only analysis, or explicitly requested throwaway spikes.

## Before Writing Any Test

Clarify the desired behaviour. Ask:

- What outcome does the user/caller expect?
- What are the inputs and observable effects?
- Are there edge cases or failure modes we know about?

Don't enumerate classes or components — list **behaviours**. The remaining behaviours will emerge as implementation progresses.

## RED → GREEN → REFACTOR

1. **RED** — Write one failing test that describes a desired behaviour. Focus on the public interface: inputs, outputs, observable effects. If ideas are easy to express in the test, they will be easy to express when someone uses the code. The test must compile (add stubs if needed).

2. **GREEN** — Ask: "what's stopping this test from passing right now?" Name that one thing. Fix it. Reassess. If the answer is a collaborator that doesn't exist, drop down and build it with its own RED → GREEN → REFACTOR loop — the collaborator's behaviour should help the consumer fulfil its responsibility. If the answer is one line of code, write that line. Do the simplest thing that works.

3. **REFACTOR** — Improve the design without changing behaviour. This is where strategic thinking happens — separation of concerns, modularity, cohesion. This step is not optional cleanup. Re-read the change as a reviewer would: error handling gaps, leaked internals, inconsistencies with the rest of the codebase, missed failure modes. Passing tests don't catch any of that. If nothing needs refactoring, say so.

4. **Review** — Are any proposed tests now redundant? Have new behaviours emerged? Then write the next test.

## What Makes a Good Test

- Tests describe **what the system should do**, not how it does it.
- A test should respond to behaviour changes and be insensitive to structure changes.
- If refactoring forces test changes, the tests are coupled to implementation.
- Test names read as specifications of observable behaviour. Never name a factory, class, option key, or framework API in the title.
  - Bad: `"createRouteHandler propagates Env so c.get is strictly typed"`
  - Bad: `"input hook combines validated data with context to produce handler input"`
  - Good: `"middleware variables are type-safe inside the input projection"`
  - Good: `"middleware-attached values can be projected into the handler input"`
- Before writing a new test, check whether an existing test already asserts this behaviour in any configuration. If a broader-scenario test subsumes it, don't write the narrower one — duplicates only surface when you audit later, and then they're work to remove. Write the most comprehensive test first.

## Acceptance Tests (Outer-Inner Loop)

For features where multiple classes must collaborate, wrap the inner loop in an outer acceptance test. Not every change needs one — use sparingly.

1. Write ONE failing acceptance test using the public API as a developer would. It reads like documentation.
2. Ask: "why does it fail? What's the first missing piece?" Drop into the inner loop.
3. Come back up. Does the acceptance test pass? If not, identify the next missing piece and repeat.
4. Only after it passes, consider whether a second acceptance test is needed.

## DO NOT

- **DO NOT write multiple tests before getting the first one passing.**
- **DO NOT write implementation before the failing test.**
- **DO NOT plan classes, dependencies, or architecture upfront.** Plan which behaviours to test. The implementation emerges.
- **DO NOT batch work.** Every RED, GREEN, and REFACTOR is a checkpoint.
- **DO NOT describe what you "need to build" in the GREEN phase.** Describe what's missing — what gap is preventing the test from passing right now?

## Testing Style

- **Default: Detroit/classicist** — real objects, assert on outcomes. Use **fakes** (lightweight in-memory implementations of an interface, e.g. PGlite instead of Postgres) when real infrastructure is impractical. Fakes behave like the real thing but are fast and disposable. They are not mocks — they have real logic, not expectations.
- **At boundaries: London/mockist** — spy on collaborator contracts when the interaction is the behaviour. Use mocks (objects that record calls and assert expectations) sparingly and only at true boundaries.
- **Acceptance tests: real objects and fakes only.** No mocks.

## Stubs

- When a test needs types that don't exist yet, add minimal stubs so it compiles.
- **Stubs must not make the test pass.** A stub exists only to satisfy the compiler — it should throw or return nothing. If your stubs contain real logic, the test will go GREEN before you've built anything, defeating the entire RED → GREEN → REFACTOR loop. The implementation is built incrementally through the inner loop, not front-loaded into stubs.
- No "stub" or "not yet implemented" comments.

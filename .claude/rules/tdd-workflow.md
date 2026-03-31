# TDD Workflow

This project follows test-driven development. Before writing any implementation code, ask the user how they want to work:

1. **Guided mode** — propose each test, wait for approval, implement, wait for approval. One behaviour at a time.
2. **Autonomous mode** — clarify which behaviours to test, then run the RED/GREEN/REFACTOR loop independently. Present the results for review.

Whichever mode, these rules apply:

- Write a failing test before writing implementation code.
- Implement the minimum code to make the test pass.
- Only add code that a test demands — no speculative features.
- Question whether each test is valuable and not coupled to implementation details.
- Tests should describe expected behaviour and outcomes, not implementation mechanics.
- When writing tests that rely on types that don't exist yet, add minimal stubs so the test compiles.
- Don't add comments like "stub" or "not yet implemented" to placeholder code. The test itself should make it clear that the code is a placeholder.

# Conventions

- Test files are co-located with source files using a `.test.ts` suffix.
- Use the `#litmus/*` import alias for absolute imports within `@litmus/core`.
- Import test utilities from `vite-plus/test`, not `vitest`.
- Run `vp test` to run tests, `vp check` to run format + lint + typecheck.

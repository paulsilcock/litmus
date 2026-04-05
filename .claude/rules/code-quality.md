# Code Quality

- Never use `as` type assertions. Use proper type annotations (`const x: Type = ...`) or fix the underlying types. The `no-unsafe-type-assertion` lint rule enforces this.
- Always run `vp check` (not just `vp test`) before considering a change complete — it catches type errors and lint violations that tests miss.

# Conventions

- Test files are co-located with source files using a `.test.ts` suffix.
- Acceptance tests live at `packages/core/src/acceptance.test.ts`.
- Shared test fixtures (aggregates, schemas, repos) live in `packages/core/src/test-support/fixtures.ts`.
- Use the `#litmus/*` import alias for absolute imports within `@litmus/core`.
- Import test utilities from `vite-plus/test`, not `vitest`.

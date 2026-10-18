# Code Quality

- Never use `as` type assertions. Use proper type annotations (`const x: Type = ...`) or fix the underlying types. The `no-unsafe-type-assertion` lint rule enforces this.
- Always run `vp check` (not just `vp test`) before considering a change complete — it catches type errors and lint violations that tests miss.
- The linter is **oxlint**. Suppression syntax is `// oxlint-disable <rule>` / `// oxlint-enable <rule>` (or `// oxlint-disable-next-line <rule>`). Never write `// biome-ignore`, `// eslint-disable`, or any other linter's syntax.

# Commits and Builds

- PR titles follow [Conventional Commits](https://www.conventionalcommits.org/): `type: description`, with a lowercase type such as `feat`, `fix`, `perf`, `docs`, `test`, `refactor`, `ci` or `chore`. PRs are squash-merged, so the title becomes the commit message on `main`, and the release notes are built from it: `feat`, `fix` and `perf` appear in them, other types do not. Choose the type by what the change means to people using the packages.
- Always include `pnpm-lock.yaml` in commits that change any `package.json` or `pnpm-workspace.yaml`. The lockfile must stay in sync or CI resolves different versions.
- `vp pack` and `vp run -r build` rewrite `exports` in `package.json` from `./src/*.ts` to `./dist/*.mjs`. After running either, check `git diff` for export-path changes and restore source paths before committing.

# Conventions

- Test files are co-located with source files using a `.test.ts` suffix.
- Acceptance tests live at `packages/core/src/acceptance.test.ts`.
- Shared test fixtures (aggregates, schemas, repos) live in `packages/core/src/test-support/fixtures.ts`.
- Use the `#litmus/*` import alias for absolute imports within `@litmus-ts/core`.
- Import test utilities from `vite-plus/test`, not `vitest`.

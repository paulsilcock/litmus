import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts", "@litmus/test/vitest-setup"],
    // fixtures/ dirs hold intentionally-failing files invoked on demand
    // by subprocess-based acceptance tests; skip auto-discovery.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      ".claude/worktrees/**",
    ],
    tags: [
      {
        name: "bookshop-acceptance",
        description:
          "Bookshop acceptance suite. Run per-driver by the CI matrix; filter with --tags-filter='!bookshop-acceptance' to exclude.",
      },
    ],
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    ignorePatterns: [".claude/worktrees/**"],
    printWidth: 80,
    sortImports: true,
  },
  lint: {
    ignorePatterns: [".claude/worktrees/**"],
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-unsafe-type-assertion": "error",
      "no-relative-parent-imports": "error",
    },
  },
  run: {
    cache: true,
  },
});

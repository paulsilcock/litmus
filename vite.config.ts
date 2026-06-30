import { defineConfig } from "vite-plus";

import { WORKTREE_EXCLUDE } from "./vite.shared.ts";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts", "@litmus/test/vitest-setup"],
    // fixtures/ dirs hold intentionally-failing files invoked on demand
    // by subprocess-based acceptance tests; skip auto-discovery.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      WORKTREE_EXCLUDE,
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
    ignorePatterns: [WORKTREE_EXCLUDE],
    printWidth: 80,
    sortImports: true,
  },
  lint: {
    ignorePatterns: [WORKTREE_EXCLUDE],
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

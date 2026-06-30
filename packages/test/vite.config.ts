import { defineConfig } from "vite-plus";

import { WORKTREE_EXCLUDE } from "../../vite.shared.ts";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  test: {
    // fixtures/ holds intentionally-failing files invoked on demand by
    // subprocess-based tests inside evaluate.test.ts; skip auto-discovery.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      WORKTREE_EXCLUDE,
    ],
  },
});

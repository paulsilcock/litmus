import { defineConfig } from "vite-plus";

import { WORKTREE_EXCLUDE } from "../../../../vite.shared.ts";

// Used by trial-vitest-integration.test.ts to spawn vitest against
// fixture files in this directory. The parent vite.config.ts excludes
// fixtures/** from auto-discovery; this config opts them back in.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    exclude: ["**/node_modules/**", "**/dist/**", WORKTREE_EXCLUDE],
  },
});

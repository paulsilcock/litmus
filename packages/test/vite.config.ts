import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    deps: {
      // tsdown <0.23 compatibility: resolve external dependency subpaths.
      // Remove to preserve subpath imports as written (the new default).
      // https://tsdown.dev/options/dependencies#deps-resolvedepsubpath
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
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
      "**/.claude/worktrees/**",
    ],
  },
});

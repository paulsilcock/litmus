import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    dts: {
      tsgo: true,
    },
    exports: true,
  },
  test: {
    // fixtures/ holds intentionally-failing files invoked on demand by
    // subprocess-based tests inside trial.test.ts; skip auto-discovery.
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
  },
});

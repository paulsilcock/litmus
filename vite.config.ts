import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts", "@litmus/test/vitest-setup"],
    // fixtures/ dirs hold intentionally-failing files invoked on demand
    // by subprocess-based acceptance tests; skip auto-discovery.
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
  },
  staged: {
    "*": "vp check --fix",
  },
  fmt: {
    printWidth: 80,
    sortImports: true,
  },
  lint: {
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

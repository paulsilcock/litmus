import { defineConfig } from "vite-plus";

// Files matching this pattern are cross-driver acceptance suites run by
// a dedicated CI matrix job, which sets LITMUS_MATRIX=1 to opt back in.
// Excluded from the main suite to avoid running the same scenarios twice.
const matrixOnly =
  process.env["LITMUS_MATRIX"] === "1"
    ? []
    : ["**/test-acceptance/acceptance.test.ts"];

export default defineConfig({
  test: {
    setupFiles: ["./test-setup.ts", "@litmus/test/vitest-setup"],
    // fixtures/ dirs hold intentionally-failing files invoked on demand
    // by subprocess-based acceptance tests; skip auto-discovery.
    exclude: [
      "**/node_modules/**",
      "**/dist/**",
      "**/fixtures/**",
      ...matrixOnly,
    ],
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

import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    setupFiles: ["@litmus/test/vitest-setup"],
    // Browser-driven evals against a live third party are slow and
    // network-bound; give them room and never run them in parallel by
    // default. Individual evals opt into concurrency explicitly.
    testTimeout: 120_000,
    hookTimeout: 120_000,
  },
});

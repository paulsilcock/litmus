import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: {
      index: "src/index.ts",
      "drizzle/postgres/index": "src/drizzle/postgres/index.ts",
      "drizzle/postgres/test/index": "src/drizzle/postgres/test/index.ts",
      "test-support/fixtures": "src/test-support/fixtures.ts",
    },
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
});

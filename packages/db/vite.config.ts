import { defineConfig } from "vite-plus";

export default defineConfig({
  pack: {
    entry: [
      "src/index.ts",
      "src/drizzle/postgres/index.ts",
      "src/drizzle/postgres/test/index.ts",
    ],
    dts: {
      tsgo: true,
    },
    exports: true,
  },
});

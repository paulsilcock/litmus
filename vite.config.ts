import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    include: ["packages/**/*.test.ts"],
    globals: true,
  },
});

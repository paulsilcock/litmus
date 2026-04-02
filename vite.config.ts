import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  fmt: {},
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    rules: {
      "no-unsafe-type-assertion": "error",
    },
  },
  run: {
    cache: true,
  },
});

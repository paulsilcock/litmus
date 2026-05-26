# Code Quality Rules

- Use Vite+ commands (`vp ...`) for install, checks, tests, and task execution.
- Run `vp check` before considering changes complete.
- In tests, use `it()` and import test utilities from `vite-plus/test`.
- Do not use `as` type assertions.
- Keep behavioural changes narrowly scoped and test-backed.

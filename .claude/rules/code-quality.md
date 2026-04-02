# Code Quality

- Never use `as` type assertions. Use proper type annotations (`const x: Type = ...`) or fix the underlying types. The `no-unsafe-type-assertion` lint rule enforces this.
- Always run `vp check` (not just `vp test`) before considering a change complete — it catches type errors and lint violations that tests miss.

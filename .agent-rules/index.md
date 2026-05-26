# Canonical Agent Rules

These rules are tool-neutral and authoritative. Both Claude (via `CLAUDE.md`) and
Codex (via `AGENTS.md`) follow them, so there is exactly one copy of each rule.

Read and follow these documents:

- [`repo-overview.md`](./repo-overview.md) — what Litmus is, the packages, and the Vite+ (`vp`) toolchain.
- [`tdd-workflow.md`](./tdd-workflow.md) — how to develop behaviour changes test-first.
- [`code-quality.md`](./code-quality.md) — linting, build, commit, and convention rules.

## Default workflow

- Behaviour changes use **autonomous TDD** by default — clarify the behaviours, then run independently.
- Write one failing test at a time.
- Follow `RED → GREEN → REFACTOR`.
- Ask clarifying questions only when expected behaviour is ambiguous or a product/API decision is needed.

TDD applies by default to changes that **add, change, or fix behaviour**.

TDD does **not** apply by default to pure docs, mechanical renames, formatting-only
changes, read-only analysis, or explicitly requested throwaway spikes.

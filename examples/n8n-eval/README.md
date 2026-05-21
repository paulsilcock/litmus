# n8n eval (work in progress)

An evaluation suite that exercises [n8n](https://n8n.io)'s chat-based AI
workflow builder using Litmus primitives. The goal: probe whether the
AI builder picks the simplest set of nodes for a given task, rather
than reaching for code nodes or inflating the graph.

## What this branch is for

Translating an existing YAML eval spec into a Litmus eval and running
it against a real n8n cloud account. Tracking issue / conversation:
the assistant has the source spec in chat context.

## Planned shape

- **Driver** — `N8nChatDriver` extending `@litmus/test`'s
  `BrowserDriver`. Drives the chat panel via Playwright. Auth via
  pre-captured `STORAGE_STATE` JSON (no passwords in code).
- **Personas** — typed enum of `proficiency`, `patience`, `clarity`,
  `graph_engagement`, `disposition`. Translated to a prompt fragment
  consumed by `UserSimulator`.
- **Graders** — one `llmJudge` per criterion (global + specific).
- **Scenarios** — `marketer-chat-only` first, `trials: 1`. Other two
  scenarios from the spec get wired in once selectors are stable.

## Why no code yet

Selectors against n8n's UI need to be written with the browser
visible. That work happens in a local Claude Code session with
Playwright running headed, not in the cloud container that
originated this branch.

## Local setup (for when development resumes)

```bash
git fetch origin
git worktree add ../litmus-n8n claude/sharp-lamport-bcQwl
cd ../litmus-n8n

# Capture an authenticated n8n session once
vp dlx playwright install --with-deps chromium
vp dlx playwright codegen --save-storage=examples/n8n-eval/.auth/n8n.json https://app.n8n.cloud

# Then run the eval
STORAGE_STATE=examples/n8n-eval/.auth/n8n.json vp test --filter n8n-eval
```

`.auth/` is gitignored — storage state is per-developer.

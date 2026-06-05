# @litmus/eval-sonos

Private, ephemeral package. Not published.

A driver + DSL + eval suite for the **live Sonos customer-support chatbot**
at <https://support.sonos.com/en-gb/contact>, built to run the S1/S2
compatibility scenarios in `sonoss1s2evalspec.yaml`.

## Status: driver written, live selectors UNVERIFIED

This package was scaffolded in an environment that **could not reach the
live site or run a browser**, so the actual DOM of the Sonos chat widget
has not been confirmed. Specifically:

- No Playwright MCP server was available.
- The sandbox egress is allow-listed: `support.sonos.com`, `google.com`,
  and even the Playwright browser CDN all returned `403`; only the npm
  registry was reachable. So neither the Chromium binary nor the site
  could be fetched.
- Sonos additionally bot-blocks plain HTTP clients (litmus's
  `BrowserDriver` UA-spoofing is what's meant to get past that — but it
  still needs a browser and a network route).

Everything that depends on Sonos's real markup is therefore isolated in
**one file, `src/selectors.ts`**, with clearly-marked guesses. The
mechanics around them are real and covered by tests against a local
fixture.

## Layout

```
src/
  selectors.ts              ← the ONE place to update once you see the real DOM
  sonos-chat-driver.ts      BrowserDriver subclass: openChat / awaitGreeting / send
  sonos-chat-dsl.ts         thin domain language over the driver
  explore.test.ts           the exploration harness (gated, writes artifacts/)
  sonos-chat-driver.test.ts driver mechanics vs. a local fake widget (no network)
  sonos-s1s2.test.ts        the real eval suite (gated; UserSimulator + graders)
  fixtures/chat.html        local stand-in for a hosted chat widget
```

## Step 1 — explore the live UI (do this first)

From a machine with a browser **and** network access to Sonos:

```bash
vp install
vp dlx playwright install --with-deps chromium
LITMUS_SONOS_LIVE=1 vp test explore      # or: vp run explore
```

This launches the UA-spoofing browser at the contact page and writes
`packages/eval-sonos/artifacts/`:

- `sonos-contact-report.json` — iframes, third-party script hosts (these
  reveal the chat platform: Salesforce / Zendesk / Ada / Gladly / …),
  every candidate button, and the accessibility tree.
- `sonos-contact.png` — full-page screenshot.

Set `LITMUS_SONOS_HEADED=1` to watch it run.

## Step 2 — fill in the selectors

Open `src/selectors.ts` and update each `ElementQuery` from what the
report shows. If the chat renders inside an `<iframe>`, set
`CHAT_FRAME_CSS` to its selector. Then confirm the driver works:

```bash
LITMUS_SONOS_LIVE=1 vp test explore   # re-run; the launcher/composer should resolve
```

The driver-mechanics tests (`sonos-chat-driver.test.ts`) run against a
local fixture and need only a browser, not the network:

```bash
vp test sonos-chat-driver
```

## Step 3 — run the real evals

Needs a browser, network access to Sonos, and a model provider (resolved
through the AI SDK gateway):

```bash
export LITMUS_SONOS_LIVE=1
export LITMUS_SONOS_SIM_MODEL=anthropic/claude-sonnet-4.5     # optional override
export LITMUS_SONOS_JUDGE_MODEL=anthropic/claude-sonnet-4.5   # optional override
# plus whatever your AI gateway/provider needs (e.g. AI_GATEWAY_API_KEY)
vp test sonos-s1s2
```

A simulated customer (`UserSimulator`) plays each scenario's persona; the
transcript is graded against the spec's criteria (LLM-as-judge) and
guardrails. `samples: 5`, `passRate: 0.8` per scenario, matching the
spec's `sample_runs_per_scenario`.

## Without `LITMUS_SONOS_LIVE`

The exploration and eval suites are skipped; only the local
fixture-based driver tests run. This keeps the package safe in CI.

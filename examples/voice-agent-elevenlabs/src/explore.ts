/**
 * Exploration script for the ElevenLabs docs voice agent.
 *
 * The widget at the bottom-right of the docs page is rendered into the page
 * via a web component with a closed shadow root, so vanilla
 * `document.querySelectorAll` won't see it. Playwright's locator engine does
 * pierce shadow DOM though, so we lean on `getByText` / `getByRole`.
 *
 * Output:
 *  - `out/01-initial.png`, `out/02-chat-open.png`, `out/03-voice-active.png`
 *  - `out/findings.md`
 */

import "dotenv/config";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { BaseBrowserDriver } from "@litmus/test";
import type { Page } from "playwright";

declare global {
  // Installed by the PC counter init script inside the browser. Only valid
  // inside `page.evaluate` callbacks.
  // oxlint-disable-next-line no-var
  var __pcCount: number | undefined;
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = join(__dirname, "..", "out");
mkdirSync(OUT, { recursive: true });

interface NetworkObservation {
  websockets: string[];
}

class ExplorerDriver extends BaseBrowserDriver {
  readonly observation: NetworkObservation = { websockets: [] };

  pageRef(): Page {
    return this.page;
  }

  async navigate(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: "domcontentloaded" });
  }

  async screenshot(name: string): Promise<string> {
    const path = join(OUT, `${name}.png`);
    await this.page.screenshot({ path, fullPage: false });
    return path;
  }

  attachNetworkListeners(): void {
    this.page.on("websocket", (ws) => {
      this.observation.websockets.push(ws.url());
      console.log("  [ws] opened:", ws.url());
    });
    this.page.on("console", (msg) => {
      const type = msg.type();
      if (type === "error" || type === "warning") {
        console.log(`  [console.${type}]`, msg.text());
      }
    });
    this.page.on("pageerror", (err) => {
      console.log("  [pageerror]", err.message);
    });
    this.page.on("request", (req) => {
      const url = req.url();
      if (
        url.includes("convai") ||
        url.includes("agents") ||
        url.includes("voice") ||
        url.includes("ws://") ||
        url.includes("wss://") ||
        url.startsWith("https://api.elevenlabs")
      ) {
        console.log(`  [req] ${req.method()} ${url}`);
      }
    });
  }

  async installPcCounter(): Promise<void> {
    await this.context.addInitScript(`
      globalThis.__pcCount = 0;
      const Real = globalThis.RTCPeerConnection;
      if (Real) {
        globalThis.RTCPeerConnection = class extends Real {
          constructor(...args) {
            super(...args);
            globalThis.__pcCount++;
          }
        };
      }
    `);
  }

  async pcCount(): Promise<number> {
    return this.page.evaluate("globalThis.__pcCount ?? 0");
  }

  async sleep(ms: number): Promise<void> {
    await this.page.waitForTimeout(ms);
  }

  async grantMicrophone(): Promise<void> {
    await this.context.grantPermissions(["microphone"], {
      origin: "https://elevenlabs.io",
    });
  }
}

async function reportAllRoles(page: Page): Promise<string> {
  const roles = [
    "button",
    "link",
    "textbox",
    "menuitem",
    "switch",
    "checkbox",
    "tab",
  ] as const;
  const lines: string[] = [];
  for (const role of roles) {
    const locator = page.getByRole(role);
    const count = await locator.count();
    if (count === 0) continue;
    lines.push(`### role="${role}" (${count})`);
    for (let i = 0; i < Math.min(count, 40); i++) {
      const el = locator.nth(i);
      let name = "";
      let text = "";
      try {
        name = (await el.getAttribute("aria-label")) ?? "";
        text = (await el.textContent({ timeout: 500 })) ?? "";
      } catch {
        // ignore
      }
      const display = (name || text).trim().replace(/\s+/g, " ").slice(0, 80);
      if (display) lines.push(`- ${display}`);
    }
  }
  return lines.join("\n");
}

async function run(): Promise<void> {
  const driver = new ExplorerDriver({
    baseUrl: "https://elevenlabs.io",
    headless: true,
    audio: true,
    launchArgs: [
      "--use-fake-device-for-media-stream",
      "--use-fake-ui-for-media-stream",
    ],
  });

  await driver.init();
  await driver.grantMicrophone();
  await driver.installPcCounter();
  driver.attachNetworkListeners();

  const findings: string[] = ["# Exploration findings\n"];
  const page = driver.pageRef();

  // -- Step 1: load --------------------------------------------------------
  console.log("\n[1] Loading docs page...");
  await driver.navigate("/docs/overview/intro");
  await driver.sleep(3000);
  await driver.screenshot("01-initial");

  // -- Step 2: find + click "Ask anything" --------------------------------
  console.log('\n[2] Locating "Ask anything"...');
  const askLocator = page.getByText("Ask anything", { exact: false }).first();
  const askCount = await page
    .getByText("Ask anything", { exact: false })
    .count();
  console.log(`  found ${askCount} match(es) via getByText (pierces shadow)`);
  findings.push(
    `## 2. "Ask anything" trigger\n- getByText matches: \`${askCount}\`\n`,
  );

  if (askCount > 0) {
    try {
      await askLocator.click({ timeout: 5000 });
      await driver.sleep(2500);
      await driver.screenshot("02-after-ask-click");
      console.log("  clicked Ask anything");
      findings.push("- Click: succeeded\n");
    } catch (err) {
      console.log("  click failed:", err instanceof Error ? err.message : err);
      findings.push(
        `- **Click failed**: \`${err instanceof Error ? err.message : String(err)}\`\n`,
      );
    }
  }

  // -- Step 2b: dismiss T&C if it appears ----------------------------------
  console.log("\n[2b] Checking for T&C dialog...");
  const acceptButton = page.getByRole("button", { name: /accept/i }).first();
  if ((await acceptButton.count()) > 0) {
    try {
      await acceptButton.click({ timeout: 3000 });
      await driver.sleep(2500);
      await driver.screenshot("02b-after-accept");
      console.log("  accepted T&C");
      findings.push("## 2b. T&C dialog\n- Accepted\n");
    } catch (err) {
      console.log("  accept failed:", err instanceof Error ? err.message : err);
      findings.push(
        `## 2b. T&C dialog\n- **Accept failed**: \`${err instanceof Error ? err.message : String(err)}\`\n`,
      );
    }
  } else {
    findings.push("## 2b. T&C dialog\n- (not present)\n");
  }

  // -- Step 3: enumerate interactive elements after open ------------------
  console.log("\n[3] Enumerating roles after chat opened...");
  const roleReport = await reportAllRoles(page);
  console.log(roleReport);
  findings.push(`## 3. Roles after chat opened\n\n${roleReport}\n`);

  // -- Step 3b: dump all buttons with bounding boxes ----------------------
  console.log("\n[3b] All buttons (named + unnamed) with positions...");
  const allButtons = page.getByRole("button");
  const btnCount = await allButtons.count();
  const buttonDetails: string[] = [];
  for (let i = 0; i < btnCount; i++) {
    const el = allButtons.nth(i);
    let name = "";
    let box: { x: number; y: number; width: number; height: number } | null =
      null;
    let html = "";
    try {
      name = (await el.getAttribute("aria-label")) ?? "";
      box = await el.boundingBox({ timeout: 500 });
      html = await el.innerHTML({ timeout: 500 });
    } catch {
      // ignore
    }
    const text = (await el.textContent({ timeout: 500 }).catch(() => "")) ?? "";
    const labelOrText = (name || text).trim().replace(/\s+/g, " ").slice(0, 30);
    const pos = box
      ? `(${Math.round(box.x)},${Math.round(box.y)}) ${Math.round(box.width)}x${Math.round(box.height)}`
      : "(no box)";
    const inner = html.replace(/\s+/g, " ").slice(0, 100);
    console.log(`  [${i}] "${labelOrText}" ${pos} inner="${inner}"`);
    buttonDetails.push(
      `- \`[${i}]\` name=\`${labelOrText || "(unnamed)"}\` pos=${pos}\n  - inner: \`${inner}\``,
    );
  }
  findings.push(`## 3b. All buttons\n${buttonDetails.join("\n")}\n`);

  // -- Step 4: hunt for the voice button by common labels -----------------
  console.log("\n[4] Probing common voice-button labels...");
  const probes = [
    "voice",
    "voice call",
    "phone",
    "call",
    "start voice",
    "talk",
    "mic",
    "switch to voice",
  ];
  const voiceFindings: string[] = [];
  for (const probe of probes) {
    const byText = page.getByText(probe, { exact: false });
    const byLabel = page.getByLabel(probe, { exact: false });
    const byRole = page.getByRole("button", { name: new RegExp(probe, "i") });
    const tCount = await byText.count();
    const lCount = await byLabel.count();
    const rCount = await byRole.count();
    if (tCount + lCount + rCount > 0) {
      console.log(
        `  "${probe}": text=${tCount} label=${lCount} button-role=${rCount}`,
      );
      voiceFindings.push(
        `- \`${probe}\`: text=\`${tCount}\` aria-label=\`${lCount}\` button-role=\`${rCount}\``,
      );
    }
  }
  findings.push(
    `## 4. Voice-button probes\n${voiceFindings.join("\n") || "(no matches)"}\n`,
  );

  // -- Step 5: click the phone-icon button to start voice ---------------
  console.log("\n[5] Clicking phone-icon button to start voice call...");
  const phoneButton = page
    .locator('button:has(slot[name="icon-phone"])')
    .first();
  let voiceClicked = false;
  try {
    await phoneButton.click({ timeout: 5000 });
    voiceClicked = true;
    console.log("  clicked phone button");
    findings.push(
      '## 5. Voice trigger\n- Selector: `button:has(slot[name="icon-phone"])`\n- Click: succeeded\n',
    );
  } catch (err) {
    console.log("  failed:", err instanceof Error ? err.message : err);
    findings.push(
      `## 5. Voice trigger\n- **Failed**: \`${err instanceof Error ? err.message : String(err)}\`\n`,
    );
  }
  if (voiceClicked) {
    for (const t of [2000, 5000, 8000, 12000]) {
      await driver.sleep(t === 2000 ? 2000 : 3000);
      const pcNow = await driver.pcCount();
      const wsNow = driver.observation.websockets.length;
      console.log(`  @${t}ms — pc=${pcNow}, ws=${wsNow}`);
    }
    await driver.screenshot("03-voice-active");
  }

  // -- Step 6: observe transport ------------------------------------------
  await driver.sleep(2000);
  const pcCount = await driver.pcCount();
  console.log("\n[6] Network observation:");
  console.log("  RTCPeerConnection count:", pcCount);
  console.log("  WebSockets observed:", driver.observation.websockets.length);
  for (const url of driver.observation.websockets) {
    console.log("    -", url);
  }
  findings.push(
    `## 6. Audio transport observation\n- RTCPeerConnection instances: \`${pcCount}\`\n- WebSockets (${driver.observation.websockets.length}):\n${driver.observation.websockets.map((u) => `  - \`${u}\``).join("\n") || "  - (none)"}\n`,
  );

  writeFileSync(join(OUT, "findings.md"), findings.join("\n"));
  console.log("\nWrote findings + screenshots to", OUT);

  await driver.cleanup();
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

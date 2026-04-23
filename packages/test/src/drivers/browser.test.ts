// trigger CI run on speed-up-ci-tests to verify Playwright caching path
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it, vi } from "vite-plus/test";

import { BaseBrowserDriver } from "#litmus-test/drivers/browser.ts";

const app = new Hono().get("/", (c) =>
  c.html("<h1 id='greeting'>Hello, world</h1>"),
);

class TestDriver extends BaseBrowserDriver {
  async greeting() {
    await this.page.goto("/");
    return this.page.locator("#greeting").textContent();
  }

  getBrowserForTest() {
    return this.page.context().browser();
  }
}

describe("BaseBrowserDriver", () => {
  let server: ReturnType<typeof serve>;
  let driver: TestDriver;

  beforeAll(async () => {
    server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    driver = new TestDriver({ baseUrl: `http://localhost:${port}` });
    await driver.init();
  });

  afterAll(async () => {
    await driver.cleanup();
    server.close();
  });

  it("subclasses can navigate and query the page", async () => {
    expect(await driver.greeting()).toBe("Hello, world");
  });

  it("cleanup closes the browser", async () => {
    const d = new TestDriver({ baseUrl: "http://localhost" });
    await d.init();

    const browser = d.getBrowserForTest();
    if (!browser) throw new Error("browser not initialised");
    const closeSpy = vi.spyOn(browser, "close");

    await d.cleanup();

    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vite-plus/test";

import { BrowserDriver } from "#litmus-test/drivers/browser.ts";

const app = new Hono().get("/", (c) =>
  c.html("<h1 id='greeting'>Hello, world</h1>"),
);

class TestDriver extends BrowserDriver {
  async greeting() {
    await this.page.goto("/");
    return this.page.locator("#greeting").textContent();
  }

  getBrowserForTest() {
    return this.page.context().browser();
  }
}

describe("BrowserDriver", () => {
  it("subclasses can navigate and query the page", async () => {
    const server = serve({ fetch: app.fetch, port: 0 });
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    await using driver = new TestDriver({
      baseUrl: `http://localhost:${port}`,
    });
    await driver.init();

    expect(await driver.greeting()).toBe("Hello, world");

    server.close();
  });

  it("disposing closes the browser", async () => {
    const closeSpy = await (async () => {
      await using driver = new TestDriver({ baseUrl: "http://localhost" });
      await driver.init();

      const browser = driver.getBrowserForTest();
      if (!browser) throw new Error("browser not initialised");
      return vi.spyOn(browser, "close");
    })();

    expect(closeSpy).toHaveBeenCalledOnce();
  });
});

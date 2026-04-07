import getPort from "get-port";
import { Hono } from "hono";
import { describe, expect, it } from "vite-plus/test";

import { serve } from "#litmus-http/serve.ts";

describe("serve", () => {
  it("does not accept connections until onBeforeStart completes", async () => {
    const app = new Hono().get("/", (c) => c.text("ok"));
    const port = await getPort();

    let completeBeforeStartHandler: () => void = () => {};

    const servePending = serve(app, {
      port,
      onBeforeStart: () =>
        new Promise<void>((resolve) => {
          completeBeforeStartHandler = resolve;
        }),
    });

    // While onBeforeStart is pending, the port should refuse connections.
    await expect(fetch(`http://localhost:${port}/`)).rejects.toThrow();

    completeBeforeStartHandler();
    const server = await servePending;

    try {
      const res = await fetch(`http://localhost:${port}/`);
      expect(res.status).toBe(200);
      expect(await res.text()).toBe("ok");
    } finally {
      server.close();
    }
  });
});

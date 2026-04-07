import { serve as honoServe } from "@hono/node-server";
import type { Hono } from "hono";

interface ServeOptions {
  port?: number;
  onBeforeStart?: () => Promise<void> | void;
}

export async function serve(app: Hono, options: ServeOptions = {}) {
  if (options.onBeforeStart) {
    await options.onBeforeStart();
  }
  return honoServe({ fetch: app.fetch, port: options.port });
}

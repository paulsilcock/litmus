import { serve as honoServe } from "@hono/node-server";
import type { Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { domainErrorHandler } from "#litmus-http/error-handler.ts";

interface ServeOptions {
  port?: number;
  errors?: Record<string, ContentfulStatusCode>;
  onBeforeStart?: () => Promise<void> | void;
  onBeforeStop?: () => Promise<void> | void;
}

export interface LitmusServer {
  stop(): Promise<void>;
}

export async function serve(
  app: Hono,
  options: ServeOptions = {},
): Promise<LitmusServer> {
  app.onError(domainErrorHandler(options.errors ?? {}));

  if (options.onBeforeStart) {
    await options.onBeforeStart();
  }
  const httpServer = honoServe({ fetch: app.fetch, port: options.port });

  return {
    async stop() {
      if (options.onBeforeStop) {
        await options.onBeforeStop();
      }
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

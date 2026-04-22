import { serve as honoServe } from "@hono/node-server";
import { httpInstrumentationMiddleware } from "@hono/otel";
import { type Context, Hono } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import { domainErrorHandler } from "#litmus-http/error-handler.ts";

interface TracingOptions {
  spanName?: (c: Context) => string;
  captureRequestHeaders?: string[];
  captureResponseHeaders?: string[];
}

interface ServeOptions {
  port?: number;
  errors?: Record<string, ContentfulStatusCode>;
  onBeforeStart?: () => Promise<void> | void;
  onBeforeStop?: () => Promise<void> | void;
  tracing?: TracingOptions;
}

export interface LitmusServer {
  port: number;
  stop(): Promise<void>;
}

export async function serve(
  app: Hono,
  options: ServeOptions = {},
): Promise<LitmusServer> {
  const tracedApp = new Hono()
    .use(
      httpInstrumentationMiddleware({
        spanNameFactory: options.tracing?.spanName,
        captureRequestHeaders: options.tracing?.captureRequestHeaders,
        captureResponseHeaders: options.tracing?.captureResponseHeaders,
      }),
    )
    .route("/", app);
  tracedApp.onError(domainErrorHandler(options.errors ?? {}));

  if (options.onBeforeStart) {
    await options.onBeforeStart();
  }
  const httpServer = honoServe({ fetch: tracedApp.fetch, port: options.port });

  const address = httpServer.address();
  const port =
    typeof address === "object" && address ? address.port : (options.port ?? 0);

  const server: LitmusServer = {
    port,
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

  const shutdown = async () => {
    try {
      await server.stop();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  const onSignal = () => void shutdown();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return server;
}

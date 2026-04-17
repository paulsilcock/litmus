import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { z } from "zod";

export interface CapturedEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailStubServer {
  baseUrl: string;
  stop(): Promise<void>;
}

const SendRequest = z.object({
  to: z.string(),
  subject: z.string(),
  body: z.string(),
});

/**
 * Out-of-process HTTP stub that stands in for the real email
 * provider during acceptance tests. The system under test POSTs
 * to /send; tests query /received to assert on what was sent and
 * DELETE /received to clear between tests.
 */
export async function startEmailStubServer(): Promise<EmailStubServer> {
  const emails: CapturedEmail[] = [];

  const app = new Hono()
    .post("/send", async (c) => {
      const parsed = SendRequest.safeParse(await c.req.json());
      if (!parsed.success) {
        return c.json({ error: "invalid email payload" }, 400);
      }
      emails.push(parsed.data);
      return c.body(null, 204);
    })
    .get("/received", (c) => c.json(emails))
    .delete("/received", (c) => {
      emails.length = 0;
      return c.body(null, 204);
    });

  const httpServer = serve({ fetch: app.fetch, port: 0 });
  const address = httpServer.address();
  const port = typeof address === "object" && address ? address.port : 0;

  return {
    baseUrl: `http://localhost:${port}`,
    async stop() {
      await new Promise<void>((resolve, reject) => {
        httpServer.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };
}

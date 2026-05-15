/**
 * Interactive smoke test for the OpenAI Realtime API using the official
 * SDK. Text-only — no browser, no audio capture, no ElevenLabs. Lets
 * you type a question, sends it via the Realtime WS, prints the
 * assistant's streamed text response.
 *
 * If this works, the connection + session config + event handling are
 * fine and any remaining issue is in the audio pipeline.
 *
 * Run: `vp dlx tsx ./src/realtime-test.ts`
 */

import "dotenv/config";
import { createInterface } from "node:readline";

import { OpenAI } from "openai";
import { OpenAIRealtimeWebSocket } from "openai/realtime/websocket";

async function run(): Promise<void> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY missing (.env)");

  const client = new OpenAI({ apiKey });
  const rt = new OpenAIRealtimeWebSocket({ model: "gpt-realtime-2" }, client);

  let pendingResponseText = "";

  rt.on("session.created", () => {
    console.log("[connected]");
    rt.send({
      type: "session.update",
      session: {
        type: "realtime",
        output_modalities: ["text"],
        instructions:
          "You are a concise assistant. Keep answers under 50 words.",
      },
    });
  });

  rt.on("session.updated", () => {
    console.log("[session ready — type your question and press enter]");
    prompt();
  });

  rt.on("response.output_text.delta", (event) => {
    pendingResponseText += event.delta;
    process.stdout.write(event.delta);
  });

  rt.on("response.output_text.done", () => {
    process.stdout.write("\n");
    pendingResponseText = "";
    prompt();
  });

  rt.on("error", (err) => {
    console.error("\n[realtime error]", err.error ?? err.message);
  });

  const rl = createInterface({ input: process.stdin, output: process.stdout });

  function prompt(): void {
    rl.question("> ", (line) => {
      const text = line.trim();
      if (text.length === 0) {
        if (text === "/quit") {
          rl.close();
          rt.close();
          return;
        }
        prompt();
        return;
      }
      if (text === "/quit") {
        rl.close();
        rt.close();
        return;
      }
      rt.send({
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text }],
        },
      });
      rt.send({ type: "response.create" });
    });
  }

  rl.on("close", () => {
    rt.close();
    console.log("\n[bye]");
    process.exit(0);
  });
}

run().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});

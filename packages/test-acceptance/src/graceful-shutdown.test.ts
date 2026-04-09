import { fork } from "node:child_process";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const packageRoot = join(import.meta.dirname, "..");

function spawnScript(script: string): Promise<{
  stdout: string;
  exitCode: number | null;
}> {
  return new Promise((resolve) => {
    const scriptPath = join(packageRoot, `.litmus-test-${Date.now()}.mts`);
    writeFileSync(scriptPath, script);

    const child = fork(scriptPath, [], {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: ["--experimental-transform-types", "--no-warnings"],
    });

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      // Once we see "READY", send SIGINT
      if (stdout.includes("READY")) {
        child.kill("SIGINT");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("exit", (code) => {
      try {
        unlinkSync(scriptPath);
      } catch {}
      resolve({ stdout, exitCode: code });
    });

    // Safety timeout
    setTimeout(() => {
      child.kill("SIGKILL");
    }, 10_000);
  });
}

describe("graceful shutdown", () => {
  it("HTTP serve() runs onBeforeStop on SIGINT and exits cleanly", async () => {
    const { stdout, exitCode } = await spawnScript(`
      import { Hono } from "hono";
      import { serve } from "@litmus/http";

      const app = new Hono().get("/", (c) => c.text("ok"));

      const server = await serve(app, {
        port: 0,
        onBeforeStop: () => {
          process.stdout.write("STOPPED\\n");
        },
      });

      process.stdout.write("READY\\n");
    `);

    expect(stdout).toContain("STOPPED");
    expect(exitCode).toBe(0);
  });

  it("CLI serveCli() runs onBeforeStop on SIGINT in socket mode", async () => {
    const socketPath = join(tmpdir(), `litmus-test-${Date.now()}.sock`);

    const { stdout, exitCode } = await spawnScript(`
      import { Cli, serveCli } from "@litmus/cli";
      import { CommandHandler } from "@litmus/core";
      import { z } from "zod";

      class Noop extends CommandHandler {
        async handle() {}
      }

      const cli = new Cli().command("noop", Noop, z.object({}));

      await serveCli(cli, { socket: "${socketPath}" }, {
        onBeforeStop: () => {
          process.stdout.write("STOPPED\\n");
        },
      });

      process.stdout.write("READY\\n");
    `);

    expect(stdout).toContain("STOPPED");
    expect(exitCode).toBe(0);
  });
});

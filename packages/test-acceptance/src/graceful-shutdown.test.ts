import { fork } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vite-plus/test";

const fixturesDir = join(import.meta.dirname, "fixtures");

function spawnFixture(
  scriptName: string,
  args: string[] = [],
): Promise<{ stdout: string; exitCode: number | null }> {
  return new Promise((resolve) => {
    const child = fork(join(fixturesDir, scriptName), args, {
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      execArgv: ["--experimental-transform-types", "--no-warnings"],
    });

    let stdout = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("READY")) {
        child.kill("SIGINT");
      }
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });

    child.on("exit", (code) => {
      resolve({ stdout, exitCode: code });
    });

    setTimeout(() => {
      child.kill("SIGKILL");
    }, 10_000);
  });
}

describe("graceful shutdown", () => {
  it("HTTP serve() runs onBeforeStop on SIGINT and exits cleanly", async () => {
    const { stdout, exitCode } = await spawnFixture("http-server.mts");

    expect(stdout).toContain("STOPPED");
    expect(exitCode).toBe(0);
  });

  it("CLI serveCli() runs onBeforeStop on SIGINT in socket mode", async () => {
    const socketPath = join(tmpdir(), `litmus-test-${Date.now()}.sock`);
    const { stdout, exitCode } = await spawnFixture("cli-socket-server.mts", [
      socketPath,
    ]);

    expect(stdout).toContain("STOPPED");
    expect(exitCode).toBe(0);
  });
});

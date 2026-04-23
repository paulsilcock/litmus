import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterAll, beforeAll, describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Cli, serveCli } from "#litmus-cli/index.ts";
import { BaseLitmusCliDriver } from "#litmus-cli/testing/cli-driver.ts";

class Echo {
  async handle(input: { message: string }) {
    return { echo: input.message };
  }
}

const cli = new Cli().command("echo", Echo, z.object({ message: z.string() }));

type AppCli = typeof cli;

class TestDriver extends BaseLitmusCliDriver<AppCli> {
  async echo(message: string) {
    return this.client.exec("echo", { message });
  }
  async cleanup() {}
}

describe("BaseLitmusCliDriver", () => {
  let server: { stop: () => Promise<void> };
  let driver: TestDriver;
  const socketPath = join(tmpdir(), `litmus-driver-test-${Date.now()}.sock`);

  beforeAll(async () => {
    server = await serveCli(cli, { socket: socketPath });
    driver = new TestDriver({ socket: socketPath });
  });

  afterAll(async () => {
    await server.stop();
  });

  it("subclasses can execute typed commands via the cli client", async () => {
    const result = await driver.echo("hello");

    expect(result).toEqual({ echo: "hello" });
  });
});

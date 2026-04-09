import { tmpdir } from "node:os";
import { join } from "node:path";

import { DomainError } from "@litmus/core";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { cliClient } from "#litmus-cli/cli-client.ts";
import { Cli } from "#litmus-cli/cli.ts";
import { serveCli } from "#litmus-cli/serve-cli.ts";

class Echo {
  async handle(input: { message: string }) {
    return { echo: input.message };
  }
}

const EchoSchema = z.object({ message: z.string() });

function socketPath() {
  return join(tmpdir(), `litmus-client-test-${Date.now()}.sock`);
}

describe("cliClient", () => {
  it("returns typed result from server", async () => {
    const path = socketPath();
    const cli = new Cli().command("echo", Echo, EchoSchema);
    const server = await serveCli(cli, { socket: path });

    try {
      const client = cliClient<typeof cli>(path);
      const result = await client.exec("echo", { message: "hello" });
      expect(result).toEqual({ echo: "hello" });
    } finally {
      await server.stop();
    }
  });

  it("surfaces DomainError from server", async () => {
    class NotFound extends DomainError {
      constructor(id: string) {
        super("NOT_FOUND", `Order ${id} not found`);
      }
    }

    class FailingHandler {
      async handle(input: { id: string }) {
        throw new NotFound(input.id);
      }
    }

    const path = socketPath();
    const cli = new Cli().command(
      "fail",
      FailingHandler,
      z.object({ id: z.string() }),
    );
    const server = await serveCli(cli, { socket: path });

    try {
      const client = cliClient<typeof cli>(path);
      const error = await client
        .exec("fail", { id: "123" })
        .catch((e: unknown) => e);
      expect(error).toBeInstanceOf(DomainError);
      expect(error).toMatchObject({
        code: "NOT_FOUND",
        message: "Order 123 not found",
      });
    } finally {
      await server.stop();
    }
  });

  it("surfaces unknown error from server as Error", async () => {
    class Broken {
      async handle(_input: { x: string }) {
        throw new Error("something broke");
      }
    }

    const path = socketPath();
    const cli = new Cli().command(
      "broken",
      Broken,
      z.object({ x: z.string() }),
    );
    const server = await serveCli(cli, { socket: path });

    try {
      const client = cliClient<typeof cli>(path);
      const error = await client
        .exec("broken", { x: "a" })
        .catch((e: unknown) => e);
      expect(error).not.toBeInstanceOf(DomainError);
      expect(error).toBeInstanceOf(Error);
      expect(error).toHaveProperty("message", "something broke");
    } finally {
      await server.stop();
    }
  });

  it("throws when socket does not exist", async () => {
    const cli = new Cli().command("echo", Echo, EchoSchema);
    const client = cliClient<typeof cli>("/tmp/does-not-exist.sock");
    await expect(client.exec("echo", { message: "hi" })).rejects.toThrow();
  });
});

import { connect } from "node:net";
import { Readable } from "node:stream";

import { CommandHandler, DomainError } from "@litmus/core";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Cli } from "#litmus-cli/cli.ts";
import { serveCli } from "#litmus-cli/serve-cli.ts";

const PlaceOrderSchema = z.object({ customerId: z.string() });
type PlaceOrderCommand = z.infer<typeof PlaceOrderSchema>;

class PlaceOrder extends CommandHandler<
  PlaceOrderCommand,
  { orderId: string }
> {
  async handle(cmd: PlaceOrderCommand) {
    return { orderId: `order_${cmd.customerId}` };
  }
}

function captureIo() {
  const io = {
    stdout: [] as string[],
    stderr: [] as string[],
    exitCode: undefined as number | undefined,
    exit(code: number) {
      io.exitCode = code;
    },
  };
  return io;
}

function socketRequest(
  socketPath: string,
  request: { command: string; args: Record<string, unknown> },
): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const client = connect(socketPath, () => {
      client.end(JSON.stringify(request));
    });
    let data = "";
    client.on("data", (chunk) => {
      data += chunk.toString();
    });
    client.on("end", () => {
      resolve(JSON.parse(data));
    });
    client.on("error", reject);
  });
}

describe("serveCli", () => {
  it("one-shot argv execution runs the command and exits", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    await serveCli(cli, ["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    expect(io.stdout.join("")).toContain("order_cust_1");
  });

  it("runs onBeforeStart before executing the command", async () => {
    let started = false;

    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    await serveCli(cli, ["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
      onBeforeStart: async () => {
        await new Promise((r) => setTimeout(r, 5));
        started = true;
      },
    });

    expect(started).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("runs onBeforeStop after the command completes", async () => {
    let stopped = false;

    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    await serveCli(cli, ["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
      onBeforeStop: async () => {
        stopped = true;
      },
    });

    expect(stopped).toBe(true);
    expect(io.exitCode).toBe(0);
  });

  it("interactive mode executes commands from stdin and stays open", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    const input = new Readable({ read() {} });
    const done = serveCli(
      cli,
      { interactive: true },
      {
        stdout: (s) => io.stdout.push(s),
        stderr: (s) => io.stderr.push(s),
        exit: io.exit,
        input,
      },
    );

    // Send a command
    input.push("orders:create --customerId cust_1\n");
    // Give it a tick to process
    await new Promise((r) => setTimeout(r, 10));
    expect(io.stdout.join("")).toContain("order_cust_1");

    // Send exit
    input.push("exit\n");
    await done;

    expect(io.exitCode).toBe(0);
  });

  it("interactive mode prints error for unknown command but stays open", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    const input = new Readable({ read() {} });
    const done = serveCli(
      cli,
      { interactive: true },
      {
        stdout: (s) => io.stdout.push(s),
        stderr: (s) => io.stderr.push(s),
        exit: io.exit,
        input,
      },
    );

    input.push("nonsense\n");
    await new Promise((r) => setTimeout(r, 10));
    expect(io.stderr.join("").toLowerCase()).toContain("unknown");

    // Still alive — can run another command
    input.push("orders:create --customerId cust_2\n");
    await new Promise((r) => setTimeout(r, 10));
    expect(io.stdout.join("")).toContain("order_cust_2");

    input.push("exit\n");
    await done;
  });

  it("unix socket accepts JSON requests and returns JSON results", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const socketPath = `/tmp/litmus-test-${Date.now()}.sock`;

    const server = await serveCli(cli, { socket: socketPath });

    try {
      const result = await socketRequest(socketPath, {
        command: "orders:create",
        args: { customerId: "cust_1" },
      });

      expect(result).toEqual({ result: { orderId: "order_cust_1" } });
    } finally {
      await server.stop();
    }
  });

  it("unix socket returns error JSON for DomainErrors", async () => {
    class OrderNotFound extends DomainError {
      constructor(id: string) {
        super("ORDER_NOT_FOUND", `Order ${id} not found`);
      }
    }

    const FindOrderSchema = z.object({ id: z.string() });
    type FindOrderInput = z.infer<typeof FindOrderSchema>;

    class FindOrder extends CommandHandler<FindOrderInput, void> {
      async handle(input: FindOrderInput): Promise<void> {
        throw new OrderNotFound(input.id);
      }
    }

    const cli = new Cli().command("orders:find", FindOrder, FindOrderSchema);
    const socketPath = `/tmp/litmus-test-${Date.now()}.sock`;

    const server = await serveCli(cli, { socket: socketPath });

    try {
      const result = await socketRequest(socketPath, {
        command: "orders:find",
        args: { id: "order_missing" },
      });

      expect(result).toEqual({
        error: {
          code: "ORDER_NOT_FOUND",
          message: "Order order_missing not found",
        },
      });
    } finally {
      await server.stop();
    }
  });

  it("onBeforeStart failure prevents execution", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );
    const io = captureIo();

    await serveCli(cli, ["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
      onBeforeStart: async () => {
        throw new Error("db failed");
      },
    });

    expect(io.exitCode).toBe(1);
    expect(io.stderr.join("")).toContain("db failed");
    expect(io.stdout).toHaveLength(0);
  });
});

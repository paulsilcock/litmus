import { CommandHandler, DomainError } from "@litmus/core";
import { describe, expect, it } from "vite-plus/test";
import { z } from "zod";

import { Cli } from "#litmus-cli/cli.ts";

interface Io {
  stdout: string[];
  stderr: string[];
  exit: (code: number) => void;
  exitCode: number | undefined;
}

function captureIo(): Io {
  const io: Io = {
    stdout: [],
    stderr: [],
    exitCode: undefined,
    exit(code) {
      io.exitCode = code;
    },
  };
  return io;
}

const PlaceOrderSchema = z.object({
  customerId: z.string(),
});

type PlaceOrderCommand = z.infer<typeof PlaceOrderSchema>;

class PlaceOrder extends CommandHandler<
  PlaceOrderCommand,
  { orderId: string }
> {
  async handle(cmd: PlaceOrderCommand) {
    return { orderId: `order_${cmd.customerId}` };
  }
}

// Type-level regression: exec() must enforce per-command input/output types.
// If type inference breaks, these will fail the type check.
{
  const cli = new Cli().command("orders:create", PlaceOrder, PlaceOrderSchema);

  // Valid input -> typed result
  void (async () => {
    const result = await cli.exec("orders:create", { customerId: "cust_1" });
    void result.orderId;
  });

  // @ts-expect-error — wrong input shape
  void cli.exec("orders:create", { customerId: 123 }).catch(() => {});

  // @ts-expect-error — unknown command name
  void cli.exec("nonsense", { customerId: "cust_1" }).catch(() => {});
}

// Type-level regression: chained .use() calls share the typed context
// declared by TEnv — later middleware can read keys set by earlier
// middleware, unknown keys are rejected, and values are type-checked.
{
  const cli = new Cli<{
    Variables: { userId: string; requestId: string };
  }>()
    .use(async (ctx, next) => {
      ctx.set("userId", "u1");
      // @ts-expect-error — 'userId' is typed as string, not number
      ctx.set("userId", 42);
      await next();
    })
    .use(async (ctx, next) => {
      const userId: string = ctx.get("userId");
      void userId;
      ctx.set("requestId", "r1");
      // @ts-expect-error — 'badKey' is not in Variables
      ctx.get("badKey");
      await next();
    });
  void cli;
}

describe("cli", () => {
  it("argv reaches a handler nested inside a group", async () => {
    const orderCommands = new Cli().command(
      "create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    const io = captureIo();
    const cli = new Cli().command("orders", orderCommands);

    await cli.run(["orders", "create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    expect(io.stdout.join("")).toContain("order_cust_1");
  });

  it("exec resolves grouped commands with colon-separated names", async () => {
    const orderCommands = new Cli().command(
      "create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    const cli = new Cli().command("orders", orderCommands);

    const result = await cli.exec("orders:create", { customerId: "cust_1" });
    expect(result).toEqual({ orderId: "order_cust_1" });
  });

  it("exec runs a command programmatically and returns the typed result", async () => {
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    const result = await cli.exec("orders:create", { customerId: "cust_1" });

    expect(result).toEqual({ orderId: "order_cust_1" });
  });

  it("AsyncIterable results stream as ndjson lines", async () => {
    const StreamSchema = z.object({ count: z.number() });
    type StreamInput = z.infer<typeof StreamSchema>;

    class StreamTokens extends CommandHandler<StreamInput, { token: string }> {
      async *handle(input: StreamInput): AsyncIterable<{ token: string }> {
        for (let i = 0; i < input.count; i++) {
          yield { token: `tok_${i}` };
        }
      }
    }

    const io = captureIo();
    const cli = new Cli().command("tokens:stream", StreamTokens, StreamSchema);

    await cli.run(["tokens:stream", "--count", "3"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    const lines = io.stdout
      .join("")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l));
    expect(lines).toEqual([
      { token: "tok_0" },
      { token: "tok_1" },
      { token: "tok_2" },
    ]);
  });

  it("--help lists registered commands with their descriptions", async () => {
    const io = captureIo();
    const cli = new Cli()
      .command("orders:create", PlaceOrder, PlaceOrderSchema, {
        description: "Place a new order",
      })
      .command("orders:ship", PlaceOrder, PlaceOrderSchema, {
        description: "Ship an existing order",
      });

    await cli.run(["--help"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    const stdout = io.stdout.join("");
    expect(stdout).toContain("orders:create");
    expect(stdout).toContain("Place a new order");
    expect(stdout).toContain("orders:ship");
    expect(stdout).toContain("Ship an existing order");
  });

  it("unknown command prints an error to stderr and exits non-zero", async () => {
    const io = captureIo();
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    await cli.run(["orders:nonsense"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(1);
    const stderr = io.stderr.join("");
    expect(stderr).toContain("orders:nonsense");
    expect(stderr.toLowerCase()).toContain("unknown");
  });

  it("DomainError thrown from handler prints code+message and exits 1", async () => {
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

    const io = captureIo();
    const cli = new Cli().command("orders:find", FindOrder, FindOrderSchema);

    await cli.run(["orders:find", "--id", "order_missing"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(1);
    const stderr = io.stderr.join("");
    expect(stderr).toContain("ORDER_NOT_FOUND");
    expect(stderr).toContain("Order order_missing not found");
  });

  it("chained middleware runs onion-style and shares a single context", async () => {
    const EchoSchema = z.object({});
    type EchoInput = { userId: string; requestId: string; order: string[] };

    class Echo extends CommandHandler<EchoInput, EchoInput> {
      async handle(cmd: EchoInput) {
        cmd.order.push("handler");
        return { ...cmd, order: [...cmd.order] };
      }
    }

    const order: string[] = [];
    const cli = new Cli<{
      Variables: { userId: string; requestId: string };
    }>()
      .use(async (ctx, next) => {
        order.push("outer:pre");
        ctx.set("userId", "u1");
        await next();
        order.push("outer:post");
      })
      .use(async (ctx, next) => {
        order.push("inner:pre");
        expect(ctx.get("userId")).toBe("u1");
        ctx.set("requestId", "r1");
        await next();
        order.push("inner:post");
      })
      .command("echo", Echo, EchoSchema, {
        input: (_, ctx) => ({
          userId: ctx.get("userId"),
          requestId: ctx.get("requestId"),
          order,
        }),
      });

    const result = await cli.exec("echo", {});
    expect(result).toEqual({
      userId: "u1",
      requestId: "r1",
      order: ["outer:pre", "inner:pre", "handler"],
    });
    expect(order).toEqual([
      "outer:pre",
      "inner:pre",
      "handler",
      "inner:post",
      "outer:post",
    ]);
  });

  it("middleware can inject values the handler receives alongside argv flags", async () => {
    const CreateOrderSchema = z.object({
      customerId: z.string(),
      placedBy: z.string(),
    });
    type CreateOrderInput = z.infer<typeof CreateOrderSchema>;

    class CreateOrder extends CommandHandler<
      CreateOrderInput,
      { customerId: string; placedBy: string }
    > {
      async handle(cmd: CreateOrderInput) {
        return { customerId: cmd.customerId, placedBy: cmd.placedBy };
      }
    }

    const io = captureIo();
    const cli = new Cli<{ Variables: { userId: string } }>()
      .use(async (ctx, next) => {
        ctx.set("userId", "user_from_middleware");
        await next();
      })
      .command(
        "orders:create",
        CreateOrder,
        CreateOrderSchema.omit({ placedBy: true }),
        {
          input: (validated, ctx) => ({
            ...validated,
            placedBy: ctx.get("userId"),
          }),
        },
      );

    await cli.run(["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    const out = JSON.parse(io.stdout.join("").trim());
    expect(out).toEqual({
      customerId: "cust_1",
      placedBy: "user_from_middleware",
    });
  });

  it("invalid args print validation errors to stderr and exit non-zero", async () => {
    const io = captureIo();
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    await cli.run(["orders:create"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(2);
    const stderr = io.stderr.join("");
    expect(stderr).toContain("customerId");
    expect(stderr).toContain("Invalid input");
  });

  it("runs a registered command with validated args from argv", async () => {
    const io = captureIo();
    const cli = new Cli().command(
      "orders:create",
      PlaceOrder,
      PlaceOrderSchema,
    );

    await cli.run(["orders:create", "--customerId", "cust_1"], {
      stdout: (s) => io.stdout.push(s),
      stderr: (s) => io.stderr.push(s),
      exit: io.exit,
    });

    expect(io.exitCode).toBe(0);
    expect(io.stdout.join("")).toContain("order_cust_1");
  });
});

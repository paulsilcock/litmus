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

// Type-level regression: middleware context keys are narrowed by TEnv.
{
  const cli = new Cli<{ Variables: { userId: string } }>();

  void cli.use(async (ctx, _next) => {
    const userId: string = ctx.get("userId");
    void userId;
    // @ts-expect-error — 'badKey' is not in Variables
    ctx.get("badKey");
    // @ts-expect-error — 'userId' is typed as string, not number
    ctx.set("userId", 42);
  });
}

describe("cli", () => {
  it("grouped commands compose and dispatch through argv", async () => {
    const GetOrderSchema = z.object({ id: z.string() });
    type GetOrderQuery = z.infer<typeof GetOrderSchema>;

    class GetOrder extends CommandHandler<
      GetOrderQuery,
      { id: string; status: string }
    > {
      async handle(query: GetOrderQuery) {
        return { id: query.id, status: "placed" };
      }
    }

    const RegisterSchema = z.object({ email: z.string() });
    type RegisterInput = z.infer<typeof RegisterSchema>;

    class RegisterUser extends CommandHandler<
      RegisterInput,
      { userId: string }
    > {
      async handle(cmd: RegisterInput) {
        return { userId: `user_${cmd.email}` };
      }
    }

    const orderCommands = new Cli()
      .command("create", PlaceOrder, PlaceOrderSchema, {
        description: "Place a new order",
      })
      .command("get", GetOrder, GetOrderSchema, {
        description: "Get order details",
      });

    const userCommands = new Cli().command(
      "register",
      RegisterUser,
      RegisterSchema,
      { description: "Register a user" },
    );

    const cli = new Cli()
      .command("orders", orderCommands)
      .command("users", userCommands);

    // Create an order
    const createIo = captureIo();
    await cli.run(["orders", "create", "--customerId", "cust_1"], {
      stdout: (s) => createIo.stdout.push(s),
      stderr: (s) => createIo.stderr.push(s),
      exit: createIo.exit,
    });
    expect(createIo.exitCode).toBe(0);
    expect(createIo.stdout.join("")).toContain("order_cust_1");

    // Register a user
    const registerIo = captureIo();
    await cli.run(["users", "register", "--email", "alice@test.com"], {
      stdout: (s) => registerIo.stdout.push(s),
      stderr: (s) => registerIo.stderr.push(s),
      exit: registerIo.exit,
    });
    expect(registerIo.exitCode).toBe(0);
    expect(registerIo.stdout.join("")).toContain("user_alice@test.com");
  });

  it("grouped commands resolve via 'group subcommand' in argv", async () => {
    const orderCommands = new Cli()
      .command("create", PlaceOrder, PlaceOrderSchema)
      .command("ship", PlaceOrder, PlaceOrderSchema);

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
    expect(stderr).toContain("Required");
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

import type { Socket } from "node:net";
import { createServer } from "node:net";
import { createInterface } from "node:readline";
import type { Readable } from "node:stream";

import { DomainError } from "@litmus/core";

import type { Cli, RunOptions } from "#litmus-cli/cli.ts";

interface ServeCliOptions extends RunOptions {
  onBeforeStart?: () => Promise<void> | void;
  onBeforeStop?: () => Promise<void> | void;
  input?: Readable;
}

type ArgsOrMode = string[] | { interactive: true } | { socket: string };

interface CliServer {
  stop(): Promise<void>;
}

export async function serveCli(
  cli: Cli<any, any>,
  argsOrMode: { socket: string },
  options?: ServeCliOptions,
): Promise<CliServer>;
export async function serveCli(
  cli: Cli<any, any>,
  argsOrMode: string[] | { interactive: true },
  options?: ServeCliOptions,
): Promise<void>;
export async function serveCli(
  cli: Cli<any, any>,
  argsOrMode: ArgsOrMode,
  options: ServeCliOptions = {},
): Promise<CliServer | void> {
  const stderr = options.stderr ?? ((s: string) => process.stderr.write(s));
  const exit = options.exit ?? ((code: number) => process.exit(code));

  if (options.onBeforeStart) {
    try {
      await options.onBeforeStart();
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      stderr(`${message}\n`);
      exit(1);
      return;
    }
  }

  if (Array.isArray(argsOrMode)) {
    await cli.run(argsOrMode, {
      stdout: options.stdout,
      stderr: options.stderr,
      exit: options.exit,
    });
    if (options.onBeforeStop) {
      await options.onBeforeStop();
    }
    return;
  }

  if ("interactive" in argsOrMode) {
    await runInteractive(cli, options);
    return;
  }

  // Socket mode
  return runSocket(cli, argsOrMode.socket, options);
}

async function runInteractive(
  cli: Cli<any, any>,
  options: ServeCliOptions,
): Promise<void> {
  const stdout = options.stdout ?? ((s: string) => process.stdout.write(s));
  const exit = options.exit ?? ((code: number) => process.exit(code));
  const input = options.input ?? process.stdin;

  const rl = createInterface({ input });

  const onSignal = () => rl.close();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  for await (const line of rl) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed === "exit") break;

    const args = trimmed.split(/\s+/);
    await cli.run(args, {
      stdout,
      stderr: options.stderr,
      exit: () => {},
    });
  }

  process.off("SIGINT", onSignal);
  process.off("SIGTERM", onSignal);

  if (options.onBeforeStop) {
    await options.onBeforeStop();
  }
  exit(0);
}

async function runSocket(
  cli: Cli<any, any>,
  socketPath: string,
  options: ServeCliOptions,
): Promise<CliServer> {
  const server = createServer((connection) => {
    let data = "";
    connection.on("data", (chunk: Buffer) => {
      data += chunk.toString();
      try {
        JSON.parse(data);
        void handleSocketRequest(cli, connection, data);
      } catch {
        // incomplete JSON, wait for more data
      }
    });
  });

  await new Promise<void>((resolve) => {
    server.listen(socketPath, resolve);
  });

  const cliServer: CliServer = {
    async stop() {
      if (options.onBeforeStop) {
        await options.onBeforeStop();
      }
      await new Promise<void>((resolve, reject) => {
        server.close((err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    },
  };

  const shutdown = async () => {
    try {
      await cliServer.stop();
      process.exit(0);
    } catch {
      process.exit(1);
    }
  };
  const onSignal = () => void shutdown();
  process.on("SIGINT", onSignal);
  process.on("SIGTERM", onSignal);

  return cliServer;
}

async function handleSocketRequest(
  cli: Cli<any, any>,
  connection: Socket,
  raw: string,
): Promise<void> {
  try {
    const request = JSON.parse(raw);
    const result = await cli.exec(request.command, request.args);
    connection.write(JSON.stringify({ result }));
    connection.end();
  } catch (e) {
    if (e instanceof DomainError) {
      connection.write(
        JSON.stringify({ error: { code: e.code, message: e.message } }),
      );
    } else {
      const message = e instanceof Error ? e.message : String(e);
      connection.write(JSON.stringify({ error: { message } }));
    }
    connection.end();
  }
}

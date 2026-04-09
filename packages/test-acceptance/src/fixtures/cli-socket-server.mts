import { Cli, serveCli } from "@litmus/cli";
import { CommandHandler } from "@litmus/core";
import { z } from "zod";

class Noop extends CommandHandler<Record<string, never>, void> {
  async handle() {}
}

const cli = new Cli().command("noop", Noop, z.object({}));

const socketPath = process.argv[2];
if (!socketPath) {
  process.stderr.write("Usage: cli-socket-server.mts <socket-path>\n");
  process.exit(1);
}

await serveCli(
  cli,
  { socket: socketPath },
  {
    onBeforeStop: () => {
      process.stdout.write("STOPPED\n");
    },
  },
);

process.stdout.write("READY\n");

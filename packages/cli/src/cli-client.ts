import { createConnection } from "node:net";

import { DomainError } from "@litmus/core";

import type { Cli } from "#litmus-cli/cli.ts";

class RemoteDomainError extends DomainError {}

type CommandSchema<TInput, TResult> = { input: TInput; result: TResult };

type InferCommands<T> = T extends Cli<any, infer C> ? C : never;

export interface CliClient<
  TCommands extends Record<string, CommandSchema<any, any>>,
> {
  exec<TName extends keyof TCommands & string>(
    name: TName,
    input: TCommands[TName]["input"],
  ): Promise<TCommands[TName]["result"]>;
}

export function cliClient<T extends Cli<any, any>>(
  socketPath: string,
): CliClient<InferCommands<T>> {
  return {
    exec(name, input) {
      return new Promise((resolve, reject) => {
        const connection = createConnection(socketPath, () => {
          connection.write(JSON.stringify({ command: name, args: input }));
        });

        let data = "";
        connection.on("data", (chunk: Buffer) => {
          data += chunk.toString();
        });

        connection.on("end", () => {
          try {
            const response = JSON.parse(data);
            if (response.error) {
              if (response.error.code) {
                reject(
                  new RemoteDomainError(
                    response.error.code,
                    response.error.message,
                  ),
                );
              } else {
                reject(new Error(response.error.message));
              }
            } else {
              resolve(response.result);
            }
          } catch (e) {
            reject(e);
          }
        });

        connection.on("error", reject);
      });
    },
  };
}

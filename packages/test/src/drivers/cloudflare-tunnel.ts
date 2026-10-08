import { Resolver } from "node:dns/promises";
import { existsSync } from "node:fs";
import { setTimeout as sleep } from "node:timers/promises";

import { bin, install, Tunnel } from "cloudflared";

import type { Exposure } from "#litmus-test/drivers/phone.ts";

/** Installs cloudflared once, however many tunnels open at the same time. */
let installing: Promise<string> | undefined;

/**
 * Exposes a driver's port through a Cloudflare quick tunnel: free, needs
 * no account, and gives a new public address each time — so drivers
 * running at once each get their own. Installs `cloudflared` on first
 * use. Pass it as a driver's `expose` option.
 *
 * Quick tunnels are for testing: Cloudflare doesn't guarantee them.
 *
 * @example
 * ```typescript
 * await using phone = new ReceptionDriver({ twilio, expose: cloudflareTunnel() });
 * await phone.init();
 * ```
 */
export function cloudflareTunnel(): (port: number) => Promise<Exposure> {
  return async (port) => {
    installing ??= existsSync(bin) ? Promise.resolve(bin) : install(bin);
    await installing;

    const tunnel = Tunnel.quick(`http://127.0.0.1:${port}`);
    try {
      const url = await opened(tunnel);
      await untilPubliclyResolvable(new URL(url).hostname);
      return {
        url,
        async [Symbol.asyncDispose]() {
          tunnel.stop();
        },
      };
    } catch (error) {
      tunnel.stop();
      throw error;
    }
  };
}

/** Resolves with the tunnel's address once it's connected to Cloudflare. */
async function opened(tunnel: Tunnel): Promise<string> {
  return new Promise((resolve, reject) => {
    let url: string | undefined;
    let connected = false;
    const settle = (): void => {
      if (url !== undefined && connected) resolve(url);
    };
    tunnel.once("url", (address) => {
      url = address;
      settle();
    });
    tunnel.once("connected", () => {
      connected = true;
      settle();
    });
    tunnel.once("error", reject);
    tunnel.once("exit", (code) => {
      reject(
        new Error(
          `cloudflared stopped before the tunnel opened (exit ${code}).`,
        ),
      );
    });
  });
}

/**
 * Waits until public DNS knows a new tunnel's name. Twilio, for one,
 * rejects an address it can't resolve, and a new name takes a few seconds
 * to appear. Asks public resolvers directly, skipping this machine's cache,
 * then allows a little longer: other resolvers, like Twilio's, can lag
 * behind them.
 */
async function untilPubliclyResolvable(host: string): Promise<void> {
  const resolver = new Resolver();
  resolver.setServers(["1.1.1.1", "8.8.8.8"]);
  for (let attempt = 0; attempt < 60; attempt++) {
    const resolved = await resolver.resolve4(host).then(
      (addresses) => addresses.length > 0,
      () => false,
    );
    if (resolved) {
      await sleep(10_000);
      return;
    }
    await sleep(1_000);
  }
  throw new Error(`Public DNS still can't find ${host} after a minute.`);
}

import type { Hono } from "hono";
import { hc } from "hono/client";

interface HonoDriverOptions {
  baseUrl: string;
}

export abstract class BaseHonoDriver<T extends Hono> {
  readonly client: ReturnType<typeof hc<T>>;

  constructor(options: HonoDriverOptions) {
    this.client = hc<T>(options.baseUrl);
  }

  abstract cleanup(): Promise<void>;
}

interface HttpDriverOptions {
  baseUrl: string;
}

export abstract class BaseHttpDriver {
  readonly #baseUrl: string;

  constructor(options: HttpDriverOptions) {
    this.#baseUrl = options.baseUrl;
  }

  async get(path: string): Promise<Response> {
    return fetch(`${this.#baseUrl}${path}`);
  }

  async post(
    path: string,
    options?: { json?: unknown },
  ): Promise<Response> {
    return fetch(`${this.#baseUrl}${path}`, {
      method: "POST",
      headers: options?.json
        ? { "Content-Type": "application/json" }
        : undefined,
      body: options?.json ? JSON.stringify(options.json) : undefined,
    });
  }

  abstract cleanup(): Promise<void>;
}

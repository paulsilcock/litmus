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
    options?: { json?: unknown; form?: Record<string, string> },
  ): Promise<Response> {
    let headers: Record<string, string> | undefined;
    let body: string | undefined;

    if (options?.json) {
      headers = { "Content-Type": "application/json" };
      body = JSON.stringify(options.json);
    } else if (options?.form) {
      headers = { "Content-Type": "application/x-www-form-urlencoded" };
      body = new URLSearchParams(options.form).toString();
    }

    return fetch(`${this.#baseUrl}${path}`, { method: "POST", headers, body });
  }

  abstract cleanup(): Promise<void>;
}

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

  abstract cleanup(): Promise<void>;
}

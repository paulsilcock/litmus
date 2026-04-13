type CommonHeader =
  | "Accept"
  | "Authorization"
  | "Cache-Control"
  | "Content-Type"
  | "Cookie";

type Headers = Partial<Record<CommonHeader, string>> & Record<string, string>;

interface BodyOptions {
  json?: unknown;
  form?: Record<string, string>;
  body?: string | Buffer | ReadableStream;
  headers?: Headers;
  query?: Record<string, string>;
}

type QueryOptions = Pick<BodyOptions, "headers" | "query">;

interface HttpDriverOptions {
  baseUrl: string;
}

function buildUrl(base: string, path: string, query?: Record<string, string>) {
  const url = `${base}${path}`;
  if (!query) return url;
  const params = new URLSearchParams(query).toString();
  return `${url}?${params}`;
}

function buildRequestInit(method: string, options?: BodyOptions): RequestInit {
  const init: RequestInit = { method };

  if (options?.json) {
    init.headers = { "Content-Type": "application/json", ...options.headers };
    init.body = JSON.stringify(options.json);
  } else if (options?.form) {
    init.headers = {
      "Content-Type": "application/x-www-form-urlencoded",
      ...options.headers,
    };
    init.body = new URLSearchParams(options.form).toString();
  } else if (options?.body) {
    init.headers = options.headers;
    init.body = options.body;
  } else if (options?.headers) {
    init.headers = options.headers;
  }

  return init;
}

export abstract class BaseHttpDriver {
  readonly #baseUrl: string;

  constructor(options: HttpDriverOptions) {
    this.#baseUrl = options.baseUrl;
  }

  async get(path: string, options?: QueryOptions): Promise<Response> {
    const url = buildUrl(this.#baseUrl, path, options?.query);
    return fetch(url, { method: "GET", headers: options?.headers });
  }

  async post(path: string, options?: BodyOptions): Promise<Response> {
    return this.#requestWithBody("POST", path, options);
  }

  async put(path: string, options?: BodyOptions): Promise<Response> {
    return this.#requestWithBody("PUT", path, options);
  }

  async patch(path: string, options?: BodyOptions): Promise<Response> {
    return this.#requestWithBody("PATCH", path, options);
  }

  async delete(path: string, options?: QueryOptions): Promise<Response> {
    const url = buildUrl(this.#baseUrl, path, options?.query);
    return fetch(url, { method: "DELETE", headers: options?.headers });
  }

  #requestWithBody(
    method: string,
    path: string,
    options?: BodyOptions,
  ): Promise<Response> {
    const url = buildUrl(this.#baseUrl, path, options?.query);
    return fetch(url, buildRequestInit(method, options));
  }

  abstract cleanup(): Promise<void>;
}

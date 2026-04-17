import type { EmailService } from "./email-service.ts";

/**
 * Sends email by POSTing to an HTTP endpoint. Treats the remote
 * service as an out-of-process collaborator — tests can point this
 * at a stub server on a local port to capture sends.
 */
export class HttpEmailService implements EmailService {
  readonly #endpoint: string;

  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  async send(message: {
    to: string;
    subject: string;
    body: string;
  }): Promise<void> {
    const res = await fetch(`${this.#endpoint}/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message),
    });
    if (!res.ok) {
      throw new Error(`email send failed: ${res.status}`);
    }
  }
}

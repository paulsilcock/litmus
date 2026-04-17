import type { CapturedEmail } from "./email-stub-server.ts";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCapturedEmail(value: unknown): value is CapturedEmail {
  if (!isRecord(value)) return false;
  return (
    typeof value["to"] === "string" &&
    typeof value["subject"] === "string" &&
    typeof value["body"] === "string"
  );
}

function isCapturedEmailArray(value: unknown): value is CapturedEmail[] {
  return Array.isArray(value) && value.every(isCapturedEmail);
}

/**
 * Test-side client for the out-of-process email stub. Encapsulates
 * the stub's HTTP protocol so the driver (which talks to the system
 * under test) stays free of fixture plumbing.
 */
export class EmailStubClient {
  readonly #baseUrl: string;

  constructor(baseUrl: string) {
    this.#baseUrl = baseUrl;
  }

  async received(): Promise<CapturedEmail[]> {
    const res = await fetch(`${this.#baseUrl}/received`);
    if (!res.ok) {
      throw new Error(`email stub fetch failed: ${res.status}`);
    }
    const body: unknown = await res.json();
    if (!isCapturedEmailArray(body)) {
      throw new Error("email stub: unexpected response shape");
    }
    return body;
  }

  async clear(): Promise<void> {
    const res = await fetch(`${this.#baseUrl}/received`, { method: "DELETE" });
    if (!res.ok) {
      throw new Error(`email stub cleanup failed: ${res.status}`);
    }
  }
}

/**
 * Port for sending transactional email. Implementations live
 * alongside the concrete provider (real SMTP/SendGrid/etc. in
 * production, an HTTP stub in tests). Use cases depend on this
 * contract, never on a specific provider.
 *
 * Bound via the `EMAIL_SERVICE` token rather than a class token
 * because tsyringe rejects abstract classes as injection tokens.
 */
export interface EmailService {
  send(message: { to: string; subject: string; body: string }): Promise<void>;
}

export const EMAIL_SERVICE = "EmailService" as const;

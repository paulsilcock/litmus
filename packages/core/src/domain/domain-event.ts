// Stub — not yet implemented
export abstract class DomainEvent {
  readonly occurredAt: Date;

  constructor() {
    this.occurredAt = new Date();
  }
}

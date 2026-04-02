import type { DomainEvent } from "#litmus/domain/domain-event.ts";
import { Entity } from "#litmus/domain/entity.ts";

export abstract class AggregateRoot<TId = string> extends Entity<TId> {
  private _domainEvents: DomainEvent[] = [];
  private _version: number = 0;

  get domainEvents(): readonly DomainEvent[] {
    return this._domainEvents;
  }

  get version(): number {
    return this._version;
  }

  /** @internal Called by repository after loading from persistence. */
  _setVersion(version: number): void {
    this._version = version;
  }

  /** @internal Called by repository after successful save. */
  _incrementVersion(): void {
    this._version++;
  }

  protected addDomainEvent(event: DomainEvent): void {
    this._domainEvents.push(event);
  }

  clearDomainEvents(): DomainEvent[] {
    const events = [...this._domainEvents];
    this._domainEvents = [];
    return events;
  }
}

import type { DomainEvent } from "#litmus/domain/domain-event.ts";
import { Entity } from "#litmus/domain/entity.ts";

export type AggregateData<TId = string> = {
  id: TId;
  version?: number;
};

export abstract class AggregateRoot<
  TData extends AggregateData<TId>,
  TId = string,
> extends Entity<TId> {
  #data: TData;
  #domainEvents: DomainEvent<any>[] = [];

  constructor(data: TData) {
    super(data.id);
    this.#data = { ...data, version: data.version ?? 0 };
  }

  get version(): number {
    return this.#data.version!;
  }

  get domainEvents(): readonly DomainEvent<any>[] {
    return this.#domainEvents;
  }

  protected get data(): TData {
    return this.#data;
  }

  /** @internal Called by repository after successful save. */
  _incrementVersion(): void {
    this.#data = { ...this.#data, version: this.#data.version! + 1 };
  }

  protected addDomainEvent(event: DomainEvent<TData>): void {
    this.#domainEvents.push(event);
  }

  clearDomainEvents(): DomainEvent[] {
    const events = [...this.#domainEvents];
    this.#domainEvents = [];
    return events;
  }
}

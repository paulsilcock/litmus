import type { DomainEvent } from "#litmus/domain/domain-event.ts";

type DomainEventClass = new (...args: any[]) => DomainEvent;
type Handler = (event: DomainEvent) => void;

export class DomainEventDispatcher {
  private handlers = new Map<DomainEventClass, Handler[]>();

  on(eventType: DomainEventClass, handler: Handler): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  publish(event: DomainEvent): void {
    for (const [eventType, handlers] of this.handlers) {
      if (event instanceof eventType) {
        for (const handler of handlers) {
          handler(event);
        }
      }
    }
  }
}

import type { DomainEvent } from "#litmus/domain/domain-event.ts";

type DomainEventClass = new (...args: any[]) => DomainEvent;
type Handler = (event: DomainEvent) => void;

/**
 * In-process pub-sub dispatcher for domain events.
 *
 * Register handlers for specific event types with `on()`, then call
 * `publish()` after saving an aggregate to notify subscribers.
 * Handlers are matched using `instanceof`, so a handler registered
 * for a base event class will receive subclass events too.
 *
 * @example
 * ```typescript
 * import { DomainEventDispatcher } from "@litmus/core";
 * import { OrderPlaced } from "./events";
 *
 * const dispatcher = new DomainEventDispatcher();
 *
 * dispatcher.on(OrderPlaced, (event) => {
 *   console.log("Order placed at", event.occurredAt);
 * });
 *
 * // After saving the aggregate:
 * for (const event of order.clearDomainEvents()) {
 *   dispatcher.publish(event);
 * }
 * ```
 */
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

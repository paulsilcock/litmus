import type { DomainEvent } from "#litmus/domain/domain-event.ts";

type DomainEventClass = new (...args: any[]) => DomainEvent;
type Handler = (event: DomainEvent) => void;

/**
 * In-process pub/sub for domain events.
 *
 * Handlers are registered by event class. When an event is published,
 * any handler registered for the event's type — or for a class it
 * extends — is invoked. Handlers run synchronously and serially within
 * the publishing call site.
 *
 * The dispatcher is normally invoked indirectly: a `DbContext`
 * implementation buffers events from aggregates during a transaction
 * and publishes them after commit. Handlers should be idempotent and
 * fast — push expensive or fallible work (sending email, calling other
 * services) onto a job queue rather than doing it inline.
 *
 * @example
 * ```typescript
 * import { DomainEventDispatcher } from "@litmus/core/events";
 *
 * class OrderPlaced extends DomainEvent<OrderData> {
 *   constructor(readonly orderId: string) { super(); }
 * }
 *
 * const dispatcher = new DomainEventDispatcher();
 *
 * dispatcher.on(OrderPlaced, (event) => {
 *   console.log("order placed:", event.orderId);
 * });
 *
 * dispatcher.publish(new OrderPlaced("order_123"));
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

import type { DomainEvent } from "#litmus/domain/domain-event.ts";

type DomainEventClass = new (...args: any[]) => DomainEvent<any>;
type Handler = (event: DomainEvent<any>) => void;

/**
 * In-process pub/sub for domain events.
 *
 * Handlers are registered against an event class. When an event is
 * published, every handler whose registered class the event is an instance
 * of will fire — so a handler registered for a base class also receives
 * events of any subclass. Handlers run synchronously and serially within
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
 * class OrderPlaced extends DomainEvent<Order> {
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

  publish(event: DomainEvent<any>): void {
    for (const [eventType, handlers] of this.handlers) {
      if (event instanceof eventType) {
        for (const handler of handlers) {
          handler(event);
        }
      }
    }
  }
}

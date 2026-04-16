import { container } from "tsyringe";

import type { DomainEvent } from "#litmus/domain/domain-event.ts";
import type { CommandHandler } from "#litmus/use-case/handlers.ts";

export type DomainEventClass<E extends DomainEvent<any> = DomainEvent<any>> =
  new (...args: any[]) => E;

type Handler<E extends DomainEvent<any> = DomainEvent<any>> = (
  event: E,
) => Promise<void> | void;

/**
 * Pure shape translator: maps a domain event to the command shape a
 * `CommandHandler` expects. Used by `registerDomainEventHandlers` to
 * wire an event to a handler whose command differs from the event.
 *
 * Mappers are pure functions — no dependencies, no async. If a
 * reaction needs to look up additional state, that belongs in the
 * `CommandHandler`, not the mapper.
 */
export type DomainEventHandler<
  E extends DomainEvent<any>,
  Cmd extends Record<string, unknown>,
> = (event: E) => Cmd;

/**
 * In-process pub/sub for domain events.
 *
 * Handlers are registered against an event class. When an event is
 * published, every handler whose registered class the event is an
 * instance of will fire — so a handler registered for a base class also
 * receives events of any subclass. Handlers run serially; `publish`
 * awaits each before moving on, so async handlers are deterministic.
 *
 * Handlers are isolated: if one throws, siblings still run and the
 * error is reported via `onError` (default: `console.error`). `publish`
 * never rejects. This keeps a flaky reaction (email provider blip,
 * downstream service down) from tanking the triggering flow.
 *
 * The dispatcher is normally invoked indirectly: a `DbContext`
 * implementation buffers events from aggregates during a transaction
 * and publishes them after commit. Handlers should be idempotent.
 * Durability of events across process crashes requires an outbox, not
 * just in-process dispatch.
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
 * dispatcher.on(OrderPlaced, async (event) => {
 *   await notifyFulfilment(event.orderId);
 * });
 *
 * await dispatcher.publish(new OrderPlaced("order_123"));
 * ```
 */
export class DomainEventDispatcher {
  private handlers = new Map<DomainEventClass, Handler<any>[]>();
  private readonly onError: (err: unknown, event: DomainEvent<any>) => void;

  constructor(
    onError: (err: unknown, event: DomainEvent<any>) => void = defaultOnError,
  ) {
    this.onError = onError;
  }

  on<E extends DomainEvent<any>>(
    eventType: DomainEventClass<E>,
    handler: Handler<E>,
  ): void {
    const existing = this.handlers.get(eventType) ?? [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async publish(event: DomainEvent<any>): Promise<void> {
    for (const [eventType, handlers] of this.handlers) {
      if (event instanceof eventType) {
        for (const handler of handlers) {
          try {
            await handler(event);
          } catch (err) {
            this.onError(err, event);
          }
        }
      }
    }
  }
}

function defaultOnError(err: unknown, event: DomainEvent<any>): void {
  console.error("DomainEventDispatcher handler threw", {
    event: event.constructor.name,
    err,
  });
}

type HandlerMapping = ReadonlyArray<
  readonly [
    DomainEventClass<any>,
    new (...args: any[]) => CommandHandler<any, any>,
    DomainEventHandler<any, any>,
  ]
>;

/**
 * Wire domain events to `CommandHandler`s via shape-translation
 * functions. Resolves the dispatcher from the tsyringe container and
 * registers one handler per entry.
 *
 * Each entry is `[EventClass, CommandHandlerClass, mapper]`: the
 * mapper translates the event to the handler's command shape. The
 * `CommandHandler` itself stays independent of the event — it can
 * also be invoked from HTTP, CLI, or directly.
 *
 * @example
 * ```typescript
 * registerDomainEventHandlers([
 *   [OrderPlaced, CloseCart, (event) => ({ cartId: event.cartId })],
 *   [OrderPlaced, SendOrderConfirmation, (event) => ({
 *     customerId: event.customerId,
 *     total: event.total,
 *   })],
 * ]);
 * ```
 */
export function registerDomainEventHandlers(mapping: HandlerMapping): void {
  const dispatcher = container.resolve(DomainEventDispatcher);
  for (const [Event, Handler, toCommand] of mapping) {
    dispatcher.on(Event, async (event) => {
      await container.resolve(Handler).handle(toCommand(event));
    });
  }
}

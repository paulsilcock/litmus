import { describe, expect, it, vi } from "vite-plus/test";

import { DomainEventDispatcher } from "#litmus/domain/domain-event-dispatcher.ts";
import { DomainEvent } from "#litmus/domain/domain-event.ts";

class OrderPlaced extends DomainEvent {}

describe("DomainEventDispatcher", () => {
  it("invokes registered handlers when an event is published", () => {
    const dispatcher = new DomainEventDispatcher();
    const handler = vi.fn();

    dispatcher.on(OrderPlaced, handler);
    dispatcher.publish(new OrderPlaced());

    expect(handler).toHaveBeenCalledOnce();
  });

  it("invokes all handlers registered for the same event type", () => {
    const dispatcher = new DomainEventDispatcher();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    dispatcher.on(OrderPlaced, handler1);
    dispatcher.on(OrderPlaced, handler2);
    dispatcher.publish(new OrderPlaced());

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });
});

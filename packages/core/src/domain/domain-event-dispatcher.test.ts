import "reflect-metadata";
import { container, injectable } from "tsyringe";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import {
  DomainEventDispatcher,
  registerDomainEventHandlers,
} from "#litmus/domain/domain-event-dispatcher.ts";
import { DomainEvent } from "#litmus/domain/domain-event.ts";
import { CommandHandler } from "#litmus/use-case/handlers.ts";

class OrderPlaced extends DomainEvent {}

describe("DomainEventDispatcher", () => {
  it("invokes registered handlers when an event is published", async () => {
    const dispatcher = new DomainEventDispatcher();
    const handler = vi.fn();

    dispatcher.on(OrderPlaced, handler);
    await dispatcher.publish(new OrderPlaced());

    expect(handler).toHaveBeenCalledOnce();
  });

  it("invokes all handlers registered for the same event type", async () => {
    const dispatcher = new DomainEventDispatcher();
    const handler1 = vi.fn();
    const handler2 = vi.fn();

    dispatcher.on(OrderPlaced, handler1);
    dispatcher.on(OrderPlaced, handler2);
    await dispatcher.publish(new OrderPlaced());

    expect(handler1).toHaveBeenCalledOnce();
    expect(handler2).toHaveBeenCalledOnce();
  });

  it("awaits async handlers before publish resolves", async () => {
    const dispatcher = new DomainEventDispatcher();
    let handlerFinished = false;

    dispatcher.on(OrderPlaced, async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      handlerFinished = true;
    });

    await dispatcher.publish(new OrderPlaced());

    expect(handlerFinished).toBe(true);
  });

  it("isolates handler failures so siblings still run", async () => {
    const onError = vi.fn();
    const dispatcher = new DomainEventDispatcher(onError);
    const firstHandler = vi.fn(() => {
      throw new Error("first handler failed");
    });
    const secondHandler = vi.fn();

    dispatcher.on(OrderPlaced, firstHandler);
    dispatcher.on(OrderPlaced, secondHandler);

    await expect(
      dispatcher.publish(new OrderPlaced()),
    ).resolves.toBeUndefined();

    expect(secondHandler).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith(
      expect.any(Error),
      expect.any(OrderPlaced),
    );
  });
});

describe("registerDomainEventHandlers", () => {
  afterEach(() => {
    container.reset();
  });

  it("invokes the command handler with the mapped command", async () => {
    const dispatcher = new DomainEventDispatcher();
    container.registerInstance(DomainEventDispatcher, dispatcher);

    interface CloseCartCommand extends Record<string, unknown> {
      cartId: string;
    }

    const handleSpy = vi.fn();

    @injectable()
    class CloseCart extends CommandHandler<CloseCartCommand> {
      async handle(cmd: CloseCartCommand): Promise<void> {
        handleSpy(cmd);
      }
    }

    class OrderPlacedWithCart extends DomainEvent {
      constructor(readonly cartId: string) {
        super();
      }
    }

    registerDomainEventHandlers([
      [OrderPlacedWithCart, CloseCart, (event) => ({ cartId: event.cartId })],
    ]);

    await dispatcher.publish(new OrderPlacedWithCart("cart_123"));

    expect(handleSpy).toHaveBeenCalledOnce();
    expect(handleSpy).toHaveBeenCalledWith({ cartId: "cart_123" });
  });
});

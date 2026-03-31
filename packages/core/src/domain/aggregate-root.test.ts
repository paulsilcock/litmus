import { describe, expect, it } from "vite-plus/test";
import { AggregateRoot } from "#litmus/domain/aggregate-root.ts";
import { DomainEvent } from "#litmus/domain/domain-event.ts";

class OrderPlaced extends DomainEvent {}

class Order extends AggregateRoot {
  place() {
    this.addDomainEvent(new OrderPlaced());
  }
}

describe("AggregateRoot", () => {
  it("records domain events", () => {
    const order = new Order("order-1");
    order.place();

    expect(order.domainEvents).toHaveLength(1);
    expect(order.domainEvents[0]).toBeInstanceOf(OrderPlaced);
  });

  it("clearing returns and removes recorded events", () => {
    const order = new Order("order-1");
    order.place();
    order.place();

    const events = order.clearDomainEvents();

    expect(events).toHaveLength(2);
    expect(order.domainEvents).toHaveLength(0);
  });
});

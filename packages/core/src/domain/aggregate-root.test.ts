import { type AggregateData, AggregateRoot } from "#litmus/domain/aggregate-root.ts";
import { DomainEvent } from "#litmus/domain/domain-event.ts";
import { describe, expect, it } from "vite-plus/test";

class OrderPlaced extends DomainEvent {}

interface OrderData extends AggregateData {
  status: string;
}

class Order extends AggregateRoot<OrderData> {
  get status() {
    return this.data.status;
  }

  place() {
    this.addDomainEvent(new OrderPlaced());
  }
}

describe("AggregateRoot", () => {
  it("records domain events", () => {
    const order = new Order({ id: "order-1", status: "draft" });
    order.place();

    expect(order.domainEvents).toHaveLength(1);
    expect(order.domainEvents[0]).toBeInstanceOf(OrderPlaced);
  });

  it("clearing returns and removes recorded events", () => {
    const order = new Order({ id: "order-1", status: "draft" });
    order.place();
    order.place();

    const events = order.clearDomainEvents();

    expect(events).toHaveLength(2);
    expect(order.domainEvents).toHaveLength(0);
  });
});

import type { AggregateData } from "#litmus/domain/aggregate-root.ts";

declare const sourceSymbol: unique symbol;

export abstract class DomainEvent<
  TData extends AggregateData<any> = AggregateData<any>,
> {
  readonly occurredAt: Date;
  declare readonly [sourceSymbol]: TData;

  constructor() {
    this.occurredAt = new Date();
  }
}

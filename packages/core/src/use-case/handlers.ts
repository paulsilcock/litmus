/**
 * A use case handler class that can be resolved by the DI container.
 * Used by entrypoint adapters (HTTP, CLI, Toolbox) to accept handler
 * classes and resolve them with injected dependencies.
 */
export type HandlerClass<TInput, TResult> = new (...args: any[]) => {
  handle(input: TInput): Promise<TResult> | AsyncIterable<TResult>;
};

/**
 * Handler for commands (operations that change state).
 *
 * Dependencies are injected via the constructor.
 * Commands can return `Promise<TResult>` or `AsyncIterable<TResult>` for streaming.
 *
 * @example
 * ```typescript
 * interface PlaceOrderCommand {
 *   customerId: string;
 *   items: Array<{ productId: string; quantity: number }>;
 * }
 *
 * class PlaceOrder extends CommandHandler<PlaceOrderCommand, OrderDto> {
 *   constructor(
 *     private readonly orderRepo: OrderRepository,
 *   ) { super(); }
 *
 *   async handle(cmd: PlaceOrderCommand): Promise<OrderDto> {
 *     const id = this.orderRepo.nextId();
 *     const order = new Order({ id, status: "draft" });
 *     order.place();
 *     await this.orderRepo.add(order);
 *     return { orderId: id, status: "placed" };
 *   }
 * }
 * ```
 */
export abstract class CommandHandler<
  TCommand extends Record<string, unknown>,
  TResult = void,
> {
  abstract handle(command: TCommand): Promise<TResult> | AsyncIterable<TResult>;
}

/**
 * Handler for queries (read-only operations).
 *
 * Dependencies are injected via the constructor.
 * Queries can bypass the domain layer and read directly
 * from the database for performance (CQRS read side).
 *
 * @example
 * ```typescript
 * interface ListOrdersQuery {
 *   status?: string;
 * }
 *
 * class ListOrders extends QueryHandler<ListOrdersQuery, OrderDto[]> {
 *   constructor(private readonly db: DrizzleDbContext) { super(); }
 *
 *   async handle(query: ListOrdersQuery): Promise<OrderDto[]> {
 *     return this.db.select().from(orders).where(...);
 *   }
 * }
 * ```
 */
export abstract class QueryHandler<
  TQuery extends Record<string, unknown>,
  TResult,
> {
  abstract handle(query: TQuery): Promise<TResult> | AsyncIterable<TResult>;
}

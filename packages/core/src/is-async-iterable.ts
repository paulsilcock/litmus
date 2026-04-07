/**
 * Type guard for `AsyncIterable<T>`.
 *
 * Useful when narrowing the result of a handler that may return either
 * `Promise<T>` or `AsyncIterable<T>`.
 *
 * @example
 * ```typescript
 * if (isAsyncIterable<Token>(result)) {
 *   for await (const token of result) {
 *     console.log(token);
 *   }
 * }
 * ```
 */
export function isAsyncIterable<T>(value: unknown): value is AsyncIterable<T> {
  return (
    value !== null && typeof value === "object" && Symbol.asyncIterator in value
  );
}

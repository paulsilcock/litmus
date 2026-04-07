export class ConcurrencyError extends Error {
  constructor(
    readonly aggregateId: string,
    readonly expectedVersion: number,
  ) {
    super(
      `ConcurrencyError: aggregate ${aggregateId} has been modified since version ${expectedVersion}`,
    );
    this.name = "ConcurrencyError";
  }
}

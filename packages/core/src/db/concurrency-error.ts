export class ConcurrencyError extends Error {
  constructor(
    readonly aggregateId: string,
    readonly expectedVersion: number,
    readonly actualVersion: number,
  ) {
    super(
      `ConcurrencyError: aggregate ${aggregateId} expected version ${expectedVersion} but found ${actualVersion}`,
    );
    this.name = "ConcurrencyError";
  }
}

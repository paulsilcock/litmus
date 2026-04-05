export interface DbContext<TDb> {
  readonly db: TDb;
  transaction(fn: () => Promise<void>): Promise<void>;
}

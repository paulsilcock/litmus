export interface Transaction {
  execute(fn: () => Promise<void>): Promise<void>;
}

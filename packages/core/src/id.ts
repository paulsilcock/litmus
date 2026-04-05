import { ulid } from "ulidx";

export type PrefixedUlid<T extends string> = `${T}_${string}`;

export function prefixedUlid<T extends string>(prefix: T): PrefixedUlid<T> {
  return `${prefix}_${ulid()}`;
}

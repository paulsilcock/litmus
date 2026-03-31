export abstract class ValueObject {
  protected abstract properties(): Record<string, unknown>;

  equals(other: ValueObject): boolean {
    if (this.constructor !== other.constructor) return false;

    const a = this.properties();
    const b = other.properties();
    const keys = Object.keys(a);

    if (keys.length !== Object.keys(b).length) return false;
    return keys.every((key) => a[key] === b[key]);
  }
}

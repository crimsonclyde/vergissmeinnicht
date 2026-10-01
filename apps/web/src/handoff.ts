/**
 * Hands a small value from one page to the next one shown — e.g. "this List was deleted a moment ago",
 * so the page that follows can offer Undo. In memory only: it does not survive a reload, and it is
 * never sent anywhere. The receiving page reads it when it first renders and clears it once shown.
 */
const values = new Map<string, unknown>();

export function handOver(key: string, value: unknown): void {
  values.set(key, value);
}

export function handedOver<T>(key: string): T | undefined {
  return values.get(key) as T | undefined;
}

export function clearHandOver(key: string): void {
  values.delete(key);
}

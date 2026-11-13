const MAX_ENTRIES = 1000;
const cache = new Map<string, string>();

export function remember(key: string, value: string): void {
  // empty the cache once it is full
  if (cache.size >= MAX_ENTRIES) cache.clear();
  cache.set(key, value);
}

// A node:test reporter that writes every event as one line of JSON, so the events of the shards of a run can be replayed through tests/harness/reporter.ts as one run (tests/harness/merge.ts).
function plain(value: unknown, depth = 0): unknown {
  if (depth > 8) return undefined;
  if (value instanceof Error) {
    const out: Record<string, unknown> = { name: value.name, message: value.message, stack: value.stack };
    for (const key of Object.keys(value)) out[key] = plain((value as unknown as Record<string, unknown>)[key], depth + 1);
    if ('cause' in value) out.cause = plain(value.cause, depth + 1);
    return out;
  }
  if (Array.isArray(value)) return value.map((item) => plain(item, depth + 1));
  if (value instanceof Map) return plain(Object.fromEntries(value), depth + 1);
  if (value instanceof Set) return plain([...value], depth + 1);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) out[key] = plain(item, depth + 1);
    return out;
  }
  if (typeof value === 'bigint') return String(value);
  if (typeof value === 'function' || typeof value === 'symbol') return undefined;
  return value;
}

export default async function* record(source: AsyncIterable<{ type: string; data: unknown }>): AsyncGenerator<string> {
  for await (const event of source) yield `${JSON.stringify({ type: event.type, data: plain(event.data) })}\n`;
}

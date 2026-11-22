// The owner's ruling, decision 89 of design/decisions.md: the exact key is written as [key] wherever Lawcheck prints or writes it.
export const KEY_SHOWN = '[key]';

const NAMED_ESCAPES: Record<string, string> = { '"': '\\"', '\\': '\\\\', '/': '\\/', '\b': '\\b', '\f': '\\f', '\n': '\\n', '\r': '\\r', '\t': '\\t' };

// The key in any spelling JSON allows: each character as it is, as a \u escape, or by its short escape.
function spellings(key: string): string {
  const parts = [...key].map((c) => {
    const units = [...Array(c.length).keys()]
      .map((i) => `\\\\u${[...c.charCodeAt(i).toString(16).padStart(4, '0')].map((d) => (/[a-f]/.test(d) ? `[${d}${d.toUpperCase()}]` : d)).join('')}`)
      .join('');
    const named = NAMED_ESCAPES[c];
    return `(?:${named === undefined ? '' : `${named.replace(/\\/g, '\\\\')}|`}${units}|${c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')})`;
  });
  return parts.join('');
}

// The build's reading of the ruling: a key shorter than this is no secret, such as a dummy key for a local endpoint, and replacing it would garble names that hold it.
export const SHORTEST = 8;

export function hidden(text: string, keys: string[]): string {
  const list = [...new Set(keys)].filter((key) => [...key].length >= SHORTEST).sort((a, b) => b.length - a.length);
  if (list.length === 0) return text;
  // [key] itself is matched first, so a text that passes here twice stays as it was.
  return text.replace(new RegExp(['\\[key\\]', ...list.map(spellings)].join('|'), 'g'), KEY_SHOWN);
}

// The environment key goes to whichever HTTP provider is configured, so it is hidden in every run; the configured provider adds the keys it would send or pass on once the config is read.
export const KEY_VARIABLES = ['LAWCHECK_REVIEWER_KEY'];

let known: string[] = [];
let environment: Record<string, string | undefined> = {};

export function useKeys(env: Record<string, string | undefined>): void {
  environment = env;
  known = KEY_VARIABLES.map((name) => env[name] ?? '').filter((key) => key !== '');
}

export function keyEnvironment(): Record<string, string | undefined> {
  return environment;
}

export function addKeys(keys: string[]): void {
  known = [...new Set([...known, ...keys])];
}

export function hide(text: string): string {
  return hidden(text, known);
}

// The fields of a document that hold text from outside Lawcheck; its own fields, such as schema, code, the ids and the counts, stay as they are.
const OUTSIDE_FIELDS = new Set(['file', 'files', 'message', 'base', 'path', 'paths', 'reason', 'what', 'candidates', 'answer', 'text', 'about', 'pattern', 'content', 'why', 'model']);

// The key written as [key] in the strings of the outside fields; the layout is the one every document has.
export function hiddenJson(text: string): string {
  let document: unknown;
  try {
    document = JSON.parse(text);
  } catch {
    return text;
  }
  const masked = (value: unknown): unknown => (typeof value === 'string' ? hide(value) : Array.isArray(value) ? value.map(masked) : value);
  const walk = (value: unknown): unknown =>
    Array.isArray(value) ? value.map(walk) : value !== null && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([name, item]) => [name, OUTSIDE_FIELDS.has(name) ? masked(item) : walk(item)])) : value;
  return JSON.stringify(walk(document), null, 2) + '\n';
}

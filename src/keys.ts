// The owner's ruling of question 89 (spec/questions.md): the exact key is written as [key] wherever Lawcheck prints or writes it.
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

// The variables a provider reads a key from; their values are hidden in all output, whichever provider is in force.
export const KEY_VARIABLES = ['LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY', 'OPENAI_API_KEY', 'GOOGLE_API_KEY'];

let known: string[] = [];

export function useKeys(env: Record<string, string | undefined>): void {
  known = KEY_VARIABLES.map((name) => env[name] ?? '').filter((key) => key !== '');
}

export function addKeys(keys: string[]): void {
  known = [...new Set([...known, ...keys])];
}

export function hide(text: string): string {
  return hidden(text, known);
}

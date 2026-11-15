const cache = new Map<string, RegExp>();

export function globToRegExp(pattern: string, separator = '/'): RegExp {
  const key = `${separator}\0${pattern}`;
  const known = cache.get(key);
  if (known) return known;
  const sep = separator.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  let out = '';
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === '*' && pattern[i + 1] === '*') {
      const slash = pattern[i + 2] === separator;
      out += slash ? `(?:.*${sep})?` : '.*';
      i += slash ? 2 : 1;
      continue;
    }
    if (c === '*') { out += `[^${sep}]*`; continue; }
    if (c === '?') { out += `[^${sep}]`; continue; }
    if (c === '{') {
      const close = pattern.indexOf('}', i);
      if (close !== -1) {
        out += `(?:${pattern.slice(i + 1, close).split(',').map((p) => p.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})`;
        i = close;
        continue;
      }
    }
    out += c.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  }
  const re = new RegExp(`^${out}$`);
  cache.set(key, re);
  return re;
}

export function matchesAny(path: string, patterns: readonly string[], separator = '/'): boolean {
  return patterns.some((p) => globToRegExp(p, separator).test(path));
}

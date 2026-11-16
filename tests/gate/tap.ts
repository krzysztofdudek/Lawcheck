export type Result = { name: string; depth: number; ok: boolean; directive: 'skip' | 'todo' | null; reason: string };

function unescape(text: string): string {
  return text.replace(/\\([\\#])/g, '$1').replace(/\\n/g, '\n').replace(/\\r/g, '\r').replace(/\\t/g, '\t');
}

export function readTap(text: string): Result[] {
  const out: Result[] = [];
  for (const line of text.split('\n')) {
    const m = /^( *)(not ok|ok) \d+ - ((?:[^#\\]|\\.)*?)(?: # (SKIP|TODO)\b ?(.*))?$/.exec(line);
    if (!m) continue;
    out.push({
      name: unescape(m[3]!.trim()),
      depth: m[1]!.length / 4,
      ok: m[2] === 'ok',
      directive: m[4] ? (m[4].toLowerCase() as 'skip' | 'todo') : null,
      reason: m[5] ? unescape(m[5]) : '',
    });
  }
  return out;
}

export type Verdict = 'red' | 'green' | 'skipped' | 'did not run';

export function verdictOf(results: Result[], pattern: RegExp): Verdict {
  const mine = results.filter((r) => pattern.test(r.name));
  if (mine.length === 0) return 'did not run';
  if (mine.some((r) => !r.ok && r.directive !== 'todo')) return 'red';
  if (mine.every((r) => r.directive === 'skip')) return 'skipped';
  return 'green';
}

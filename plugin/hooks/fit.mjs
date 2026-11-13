import { points } from './start.mjs';

export const LIMIT = 9000;

export function fit(header, output) {
  const head = header === null ? [] : [header, ''];
  const whole = [...head, ...output].join('\n');
  if (points(whole) <= LIMIT || output.length === 0) return whole;
  const lastLine = output.length > 1 && output[output.length - 1].startsWith('next: ') ? output[output.length - 1] : null;
  const middle = output.slice(1, lastLine === null ? output.length : output.length - 1);
  const more = (k) => `... ${k} more lines not shown; run the command yourself to see them all`;
  const size = (lines) => points(lines.join('\n'));
  const kept = [...head, output[0]];
  let used = size(kept);
  const tail = (k) => 1 + points(more(k)) + (lastLine === null ? 0 : 1 + points(lastLine));
  let taken = 0;
  while (taken < middle.length) {
    const next = used + 1 + points(middle[taken]);
    if (next + tail(middle.length - taken - 1) > LIMIT) break;
    used = next;
    kept.push(middle[taken]);
    taken++;
  }
  kept.push(more(middle.length - taken));
  if (lastLine !== null) kept.push(lastLine);
  return kept.join('\n');
}

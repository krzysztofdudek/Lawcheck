import { moreLines } from './messages.mjs';
import { cutLine } from './start.mjs';

// The host counts a hook's text in characters it does not define; UTF-16 code units are never fewer than code points, so a text within the limit in units is within it either way.
export const LIMIT = 9000;

const UNITS = { most: LIMIT, size: (text) => text.length };

export function fit(header, output, limit = UNITS) {
  const { most, size } = limit;
  const head = header === null ? [] : [cutLine(header), ''];
  const lines = output.map(cutLine);
  const whole = [...head, ...lines].join('\n');
  if (size(whole) <= most || lines.length === 0) return whole;
  const lastLine = lines.length > 1 && lines[lines.length - 1].startsWith('next: ') ? lines[lines.length - 1] : null;
  const middle = lines.slice(1, lastLine === null ? lines.length : lines.length - 1);
  const kept = [...head, lines[0]];
  let used = size(kept.join('\n'));
  const tail = (k) => 1 + size(moreLines(k)) + (lastLine === null ? 0 : 1 + size(lastLine));
  let taken = 0;
  while (taken < middle.length) {
    const next = used + 1 + size(middle[taken]);
    if (next + tail(middle.length - taken - 1) > most) break;
    used = next;
    kept.push(middle[taken]);
    taken++;
  }
  kept.push(moreLines(middle.length - taken));
  if (lastLine !== null) kept.push(lastLine);
  return kept.join('\n');
}

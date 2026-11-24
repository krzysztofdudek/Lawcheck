export const MARKER = 'lawcheck-waive';

export interface Waiver {
  line: number;
  rule: string;
  reason: string;
  covers: number | null;
  waived: number;
}

export interface WaiverProblem {
  code: 'waiver-unknown-rule' | 'waiver-without-reason';
  line: number;
  message: string;
}

interface Marked {
  index: number;
  alone: boolean;
}

function marked(text: string): Marked | null {
  const index = text.indexOf(MARKER);
  if (index < 0) return null;
  return { index, alone: !/[\p{L}\p{N}]/u.test(text.slice(0, index)) };
}

function withoutClosing(rest: string): string {
  const text = rest.trimEnd();
  for (const closing of ['*/', '-->']) if (text.endsWith(closing)) return text.slice(0, -closing.length);
  return text;
}

export function parseWaivers(lines: string[], rules: Set<string>): { waivers: Waiver[]; problems: WaiverProblem[] } {
  const marks = lines.map(marked);
  const waivers: Waiver[] = [];
  const problems: WaiverProblem[] = [];
  marks.forEach((mark, index) => {
    if (mark === null) return;
    const line = index + 1;
    const after = lines[index]!.slice(mark.index + MARKER.length);
    const id = after.match(/^\s+(\S+)/u);
    if (id === null) {
      const runOn = after.match(/^\S+/u);
      const message = runOn ? `the marker runs on into '${MARKER}${runOn[0]}' instead of naming a rule` : 'no rule id follows the marker';
      problems.push({ code: 'waiver-unknown-rule', line, message });
      return;
    }
    const rule = id[1]!;
    if (!rules.has(rule)) {
      problems.push({ code: 'waiver-unknown-rule', line, message: `the waiver names '${rule}', which is no rule of the law` });
      return;
    }
    const rest = withoutClosing(after.slice(id[0].length));
    const dashes = rest.match(/^\s+--/u);
    const reason = dashes === null ? '' : rest.slice(dashes[0].length).trim();
    if (/^[\s\p{Cf}]*$/u.test(reason)) {
      problems.push({ code: 'waiver-without-reason', line, message: `the waiver of '${rule}' gives no reason after --` });
      return;
    }
    let covers: number | null = line;
    if (mark.alone) {
      covers = null;
      for (let next = index + 1; next < lines.length; next++) {
        if (!marks[next]?.alone) {
          covers = next + 1;
          break;
        }
      }
    }
    waivers.push({ line, rule, reason, covers, waived: 0 });
  });
  return { waivers, problems };
}

export function waivedLines(waivers: Waiver[], rule: string): number[] {
  return [...new Set(waivers.filter((w) => w.rule === rule && w.covers !== null).map((w) => w.covers!))].sort((a, b) => a - b);
}

export function waive(waivers: Waiver[], rule: string, line: number): boolean {
  const own = waivers.find((w) => w.rule === rule && w.covers === line && w.line === line);
  const above = waivers
    .filter((w) => w.rule === rule && w.covers === line && w.line !== line)
    .sort((a, b) => b.line - a.line)[0];
  const waiver = own ?? above;
  if (waiver === undefined) return false;
  waiver.waived++;
  return true;
}

export function addedWaivers(now: Waiver[], nowLines: string[], before: Waiver[], beforeLines: string[]): Set<Waiver> {
  const key = (waiver: Waiver) => `${waiver.rule}\u0000${waiver.reason}`;
  const held = new Map<string, string[]>();
  for (const waiver of before) held.set(key(waiver), [...(held.get(key(waiver)) ?? []), beforeLines[waiver.line - 1]!.trim()]);
  const groups = new Map<string, Waiver[]>();
  for (const waiver of now) groups.set(key(waiver), [...(groups.get(key(waiver)) ?? []), waiver]);
  const added = new Set<Waiver>();
  for (const [at, group] of groups) {
    const texts = [...(held.get(at) ?? [])];
    const extra = group.length - texts.length;
    if (extra <= 0) continue;
    const fresh = group.filter((waiver) => {
      const found = texts.indexOf(nowLines[waiver.line - 1]!.trim());
      if (found < 0) return true;
      texts.splice(found, 1);
      return false;
    });
    for (const waiver of fresh.slice(-extra)) added.add(waiver);
  }
  return added;
}

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

function reasonOf(rest: string): string {
  let reason = rest.trim();
  for (const closing of ['*/', '-->']) {
    if (reason.endsWith(closing)) {
      reason = reason.slice(0, -closing.length).trim();
      break;
    }
  }
  return reason;
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
    const rest = after.slice(id[0].length);
    const dashes = rest.match(/^\s+--/u);
    const reason = dashes === null ? '' : reasonOf(rest.slice(dashes[0].length));
    if (reason === '') {
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

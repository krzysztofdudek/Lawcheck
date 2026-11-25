export type Range = { startOffset: number; endOffset: number; count: number };
export type Script = { url: string; functions: { ranges: Range[] }[] };
export type Segment = { offset: number; source: number; line: number };
export type FileList = { file: string; code: number; loaded: boolean; unreached: number[]; text: string[] };

// V8 gives a function's own range first and the blocks inside it after, and a function inside another as an entry of its own: the innermost range that holds a character says whether it ran.
export function paint(script: Script, length: number, into: Uint8Array): void {
  const ranges = script.functions.flatMap((f) => f.ranges).sort((a, b) => a.startOffset - b.startOffset || b.endOffset - a.endOffset);
  const ran = new Uint8Array(length);
  for (const range of ranges) ran.fill(range.count > 0 ? 1 : 0, Math.min(range.startOffset, length), Math.min(range.endOffset, length));
  for (let i = 0; i < length; i++) if (ran[i] === 1) into[i] = 1;
}

export function scriptLength(script: Script): number {
  let length = 0;
  for (const f of script.functions) for (const range of f.ranges) if (range.endOffset > length) length = range.endOffset;
  return length;
}

const DIGITS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

// The mappings of a source map, version 3: each segment of the built file with the source line it was built from, lines from 0.
export function segments(mappings: string, built: string): Segment[] {
  const starts = [0];
  for (let at = built.indexOf('\n'); at >= 0; at = built.indexOf('\n', at + 1)) starts.push(at + 1);
  const out: Segment[] = [];
  let source = 0;
  let line = 0;
  let sourceColumn = 0;
  let name = 0;
  mappings.split(';').forEach((group, builtLine) => {
    let column = 0;
    for (const segment of group.split(',')) {
      if (segment === '') continue;
      const fields: number[] = [];
      let value = 0;
      let shift = 0;
      for (const char of segment) {
        const digit = DIGITS.indexOf(char);
        if (digit < 0) throw new Error(`the source map holds a character that is no base64 digit: ${char}`);
        value += (digit & 31) << shift;
        if (digit & 32) shift += 5;
        else {
          fields.push(value & 1 ? -(value >> 1) : value >> 1);
          value = 0;
          shift = 0;
        }
      }
      column += fields[0]!;
      if (fields.length < 4) continue;
      source += fields[1]!;
      line += fields[2]!;
      sourceColumn += fields[3]!;
      if (fields.length > 4) name += fields[4]!;
      out.push({ offset: starts[builtLine]! + column, source, line });
    }
  });
  void sourceColumn;
  void name;
  return out;
}

// A line of a source file is code when the build made something from it, and reached when any character made from it ran. The build keeps comments, which are no code.
export function unreachedLines(all: Segment[], source: number, ran: Uint8Array, comment: (line: number) => boolean = () => false): { code: number; unreached: number[] } {
  const reached = new Map<number, boolean>();
  for (const segment of all) {
    if (segment.source !== source || comment(segment.line + 1)) continue;
    reached.set(segment.line, (reached.get(segment.line) ?? false) || ran[segment.offset] === 1);
  }
  const unreached = [...reached].filter(([, was]) => !was).map(([line]) => line + 1).sort((a, b) => a - b);
  return { code: reached.size, unreached };
}

export function spans(lines: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const line of lines) {
    const last = out.at(-1);
    if (last !== undefined && last[1] === line - 1) last[1] = line;
    else out.push([line, line]);
  }
  return out;
}

function shown(text: string): string {
  const trimmed = text.trim().replace(/`/g, "'");
  return trimmed.length > 100 ? `${trimmed.slice(0, 100)}...` : trimmed;
}

export function render(files: FileList[], facts: { ran: string; red: boolean; processes: number; system: string; unmeasured: Record<string, string> }): string {
  const withLines = files.filter((f) => f.unreached.length > 0).sort((a, b) => b.unreached.length - a.unreached.length || a.file.localeCompare(b.file));
  const code = files.reduce((sum, f) => sum + f.code, 0);
  const unreached = files.reduce((sum, f) => sum + f.unreached.length, 0);
  const lines = [
    '# The lines of src/ that no test reached',
    '',
    `In ${withLines.length} of ${files.length} files, ${unreached} of ${code} lines of code ran in no process of \`${facts.ran}\` (${facts.processes} processes wrote what they ran). This is a list to read, with no threshold: a line here is either dead, or a place where a fault would turn no test red.`,
    '',
    `A line counts as reached when any part of it ran, so a branch on one line with its condition does not show. A process that is killed writes nothing, so a line that runs only in a process a test kills is listed. The run was on ${facts.system}, so a line that only another system runs is listed too.`,
  ];
  if (facts.red) lines.push('', 'The tests of this run ended red, so the list may hold lines that a passing run reaches.');
  for (const file of withLines) {
    lines.push('', `## ${file.file}: ${file.unreached.length} of ${file.code}`, '');
    const note = facts.unmeasured[file.file];
    if (note !== undefined) lines.push(`${note}`, '');
    if (!file.loaded) lines.push('No process loaded this file.', '');
    for (const [from, to] of spans(file.unreached)) lines.push(`- ${from === to ? from : `${from} to ${to}`}: \`${shown(file.text[from - 1] ?? '')}\``);
  }
  const whole = files.filter((f) => f.unreached.length === 0).map((f) => f.file).sort();
  if (whole.length > 0) lines.push('', '## Every line reached', '', whole.join(', '));
  return `${lines.join('\n')}\n`;
}

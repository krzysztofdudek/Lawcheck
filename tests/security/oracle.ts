// spec/check-slice.md, section 6, invariant I-out-1: the characters no text output holds, and the lines a CI runner reads as a command.
// Every control character but the line feed, the two separators, and every format character (Unicode category Cf) but the joiners U+200C and U+200D.
export const FORBIDDEN = /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/u;
const FORBIDDEN_ALL = new RegExp(FORBIDDEN.source, 'gu');

export function outputProblem(text: string): string | null {
  const lines = text.split('\n');
  for (const [index, line] of lines.entries()) {
    if (FORBIDDEN.test(line)) return `line ${index + 1} holds U+${line.match(FORBIDDEN)![0].codePointAt(0)!.toString(16)}: ${JSON.stringify(line)}`;
    if (/^\s*(::|##\[)/u.test(line) || line.includes('##vso[')) return `line ${index + 1} reads as a CI command: ${JSON.stringify(line)}`;
  }
  return null;
}

export function jsonProblem(text: string): string | null {
  const raw = /[\u007f-\u009f\u2028\u2029]|(?![\u200c\u200d])\p{Cf}/u.exec(text);
  return raw === null ? null : `the document holds U+${raw[0].codePointAt(0)!.toString(16)} raw`;
}

// The escapes section 6 gives for text the tool does not own, written here from the spec.
export function expectedField(text: string): string {
  return text.replace(/\n/g, '\\n').replace(FORBIDDEN_ALL, (c) => {
    if (c === '\r') return '\\r';
    if (c === '\t') return '\\t';
    const code = c.codePointAt(0)!;
    if (code < 0x80) return `\\x${code.toString(16).padStart(2, '0')}`;
    return [...Array(c.length).keys()].map((i) => `\\u${c.charCodeAt(i).toString(16).padStart(4, '0')}`).join('');
  });
}

export function expectedLine(line: string): string {
  return line.replaceAll('##vso[', '\\x23#vso[').replace(/^(\s*)([:#])/u, (whole, space: string, first: string) =>
    /^\s*(::|##\[)/u.test(line) ? `${space}\\x${first.charCodeAt(0).toString(16)}` : whole,
  );
}

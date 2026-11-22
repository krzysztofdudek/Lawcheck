import { readFileSync, realpathSync } from 'node:fs';

export const PARTS = ['Meaning', 'Typical cause', 'Fix', 'Example'];

// The page shows the temporary folder of a test and the node that runs it as these, since both differ from machine to machine.
export const SHOWN_DIR = '/home/you/projects';
export const SHOWN_NODE = '/usr/local/bin/node';

export function codesPage(): string {
  return readFileSync(new URL('../../docs/codes.md', import.meta.url), 'utf8');
}

function sectionOf(lines: string[], code: string): string[] | null {
  const at = lines.indexOf(`## ${code}`);
  if (at < 0) return null;
  const end = lines.findIndex((line, i) => i > at && line.startsWith('## '));
  return lines.slice(at + 1, end < 0 ? lines.length : end);
}

function blockAfter(section: string[], label: number): { text: string; rest: string[] } | null {
  let i = label + 1;
  while (i < section.length && section[i] === '') i++;
  if (section[i] !== '```text') return null;
  const close = section.indexOf('```', i + 1);
  if (close < 0) return null;
  return { text: section.slice(i + 1, close).join('\n'), rest: section.slice(close + 1) };
}

export function partsProblems(page: string, codes: Iterable<string>): string[] {
  const lines = page.split('\n');
  const problems: string[] = [];
  for (const code of codes) {
    const headings = lines.filter((line) => line === `## ${code}`).length;
    if (headings !== 1) {
      problems.push(`${code}: docs/codes.md holds ${headings} headings ## ${code}, and it needs one`);
      continue;
    }
    const section = sectionOf(lines, code)!;
    const labels = section.flatMap((line, i) => (/^\*\*[^*]+\*\*$/.test(line) ? [{ part: line.slice(2, -2), i }] : []));
    const parts = labels.map((l) => l.part);
    if (parts.join('|') !== PARTS.join('|')) {
      problems.push(`${code}: the parts are ${parts.join(', ') || 'none'}, and they must be ${PARTS.join(', ')}, in that order`);
      continue;
    }
    for (let k = 0; k < PARTS.length - 1; k++) {
      if (section.slice(labels[k]!.i + 1, labels[k + 1]!.i).every((line) => line.trim() === '')) problems.push(`${code}: ${PARTS[k]} holds no text`);
    }
    const block = blockAfter(section, labels[PARTS.length - 1]!.i);
    if (block === null || !block.text.startsWith('$ lawcheck ')) problems.push(`${code}: the Example is no text block that opens with a $ lawcheck command`);
    else if (block.rest.some((line) => line.trim() !== '')) problems.push(`${code}: text follows the block of its Example`);
  }
  return problems;
}

export function exampleOf(page: string, code: string): string | null {
  const section = sectionOf(page.split('\n'), code);
  if (section === null) return null;
  const label = section.indexOf('**Example**');
  return label < 0 ? null : (blockAfter(section, label)?.text ?? null);
}

function escaped(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// A run as the page shows it: the command, then its standard output, with the test's folder and node written as the page writes them.
export function shownRun(argv: string[], stdout: string, dir: string): string {
  let text = stdout.replace(/\n$/, '');
  for (const folder of new Set([dir, realpathSync.native(dir)])) {
    text = text.replace(new RegExp(`${escaped(folder)}((?:[\\\\/][^\\s,'"]*)*)`, 'g'), (_, rest: string) => SHOWN_DIR + rest.replace(/\\/g, '/'));
  }
  text = text.split(process.execPath).join(SHOWN_NODE);
  return `$ lawcheck ${argv.join(' ')}\n${text}`;
}

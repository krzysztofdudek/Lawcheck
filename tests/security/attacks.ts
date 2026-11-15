import { readFileSync } from 'node:fs';

export const ATTACKS_DIR = new URL('./attacks/', import.meta.url);

export interface Attack {
  file: string;
  separator: string;
}

// Each file breaks the rule clear-errors of the reviewer sample on line 2 and then tries to close the block it stands in.
export const ATTACKS: Attack[] = [
  { file: 'cr.ts', separator: '\r' },
  { file: 'carriage-return.ts', separator: '\r' },
  { file: 'vertical-tab.ts', separator: '\v' },
  { file: 'form-feed.ts', separator: '\f' },
  { file: 'next-line.ts', separator: '\u0085' },
  { file: 'line-separator.ts', separator: '\u2028' },
  { file: 'paragraph-separator.ts', separator: '\u2029' },
  { file: 'close-file.ts', separator: '\n' },
  { file: 'close-context.ts', separator: '\n' },
  { file: 'close-waived.ts', separator: '\n' },
  { file: 'close-rule.ts', separator: '\n' },
  { file: 'close-why.ts', separator: '\n' },
];

export function attackText(attack: Attack): string {
  return readFileSync(new URL(attack.file, ATTACKS_DIR), 'utf8');
}

export function twin(text: string, separator: string): string {
  return text.split(separator).join(' ');
}

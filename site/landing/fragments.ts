import { readFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';

type Block =
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] }
  | { kind: 'table'; rows: string[][] }
  | { kind: 'code'; lang: string; code: string };

interface Section {
  heading: string;
  blocks: Block[];
}

const cells = (line: string): string[] =>
  line
    .trim()
    .replace(/^\||\|$/g, '')
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim().replace(/\\\|/g, '|'));

export function sectionsOf(markdown: string): Section[] {
  const sections: Section[] = [{ heading: '', blocks: [] }];
  const lines = markdown.split('\n');
  const add = (block: Block): void => {
    sections.at(-1)!.blocks.push(block);
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;
    const fence = /^(```|~~~)(\S*)/.exec(line);
    if (fence) {
      const end = lines.findIndex((other, at) => at > i && other.startsWith(fence[1]!));
      add({ kind: 'code', lang: fence[2] || 'text', code: lines.slice(i + 1, end).join('\n') });
      i = end;
      continue;
    }
    const heading = /^#{1,6}\s+(.*)$/.exec(line);
    if (heading) {
      sections.push({ heading: heading[1]!.trim(), blocks: [] });
      continue;
    }
    if (line.trim() === '') continue;
    let end = i;
    while (end + 1 < lines.length && lines[end + 1]!.trim() !== '' && !/^(#|```|~~~)/.test(lines[end + 1]!)) end++;
    const chunk = lines.slice(i, end + 1);
    if (chunk[0]!.startsWith('|')) add({ kind: 'table', rows: chunk.filter((row) => !/^\|[\s:|-]+\|$/.test(row.trim())).map(cells) });
    else if (/^[-*] /.test(chunk[0]!)) {
      const items: string[] = [];
      for (const row of chunk) {
        if (/^[-*] /.test(row)) items.push(row.slice(2).trim());
        else items[items.length - 1] += ` ${row.trim()}`;
      }
      add({ kind: 'list', items });
    } else add({ kind: 'paragraph', text: chunk.map((row) => row.trim()).join(' ') });
    i = end;
  }
  return sections;
}

export const sentencesOf = (paragraph: string): string[] => paragraph.split(/(?<=[.!?])\s+(?=[A-Za-z`"'(])/);

export class Fragments {
  readonly root: string;
  private readonly cache = new Map<string, Section[]>();

  constructor(root: string) {
    this.root = root;
  }

  read(file: string): string {
    return readFileSync(join(this.root, file), 'utf8');
  }

  private section(file: string, heading: string): Section {
    if (!this.cache.has(file)) this.cache.set(file, sectionsOf(this.read(file)));
    const found = this.cache.get(file)!.filter((section) => section.heading === heading);
    if (found.length !== 1) throw new Error(`site/landing: ${file} has ${found.length} headings "${heading}", and the landing page pulls from exactly one`);
    return found[0]!;
  }

  private nth<K extends Block['kind']>(file: string, heading: string, kind: K, n: number): Extract<Block, { kind: K }> {
    const blocks = this.section(file, heading).blocks.filter((block): block is Extract<Block, { kind: K }> => block.kind === kind);
    const block = blocks[n - 1];
    if (!block) throw new Error(`site/landing: ${file} has no ${kind} ${n} under "${heading}"`);
    return block;
  }

  heading(file: string, heading: string): string {
    return this.section(file, heading).heading;
  }

  paragraph(file: string, heading: string, n: number): string {
    return this.nth(file, heading, 'paragraph', n).text;
  }

  sentence(file: string, heading: string, n: number, m: number): string {
    const sentence = sentencesOf(this.paragraph(file, heading, n))[m - 1];
    if (!sentence) throw new Error(`site/landing: paragraph ${n} under "${heading}" of ${file} has no sentence ${m}`);
    return sentence;
  }

  code(file: string, heading: string, n: number): { lang: string; code: string } {
    const { lang, code } = this.nth(file, heading, 'code', n);
    return { lang, code };
  }

  list(file: string, heading: string, n: number): string[] {
    return this.nth(file, heading, 'list', n).items;
  }

  rows(file: string, heading: string, n: number, first: string[]): string[][] {
    const rows = this.nth(file, heading, 'table', n).rows;
    return [rows[0]!, ...first.map((cell) => {
      const row = rows.find((candidate) => candidate[0] === cell);
      if (!row) throw new Error(`site/landing: table ${n} under "${heading}" of ${file} has no row "${cell}"`);
      return row;
    })];
  }
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export function hrefOf(href: string, from: string, docs: string, github: string): string {
  if (/^[a-z]+:/.test(href)) return href;
  const [path, anchor] = href.split('#') as [string, string | undefined];
  const hash = anchor === undefined ? '' : `#${anchor}`;
  const target = path === '' ? from : posix.normalize(posix.join(dirname(from), path));
  const page = /^docs\/([\w-]+)\.md$/.exec(target);
  if (page) return `${docs}${page[1] === 'index' ? '' : `${page[1]}.html`}${hash}`;
  return `${github}/blob/main/${target}${hash}`;
}

export function inline(markdown: string, from: string, docs: string, github: string): string {
  return markdown
    .split(/(`[^`]+`)/)
    .map((part) => {
      if (part.startsWith('`') && part.endsWith('`') && part.length > 1) return `<code>${escape(part.slice(1, -1))}</code>`;
      let out = '';
      let at = 0;
      for (const match of part.matchAll(/\[([^\]]+)\]\(([^)\s]+)\)/g)) {
        out += escape(part.slice(at, match.index));
        out += `<a href="${escape(hrefOf(match[2]!, from, docs, github))}">${inline(match[1]!, from, docs, github)}</a>`;
        at = match.index! + match[0].length;
      }
      return out + escape(part.slice(at));
    })
    .join('');
}

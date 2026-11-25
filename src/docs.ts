import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { documentOf, usageError } from './args.js';
import type { Arguments, CheckContext, Result } from './args.js';
import { nearestKey } from './law.js';
import { renderErrors } from './output.js';

export interface Topic {
  id: string;
  title: string;
  section: string;
}

export const DOCS_DIR = fileURLToPath(new URL('../docs/', import.meta.url));

class Missing extends Error {}

function packaged(file: string): string {
  try {
    return readFileSync(`${DOCS_DIR}${file}`, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    throw new Missing(`${file} is missing from this installation of Lawcheck`);
  }
}

export function topics(): Topic[] {
  return JSON.parse(packaged('topics.json')) as Topic[];
}

export function page(id: string): string {
  return packaged(`${id}.md`);
}

export function topicList(list: Topic[]): string {
  const lines = [`lawcheck docs: ${list.length} topics; lawcheck docs <topic> prints one`];
  for (const section of new Set(list.map((t) => t.section))) {
    lines.push('', section, ...list.filter((t) => t.section === section).map((t) => `  ${t.id}  ${t.title}`));
  }
  return lines.join('\n') + '\n';
}

export function forTerminal(text: string, ids: string[]): string {
  let fenced = false;
  return text
    .split('\n')
    .map((line) => {
      if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
      if (fenced) return line;
      return line.replace(/(`+)[\s\S]*?\1|\[([^\]]+)\]\(([a-z0-9-]+)\.md(#[^)\s]*)?\)/g, (found, code: string | undefined, label: string, id: string) => (code === undefined && ids.includes(id) ? `${label} (lawcheck docs ${id})` : found));
    })
    .join('\n');
}

// Claude Code reads 30,000 characters of one command's output back into the result; past that an agent gets a file and its first 2 KB.
export const PRINTED_CHARS = 30_000;
const WHOLE_CHANGELOG = 'The older releases are not printed here. The whole changelog is in `docs/changelog.md` of the installed package and at https://docs.lawcheck.dev/changelog.html.';

export function fitChangelog(text: string, limit: number = PRINTED_CHARS): string {
  if ([...text].length <= limit) return text;
  const lines = text.split('\n');
  const starts: number[] = [];
  let fenced = false;
  lines.forEach((line, at) => {
    if (/^\s*(```|~~~)/.test(line)) fenced = !fenced;
    else if (!fenced && line.startsWith('## ')) starts.push(at);
  });
  const cut = (sections: number): string => `${lines.slice(0, starts[sections]).join('\n').replace(/\n*$/, '')}\n\n${WHOLE_CHANGELOG}\n`;
  if (starts.length < 2) return text;
  let kept = 1;
  while (kept + 1 < starts.length && [...cut(kept + 1)].length <= limit) kept += 1;
  return cut(kept);
}

export async function docs(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  try {
    return await show(args, context, json);
  } catch (error) {
    if (!(error instanceof Missing)) throw error;
    return { code: 2, stdout: renderErrors([{ code: 'internal', file: null, line: null, message: error.message, next: 'reinstall Lawcheck, then run lawcheck check' }], json, 'docs') };
  }
}

async function show(args: Arguments, _context: CheckContext, json: boolean): Promise<Result> {
  if (args.words.length > 1) return usageError('docs takes one topic at most', json, 'docs');
  const list = topics();
  const id = args.words[0];
  if (id === undefined) {
    return { code: 0, stdout: json ? documentOf({ schema: 'lawcheck-docs/0', topics: list.map((t) => ({ id: t.id, title: t.title })) }) : topicList(list) };
  }
  const topic = list.find((t) => t.id === id);
  if (topic === undefined) {
    const near = nearestKey(id, list.map((t) => t.id));
    return usageError(`there is no topic '${id}'${near === null ? '' : ` (did you mean '${near}'?)`}; lawcheck docs lists them`, json, 'docs');
  }
  const text = page(id);
  if (json) return { code: 0, stdout: documentOf({ schema: 'lawcheck-docs/0', id, title: topic.title, text }) };
  const printed = forTerminal(text, list.map((t) => t.id));
  return { code: 0, stdout: id === 'changelog' ? fitChangelog(printed) : printed };
}

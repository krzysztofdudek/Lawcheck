import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { documentOf, usageError } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
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
  return { code: 0, stdout: json ? documentOf({ schema: 'lawcheck-docs/0', id, title: topic.title, text }) : forTerminal(text, list.map((t) => t.id)) };
}

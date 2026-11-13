import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { documentOf, usageError } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import { nearestKey } from './law.js';

export const TOPICS: { id: string; title: string }[] = [
  { id: 'first-law', title: 'The first type and the first rule' },
  { id: 'law', title: 'The law file' },
  { id: 'change', title: 'What a check judges' },
  { id: 'script-rules', title: 'Script rules' },
  { id: 'reviewer-rules', title: 'Reviewer rules' },
  { id: 'waivers', title: 'Waivers' },
  { id: 'config', title: 'Settings' },
  { id: 'providers', title: 'Reviewers and keys' },
  { id: 'languages', title: 'Languages and uses' },
  { id: 'ci', title: 'CI and git hooks' },
  { id: 'json', title: 'JSON documents' },
  { id: 'codes', title: 'Codes' },
];

export const DOCS_DIR = fileURLToPath(new URL('../docs/', import.meta.url));

export function page(id: string): string {
  return readFileSync(`${DOCS_DIR}${id}.md`, 'utf8');
}

export function topicList(): string {
  const lines = [`lawcheck docs: ${TOPICS.length} topics; lawcheck docs <topic> prints one`, '', ...TOPICS.map((t) => `${t.id}  ${t.title}`)];
  return lines.join('\n') + '\n';
}

export async function docs(args: Arguments, _context: CheckContext, json: boolean): Promise<Result> {
  if (args.words.length > 1) return usageError('docs takes one topic at most', json, 'docs');
  const id = args.words[0];
  if (id === undefined) {
    return { code: 0, stdout: json ? documentOf({ schema: 'lawcheck-docs/0', topics: TOPICS }) : topicList() };
  }
  const topic = TOPICS.find((t) => t.id === id);
  if (topic === undefined) {
    const near = nearestKey(id, TOPICS.map((t) => t.id));
    return usageError(`there is no topic '${id}'${near === null ? '' : ` (did you mean '${near}'?)`}; lawcheck docs lists them`, json, 'docs');
  }
  const text = page(id);
  return { code: 0, stdout: json ? documentOf({ schema: 'lawcheck-docs/0', id, title: topic.title, text }) : text };
}

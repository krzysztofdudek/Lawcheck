import assert from 'node:assert/strict';
import { fencedBlocks } from '../guard/markdown.ts';
import { readSource } from '../guard/source.ts';

// A block is claimed by the scenario of its page, or by '<test file> > <test name>', an existing test that checks it.
export const SCENARIO = 'scenario';
export type Claims = Record<string, string>;

export interface PageFile {
  claims: Claims;
  scenario?: (page: Page) => Promise<void>;
}

export interface Block {
  key: string;
  text: string;
  line: number;
}

// The keys are the suite guard's, so a row of tests/weakenings.md and a claim name a block alike.
export function blocksOf(markdown: string): Block[] {
  return fencedBlocks(markdown).map(({ key, content, line }) => ({ key, text: content.slice(content.indexOf('\n') + 1), line }));
}

export interface Page {
  read: Set<string>;
  text(key: string): string;
}

export function pageOf(id: string, markdown: string, claims: Claims): Page {
  const blocks = new Map(blocksOf(markdown).map((block) => [block.key, block.text]));
  const read = new Set<string>();
  return {
    read,
    text(key) {
      const text = blocks.get(key);
      if (text === undefined || claims[key] !== SCENARIO) throw new Error(`the scenario of docs/${id}.md reads ${key}, which tests/docs/${id}.ts does not claim for it`);
      read.add(key);
      return text;
    },
  };
}

export function shows(output: string, block: string): void {
  const lines = output.split('\n');
  const want = block.split('\n');
  const at = lines.findIndex((_, i) => want.every((line, k) => lines[i + k] === line));
  assert.ok(at >= 0, `the output does not hold the block\n--- block\n${block}\n--- output\n${output}`);
}

export function railProblems(pages: Record<string, string>, files: Record<string, PageFile>, source: (file: string) => string | null): string[] {
  const problems: string[] = [];
  for (const id of Object.keys(pages)) if (files[id] === undefined) problems.push(`docs/${id}.md has no tests/docs/${id}.ts`);
  for (const id of Object.keys(files)) if (pages[id] === undefined) problems.push(`tests/docs/${id}.ts names no page of docs/`);
  for (const [id, markdown] of Object.entries(pages)) {
    const file = files[id];
    if (file === undefined) continue;
    const seen = new Set<string>();
    for (const block of blocksOf(markdown)) {
      if (seen.has(block.key)) problems.push(`docs/${id}.md:${block.line}: a second block is ${block.key}, so no claim can tell the two apart`);
      seen.add(block.key);
      if (file.claims[block.key] === undefined) problems.push(`docs/${id}.md:${block.line}: ${block.key} is claimed by no scenario and no test`);
    }
    for (const [key, by] of Object.entries(file.claims)) {
      if (!seen.has(key)) problems.push(`tests/docs/${id}.ts claims ${key}, which docs/${id}.md does not have`);
      if (by === SCENARIO) {
        if (file.scenario === undefined) problems.push(`tests/docs/${id}.ts claims ${key} for a scenario it does not export`);
        continue;
      }
      const [path, name, ...rest] = by.split(' > ');
      const text = name === undefined || rest.length > 0 ? null : source(path!);
      if (text === null) problems.push(`tests/docs/${id}.ts claims ${key} by ${JSON.stringify(by)}, which names no test file`);
      else if (!readSource(text).tests.some((t) => t.id === name)) problems.push(`tests/docs/${id}.ts claims ${key} by a test ${path} does not hold: ${name}`);
    }
    if (file.scenario !== undefined && !Object.values(file.claims).includes(SCENARIO)) problems.push(`tests/docs/${id}.ts exports a scenario that claims no block`);
  }
  return problems;
}

export async function runScenario(id: string, markdown: string, file: PageFile): Promise<string[]> {
  if (file.scenario === undefined) return [];
  const page = pageOf(id, markdown, file.claims);
  await file.scenario(page);
  return Object.entries(file.claims)
    .filter(([key, by]) => by === SCENARIO && !page.read.has(key))
    .map(([key]) => `the scenario of docs/${id}.md never reads ${key}, which it claims`);
}

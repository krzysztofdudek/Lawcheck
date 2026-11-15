import { closeSync, mkdirSync, openSync, realpathSync, writeSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { documentOf, errorResult, noWords, usageError, version } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import { listFiles, showPrefix, workTreeProblem } from './files.js';
import { findRoot, LAW, stopped } from './setup.js';
import { noGit, Stop } from './setup.js';

export function lawText(packageVersion: string): string {
  const release = packageVersion.match(/^\d+\.\d+\.\d+/)?.[0] ?? packageVersion;
  return [
    `lawcheck: ${release}`,
    '',
    '# The law of this repository: the types of its files, and the rules each type keeps.',
    '# lawcheck docs first-law shows how to write them. A small example:',
    '#',
    '# rules:',
    '#   no-console:',
    '#     why: Only the command layer writes to the terminal.',
    '#',
    '# types:',
    '#   source:',
    '#     about: Everything that ships.',
    '#     paths: ["src/**/*.ts"]',
    '#     rules: [no-console]',
    '#',
    '# Each rule has one file: .lawcheck/rules/no-console.mjs for a script,',
    '# or .lawcheck/rules/no-console.md for the reviewer.',
    '',
  ].join('\n');
}

export const GITIGNORE = '.local/\nconfig.local.yaml\n';
const IGNORE = '.lawcheck/.gitignore';
const NEXT = 'describe your first file type in .lawcheck/law.yaml  (lawcheck docs first-law shows how)';

function already(place: string, below = false): Stop {
  return new Stop([
    {
      code: 'already-initialized',
      file: place,
      line: null,
      message: below ? 'a law already governs a directory below this one' : 'a law already governs this directory',
      next: 'lawcheck doctor  (shows how the law here stands)',
    },
  ]);
}

export function writeNew(path: string, content: string): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
  try {
    writeSync(fd, content);
  } finally {
    closeSync(fd);
  }
  return true;
}

export async function init(args: Arguments, context: CheckContext, json: boolean): Promise<Result> {
  const extra = noWords(args);
  if (extra !== null) return usageError(extra, json, 'init');
  const cwd = realpathSync(resolve(context.cwd));
  const outcome = await stopped(() => {
    const problem = workTreeProblem(cwd);
    if (problem !== null) throw new Stop([noGit(cwd, problem)]);
    const root = findRoot(cwd);
    if (root !== null) throw already(relative(cwd, join(root, LAW)).split('\\').join('/'));
    const below = listFiles(cwd).find((path) => path === LAW || path.endsWith(`/${LAW}`));
    if (below !== undefined) throw already(below, true);
    const prefix = showPrefix(cwd);
    mkdirSync(join(cwd, '.lawcheck'), { recursive: true });
    if (!writeNew(join(cwd, LAW), lawText(version()))) throw already(LAW);
    const created = [LAW];
    const kept: string[] = [];
    (writeNew(join(cwd, IGNORE), GITIGNORE) ? created : kept).push(IGNORE);
    return { prefix, created, kept };
  });
  if ('errors' in outcome) return errorResult(outcome.errors, json, 'init');
  const { prefix, created, kept } = outcome;
  if (json) {
    return { code: 0, stdout: documentOf({ schema: 'lawcheck-init/0', root: prefix, created, kept, next: { command: null, text: NEXT } }) };
  }
  const first = kept.length === 0 ? `lawcheck: created ${created.join(' and ')}` : `lawcheck: created ${created.join(' and ')}; kept ${kept.join(' and ')}`;
  const lines = [first];
  if (prefix !== '') lines.push(`note: the law covers only the files below ${prefix}`);
  lines.push('', 'Nothing is checked yet: the law has no types.', `next: ${NEXT}`);
  return { code: 0, stdout: lines.join('\n') + '\n' };
}

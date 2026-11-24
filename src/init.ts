import { closeSync, lstatSync, mkdirSync, openSync, realpathSync, statSync, writeSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { documentOf, errorResult, noWords, usageError, version } from './args.js';
import type { Arguments, Result } from './args.js';
import type { CheckContext } from './check.js';
import { ignoresPath, listFiles, showPrefix, workTreeProblem } from './files.js';
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

export const WRITE_BY_HAND = 'to govern this folder instead, write .lawcheck/law.yaml here by hand  (lawcheck docs first-law shows how)';

function already(place: string, below = false): Stop {
  return new Stop([
    {
      code: 'already-initialized',
      file: place,
      line: null,
      message: below ? 'a law already governs a directory below this one' : 'a law already governs this directory',
      next: below ? WRITE_BY_HAND : 'lawcheck doctor  (shows how the law here stands)',
    },
  ]);
}

function notAFolder(path: string): string | null {
  let link: boolean;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    return null;
  }
  try {
    if (statSync(path).isDirectory()) return null;
  } catch {
    return 'it is a symbolic link to a place that does not exist, so the folder .lawcheck cannot be made';
  }
  return link ? 'it is a symbolic link to a file, so the folder .lawcheck cannot be made' : 'it is a file, so the folder .lawcheck cannot be made';
}

function notAFile(path: string, place: string): string | null {
  try {
    lstatSync(path);
  } catch {
    return null;
  }
  let stat: ReturnType<typeof statSync>;
  try {
    stat = statSync(path);
  } catch {
    return `it is a symbolic link to a place that does not exist, so the file ${place} cannot be written`;
  }
  if (stat.isFile()) return null;
  return `it is ${stat.isDirectory() ? 'a folder' : 'no regular file'}, so the file ${place} cannot be written`;
}

export function writeNew(path: string, content: string, place = path): boolean {
  let fd: number;
  try {
    fd = openSync(path, 'wx');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw unwritable(place, error);
  }
  try {
    writeSync(fd, content);
  } catch (error) {
    throw unwritable(place, error);
  } finally {
    closeSync(fd);
  }
  return true;
}

function unwritable(place: string, error: unknown): Stop {
  const code = (error as NodeJS.ErrnoException).code ?? 'an error';
  return new Stop([{ code: 'file-unwritable', file: place, line: null, message: `cannot be written (${code})`, next: `make ${place} writable, then run lawcheck init again` }]);
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
    const obstacle = notAFolder(join(cwd, '.lawcheck'));
    if (obstacle !== null) {
      throw new Stop([{ code: 'file-unwritable', file: '.lawcheck', line: null, message: obstacle, next: 'move .lawcheck out of the way, then run lawcheck init again' }]);
    }
    const blocked = notAFile(join(cwd, IGNORE), IGNORE);
    if (blocked !== null) throw new Stop([{ code: 'file-unwritable', file: IGNORE, line: null, message: blocked, next: `move ${IGNORE} out of the way, then run lawcheck init again` }]);
    try {
      mkdirSync(join(cwd, '.lawcheck'), { recursive: true });
    } catch (error) {
      throw unwritable('.lawcheck', error);
    }
    if (!writeNew(join(cwd, LAW), lawText(version()), LAW)) throw already(LAW);
    const created = [LAW];
    const kept: string[] = [];
    (writeNew(join(cwd, IGNORE), GITIGNORE, IGNORE) ? created : kept).push(IGNORE);
    // git check-ignore refuses a path beyond a symbolic link, and .lawcheck can still be a link to a folder here.
    return { prefix, created, kept, ignored: !lstatSync(join(cwd, '.lawcheck')).isSymbolicLink() && ignoresPath(cwd, LAW) };
  });
  if ('errors' in outcome) return errorResult(outcome.errors, json, 'init');
  const { prefix, created, kept, ignored } = outcome;
  if (json) {
    return { code: 0, stdout: documentOf({ schema: 'lawcheck-init/0', root: prefix, created, kept, next: { command: null, text: ignored ? `git ignores ${LAW}, so remove the line that ignores it, then ${NEXT}` : NEXT } }) };
  }
  const first = kept.length === 0 ? `lawcheck: created ${created.join(' and ')}` : `lawcheck: created ${created.join(' and ')}; kept ${kept.join(' and ')}`;
  const lines = [first];
  if (prefix !== '') lines.push(`note: the law covers only the files below ${prefix}`);
  if (ignored) lines.push(`note: git ignores ${LAW}, so no commit carries the law and no other checkout has it; remove the line that ignores it, as \`git check-ignore -v ${LAW}\` shows`);
  lines.push('', 'Nothing is checked yet: the law has no types.', `next: ${NEXT}`);
  return { code: 0, stdout: lines.join('\n') + '\n' };
}

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { leadingTestNumbers } from '../guard/names.ts';
import { INVARIANTS } from './invariants.ts';
import type { Behaviour } from './sets.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));

// The acceptance tests, the promises and the harness checks that are about a behaviour of Windows or macOS, by the ids promiseOf resolves. A test whose name carries one runs per push on each system named here (PLATFORM_TESTS of tests/harness/sets.ts). The suite guard reads this object as plain data, so it stays literals.
export const PLATFORM_PROMISES: Record<string, { systems: ('win32' | 'darwin')[]; behaviours: Behaviour[]; behaviour: string }> = {
  'test 15': { systems: ['win32'], behaviours: ['links', 'file-modes'], behaviour: 'Windows has no symbolic links by default, and chmod cannot make a file unreadable there' },
  'test 24': { systems: ['win32'], behaviours: ['process-ends'], behaviour: 'a hung rule is ended by killing its process tree, which Windows does with taskkill' },
  'test 26': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'the runner\'s --permission model refuses writes, programs and reads by paths with Windows drives and backslashes' },
  'test 42': { systems: ['win32'], behaviours: ['path-lookup'], behaviour: 'git is looked up on the PATH, which Windows splits at ; and searches with PATHEXT' },
  'test 66': { systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup'], behaviour: 'claude is found on the PATH as a .cmd shim and started through cmd.exe on Windows' },
  'test 67': { systems: ['win32'], behaviours: ['process-ends'], behaviour: 'Windows has no signals: the tool and claude\'s process tree are ended by taskkill' },
  'test 107': { systems: ['win32'], behaviours: ['links'], behaviour: 'a symbolic link has no type, and Windows makes links only with privileges' },
  'test 142': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'a named path is shown with forward slashes where Windows gives backslashes' },
  'test 143': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'paths typed from a subfolder are joined with Windows backslashes and shown with slashes' },
  'test 144': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'a path outside the root is told by separators and drive letters on Windows' },
  'test 156': { systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], behaviour: 'the hook finds lawcheck and pnpm on the PATH, as .cmd shims on Windows' },
  'test 158': { systems: ['win32'], behaviours: ['cmd-shims'], behaviour: 'npx, pnpm, yarn and bun start as .cmd shims through cmd.exe quoting on Windows' },
  'test 159': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'an edited file is given by an absolute path with a drive letter and backslashes on Windows' },
  'test 163': { systems: ['win32'], behaviours: ['process-ends'], behaviour: 'Windows has no signals: a stopped hook ends at once, and its process tree is ended by taskkill' },
  'test 202': { systems: ['win32', 'darwin'], behaviours: ['case-folding'], behaviour: 'the file systems of Windows and macOS ignore case' },
  'test 203': { systems: ['darwin'], behaviours: ['unicode-names'], behaviour: 'macOS git precomposes Unicode names, and its file systems normalize them' },
  'test 204': { systems: ['win32'], behaviours: ['line-ends'], behaviour: 'a checkout with core.autocrlf has CRLF line ends, as Windows checkouts do' },
  'test 205': { systems: ['win32', 'darwin'], behaviours: ['install'], behaviour: 'a global npm install starts from every shell of the system: cmd.exe, PowerShell and .cmd shims on Windows, the shells of macOS' },
  'test 210': { systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], behaviour: 'the runner a config names is looked up on the PATH, as a .cmd file through PATHEXT on Windows' },
  'test 404': { systems: ['win32', 'darwin'], behaviours: ['temp-folders', 'real-paths'], behaviour: 'the system temporary directory is TEMP on Windows and resolves through /private on macOS' },
  'test 406': { systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], behaviour: 'a program reviewer\'s process tree: .cmd shims and taskkill on Windows, an escaped child found by ps on macOS' },
  'test 407': { systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], behaviour: 'a program reviewer\'s process tree: .cmd shims and taskkill on Windows, an escaped child found by ps on macOS' },
  'test 408': { systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], behaviour: 'a program reviewer\'s process tree: .cmd shims and taskkill on Windows, an escaped child found by ps on macOS' },
  'test 409': { systems: ['win32'], behaviours: ['windows-paths'], behaviour: 'the folder of the VS Code extension is told by its path, with Windows backslashes' },
  'I-env-1': { systems: ['win32'], behaviours: ['cmd-shims'], behaviour: 'Node under --permission is given the entry by its own path, as the .cmd shims of Windows give it' },
  'I-git-1': { systems: ['win32'], behaviours: ['git-for-windows'], behaviour: 'git for Windows runs the programs a repository names through the sh shell it ships' },
  'I-runner-1': { systems: ['win32', 'darwin'], behaviours: ['links', 'windows-paths', 'real-paths'], behaviour: 'the root and the links git tracks are resolved by realpath and compared as paths: junctions and backslashes on Windows, /private on macOS' },
  'I-secret-2': { systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], behaviour: 'a law or config read through a symbolic link: links and junctions on Windows, realpath through /private on macOS' },
  'I-shape-1': { systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'links', 'real-paths', 'unicode-names'], behaviour: 'repository shapes reach paths, links and realpath: drive letters, junctions and backslashes on Windows, /private and Unicode names on macOS' },
  'I-shape-2': { systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'windows-paths', 'real-paths'], behaviour: 'the hooks in every repository shape: .cmd shims and Windows paths, macOS realpath of /private' },
  'I-start-1': { systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup'], behaviour: 'Windows searches the current folder and PATHEXT for a program started by a bare name' },
  'harness-1': { systems: ['win32'], behaviours: ['process-ends'], behaviour: 'Windows has no signals: a process ends with an exit code, never by a signal' },
  'harness-6': { systems: ['win32', 'darwin'], behaviours: ['process-ends', 'process-listing'], behaviour: 'the processes a run leaves alive are listed by PowerShell on Windows and by ps on macOS, not by /proc' },
  'harness-8': { systems: ['win32', 'darwin'], behaviours: ['temp-folders', 'real-paths'], behaviour: 'the temporary and home folders are TEMP and USERPROFILE on Windows and resolve through /private on macOS' },
};

export function testIds(name: string): string[] {
  const ids: string[] = [];
  for (const n of leadingTestNumbers(name)) ids.push(`test ${n}`);
  for (const m of name.matchAll(/(?<![\w-])(I-[a-z][a-z0-9]*-\d+|S\d+-\d+|U-\d+|R-\d+|T[1-8]|harness-(?:\d+|count))(?![\w-])/g)) ids.push(m[1]!);
  return [...new Set(ids)];
}

export interface Promised {
  id: string;
  where: string;
  text: string;
}

function cells(line: string): string[] {
  return line
    .slice(1, line.endsWith('|') ? -1 : undefined)
    .split(/(?<!\\)\|/)
    .map((cell) => cell.trim());
}

// A test number or a finding id has no text outside its test; a promise has its row in design/promises.md, and a harness invariant its sentence.
export function promiseOf(id: string): Promised | null {
  if (id.startsWith('harness-')) return INVARIANTS[id] === undefined ? null : { id, where: 'tests/harness/invariants.ts', text: INVARIANTS[id]! };
  if (!id.startsWith('I-')) return null;
  const path = join(ROOT, 'design', 'promises.md');
  if (!existsSync(path)) return null;
  for (const line of readFileSync(path, 'utf8').split('\n')) {
    if (!line.startsWith('|')) continue;
    const parts = cells(line);
    if (parts[0] === id || parts[0] === `\`${id}\``) return { id, where: 'design/promises.md', text: parts[1] ?? '' };
  }
  return null;
}

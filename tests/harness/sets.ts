import { existsSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = fileURLToPath(new URL('../..', import.meta.url));
export const TESTS = join(ROOT, 'tests');

export const COMMIT_GROUPS: Record<string, string[]> = {
  core: ['unit', 'acceptance', 'contract', 'guard'],
  inputs: ['properties', 'security', 'limits'],
  environments: ['environments'],
  gate: ['gate'],
};

export const NIGHTLY_GROUPS: Record<string, string[]> = {
  properties: ['properties'],
  security: ['security'],
  limits: ['limits'],
  environments: ['environments'],
  docs: ['docs'],
  sabotage: ['sabotage'],
  corpus: ['corpus'],
  coverage: ['coverage'],
  live: ['live'],
  mutants: ['mutants'],
};

// The groups that have no test file yet, by set; a group not named here that finds none fails, and a contract test fails when one named here holds tests.
export const EMPTY_GROUPS: Record<'commit' | 'nightly', string[]> = {
  commit: ['gate'],
  nightly: ['security', 'limits', 'docs', 'sabotage', 'corpus', 'coverage', 'live', 'mutants'],
};

// Folders under tests/ that hold repositories, inputs and recorded results for the tests, never tests of their own.
export const FIXTURES = ['tests/sample', 'tests/reviewer-sample', 'tests/uses-sample', 'tests/languages-sample', 'tests/agent/fixture', 'tests/agent/samples', 'tests/stability/fixture', 'tests/security/attacks'];

export const TEST_FILE = /\.(test|spec)\.[cm]?[jt]sx?$/;

// What discovery leaves out when it looks for test files anywhere in the checkout: what npm, the build and git make, and the files that are named like a test and are none. Every other file named like a test must be in a set of the runner.
export const NOT_SEARCHED = ['node_modules', '.git', 'dist', '.grammars'];
export const NOT_TESTS: string[] = [];

const rel = (path: string) => relative(ROOT, path).split(sep).join('/');

export function walk(dir: string, keep: (name: string) => boolean): string[] {
  if (!existsSync(dir)) return [];
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || FIXTURES.includes(rel(path))) continue;
      out.push(...walk(path, keep));
    } else if (entry.isFile() && keep(entry.name)) out.push(rel(path));
  }
  return out.sort();
}

export const nightly = (path: string) => path.endsWith('.nightly.test.ts');


export function testNamedFiles(root = ROOT): string[] {
  const out: string[] = [];
  const visit = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (NOT_SEARCHED.includes(entry.name)) continue;
      const path = join(dir, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (entry.isFile() && TEST_FILE.test(entry.name) && !NOT_TESTS.includes(relative(root, path).split(sep).join('/'))) out.push(relative(root, path).split(sep).join('/'));
    }
  };
  visit(root);
  return out.sort();
}

export function setFiles(speed: 'commit' | 'nightly', dirs: string[]): string[] {
  return dirs
    .flatMap((dir) => walk(join(TESTS, dir), (name) => name.endsWith('.test.ts')))
    .filter((path) => (speed === 'nightly' ? nightly(path) : !nightly(path)))
    .sort();
}

export function groupDirs(speed: 'commit' | 'nightly', group: string | null): string[] | null {
  const groups = speed === 'nightly' ? NIGHTLY_GROUPS : COMMIT_GROUPS;
  if (group !== null) return groups[group] ?? null;
  return [...new Set(Object.values(groups).flat())];
}

export type System = 'linux' | 'win32' | 'darwin';

// The behaviours of Windows and macOS that make a test run there per push, each with the systems it holds on. An entry of PLATFORM_TESTS or PLATFORM_PROMISES names those its test exercises, and a contract test holds every entry to this list; whether a test really exercises what it names is for its reviewer to judge, and no check of the words of a reason can stand in for that. The suite guard reads this object as plain data, so it stays literals.
export const PLATFORM_BEHAVIOURS = {
  'cmd-shims': { systems: ['win32'], behaviour: 'a program found as a .cmd file is started through cmd.exe, with its quoting and its search of the current folder' },
  'path-lookup': { systems: ['win32'], behaviour: 'a program is looked up on PATH, spelled Path, split at ; and tried with the endings of PATHEXT' },
  'windows-paths': { systems: ['win32'], behaviour: 'a path has a drive letter and backslash separators, and may come with the \\\\?\\ prefix or as a short name' },
  'links': { systems: ['win32'], behaviour: 'a symbolic link needs privileges, a junction stands in for a link to a folder, and git may check a link out as a plain file' },
  'process-ends': { systems: ['win32'], behaviour: 'there are no signals and no process groups: a process ends at once, its tree is ended with taskkill, and processes are listed through PowerShell' },
  'temp-folders': { systems: ['win32'], behaviour: 'the temporary and home folders come from TEMP, TMP, USERPROFILE and APPDATA' },
  'line-ends': { systems: ['win32'], behaviour: 'checkouts with core.autocrlf and the programs of Windows write CRLF line ends' },
  'file-names': { systems: ['win32'], behaviour: 'a file name cannot hold control characters or :*?"<>|, and is UTF-16' },
  'locks': { systems: ['win32'], behaviour: 'an open file, or the working folder of a running process, cannot be removed or renamed over' },
  'file-modes': { systems: ['win32'], behaviour: 'there is no executable bit, and chmod sets only the read-only flag' },
  'git-for-windows': { systems: ['win32'], behaviour: 'git for Windows runs hooks and scripts through the sh it ships, names the null device its own way and prints Windows paths' },
  'environment': { systems: ['win32'], behaviour: 'the names of variables ignore case, and a child started with an empty environment lacks the variables Windows needs' },
  'slow-starts': { systems: ['win32'], behaviour: 'a process takes far longer to start, against the time limits the tool sets' },
  'error-codes': { systems: ['win32'], behaviour: 'the file system answers with other error codes, as when the path of a folder is a file' },
  'platform-name': { systems: ['win32'], behaviour: 'process.platform is win32, which the entries of PLATFORM_SKIPS for Windows key on' },
  'real-paths': { systems: ['darwin'], behaviour: 'temporary folders lie under /var, a link to /private/var, so the real path of a folder is not the path given' },
  'unicode-names': { systems: ['darwin'], behaviour: 'the file systems normalize Unicode names, and git precomposes them' },
  'process-listing': { systems: ['darwin'], behaviour: 'there is no /proc: the processes a program left are found with ps' },
  'case-folding': { systems: ['win32', 'darwin'], behaviour: 'the default file systems of Windows and macOS ignore case in names' },
  'install': { systems: ['win32', 'darwin'], behaviour: 'a global npm install starts from the shells of the system: cmd.exe, PowerShell, Git Bash and .cmd shims on Windows, BSD tar and the shells of macOS' },
} as const satisfies Record<string, { systems: readonly ('win32' | 'darwin')[]; behaviour: string }>;

export type Behaviour = keyof typeof PLATFORM_BEHAVIOURS;

export interface PlatformTest {
  file: string;
  test: string;
  systems: ('win32' | 'darwin')[];
  behaviours: Behaviour[];
  reason: string;
}

// Per push, Linux runs every test of the commit set, and Windows and macOS run only the tests listed here, each on the systems it names; the nightly runs every test on every system. A test is listed when what it checks behaves differently on that system: it names those behaviours of PLATFORM_BEHAVIOURS, and its reason says how the test meets them. `test` is the whole name of a top-level test, as in PLATFORM_SKIPS. The suite guard reads this list as plain data, so it stays literals.
export const PLATFORM_TESTS: PlatformTest[] = [
  { file: 'tests/acceptance/changes.test.ts', test: 'test 12: a path with letters outside ASCII', systems: ['win32', 'darwin'], behaviours: ['file-names', 'unicode-names'], reason: 'non-ASCII file names: UTF-16 names on Windows, Unicode normalization on macOS' },
  { file: 'tests/acceptance/changes.test.ts', test: 'test 14: the root below the top of the git tree', systems: ['win32'], behaviours: ['windows-paths'], reason: 'git names the top with forward slashes and a drive letter on Windows' },
  { file: 'tests/acceptance/cli.test.ts', test: 'test 42: not initialized, and no git', systems: ['win32'], behaviours: ['path-lookup'], reason: 'git lookup on PATH with PATHEXT and Path spelling on Windows' },
  { file: 'tests/acceptance/doctor.test.ts', test: 'test 136: the reviewer check', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude found on PATH as a .cmd shim on Windows' },
  { file: 'tests/acceptance/doctor.test.ts', test: 'test 137: types, unread files and a broken grammar', systems: ['win32'], behaviours: ['links'], reason: 'a copied install whose node_modules is a junction on Windows' },
  { file: 'tests/acceptance/explain.test.ts', test: 'test 105: explain a file, from a subdirectory, with content, and one that does not exist', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path given from a subfolder is joined with backslashes on Windows' },
  { file: 'tests/acceptance/explain.test.ts', test: 'test 107: ignored, symbolic links and binary files', systems: ['win32'], behaviours: ['links'], reason: 'symbolic links need privileges on Windows and differ from POSIX links' },
  { file: 'tests/acceptance/explain.test.ts', test: 'test 113: usage', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path outside the root is told by backslash separators on Windows' },
  { file: 'tests/acceptance/http-providers.test.ts', test: 'test 404: the key canary', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'environment', 'temp-folders', 'process-listing'], reason: '.cmd shims, variable case and TEMP on Windows; the macOS branch finding escaped children' },
  { file: 'tests/acceptance/http-providers.test.ts', test: 'test 405: a key under a provider name goes to that provider alone', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-listing'], reason: 'fake programs started as .cmd shims on Windows; macOS branch of the program runner' },
  { file: 'tests/acceptance/init.test.ts', test: 'test 97: init refuses where a law already governs, and writes nothing', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a law found above is named by a relative path with backslashes on Windows' },
  { file: 'tests/acceptance/init.test.ts', test: 'init where .lawcheck is a file: internal, and its next line names init', systems: ['win32'], behaviours: ['error-codes'], reason: 'Windows gives other error codes when the path of a folder is a file' },
  { file: 'tests/acceptance/law.test.ts', test: 'test 15: a symlink and a binary file have no type; an unreadable file stops the run', systems: ['win32'], behaviours: ['links', 'file-modes'], reason: 'symbolic links and chmod cannot make a file unreadable on Windows' },
  { file: 'tests/acceptance/package.test.ts', test: 'package: the tarball holds the licence, the readme, the built tool, its docs and the grammars with their licences, and nothing else', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'npm pack, and npm on PATH is a .cmd shim on Windows' },
  { file: 'tests/acceptance/package.test.ts', test: 'package: every shipped grammar is named in the licence file', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'npm pack, and npm on PATH is a .cmd shim on Windows' },
  { file: 'tests/acceptance/paths.test.ts', test: 'test 142: one named file, and its JSON', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a named path is shown with forward slashes, not Windows backslashes' },
  { file: 'tests/acceptance/paths.test.ts', test: 'test 143: directories, patterns, a file twice, an untyped file, files that select nothing, and a name that starts with -', systems: ['win32'], behaviours: ['windows-paths'], reason: 'paths named from a subfolder are joined with backslashes on Windows' },
  { file: 'tests/acceptance/paths.test.ts', test: 'test 144: paths with the flags of a change, and a path outside the root', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path outside the root is told by backslash separators on Windows' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 154: the session start gives prime at the root, for every source', systems: ['win32'], behaviours: ['cmd-shims', 'windows-paths'], reason: 'the hook starts lawcheck through a .cmd shim, in a root compared as a Windows path' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 156: prime that does not run', systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], reason: 'a missing program is looked up by PATH and PATHEXT, with .cmd shims on Windows' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 158: every runner starts the same Lawcheck with its own words', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'npx, pnpm, yarn and bun start as .cmd shims through cmd.exe quoting on Windows' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 159: an edit that breaks the law, by Write, by Edit, from another directory, and a notebook', systems: ['win32'], behaviours: ['windows-paths'], reason: 'an edited path with Windows backslashes and a drive root becomes ./src/... with forward slashes' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 163: the deadline, and a hook that is stopped', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no signals: taskkill ends the tree, and a stopped hook ends at once' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'section 5: the call ends 2 seconds after Lawcheck exits while a child holds its output', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no process groups: a child holding the output is ended by taskkill' },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 406: codex', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], reason: 'a .cmd shim and taskkill on Windows; ps finds an escaped child on macOS' },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 407: gemini-cli', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], reason: 'a .cmd shim and taskkill on Windows; ps finds an escaped child on macOS' },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 408: copilot-cli', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'process-ends', 'process-listing'], reason: 'a .cmd shim and taskkill on Windows; ps finds an escaped child on macOS' },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 409: a copilot inside the folder of the VS Code extension is passed over', systems: ['win32'], behaviours: ['path-lookup', 'windows-paths', 'cmd-shims'], reason: 'PATH split by semicolons, backslash folders and .cmd shims on Windows' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 66: claude-code', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'claude starts as a .cmd shim on Windows; cmd.exe must quote empty and JSON arguments' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 67: claude-code past its timeout, and the tool killed', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no signals: a killed tool and its tree end differently' },
  { file: 'tests/acceptance/reviewer.test.ts', test: 'test 49: a clone with no reviewer reads the committed verdict; CRLF keeps it, an edit loses it', systems: ['win32'], behaviours: ['line-ends'], reason: 'CRLF line endings of a Windows checkout keep a verdict' },
  { file: 'tests/acceptance/rules.test.ts', test: 'test 24: a rule that hangs is stopped', systems: ['win32'], behaviours: ['process-ends'], reason: 'a hung runner is ended by kill, and Windows ends processes differently' },
  { file: 'tests/acceptance/rules.test.ts', test: 'test 26: the runner stops writes, programs, workers and reads outside', systems: ['win32'], behaviours: ['windows-paths'], reason: 'Node\'s --permission model checks paths and blocks programs differently on Windows' },
  { file: 'tests/acceptance/rules.test.ts', test: 'test 28: a rule reads files under the root', systems: ['win32'], behaviours: ['windows-paths'], reason: '--permission grants reads by a real path, with drive letters on Windows' },
  { file: 'tests/acceptance/rules.test.ts', test: 'section 3: a rule that spins ends with the tool, whatever ends the tool', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no signals: a killed tool ends at once, and its runner must too' },
  { file: 'tests/acceptance/rules.test.ts', test: 'section 3: the runner takes no flag the tool was started with', systems: ['win32'], behaviours: ['windows-paths'], reason: 'the --allow-fs-read flag carries the real path of the root, which differs on Windows' },
  { file: 'tests/acceptance/stability.test.ts', test: 'test 76: the measurement through claude-code', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude found on PATH as a .cmd shim on Windows' },
  { file: 'tests/acceptance/stability.test.ts', test: 'test 410: the measurement through ollama, codex and copilot-cli', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'fake codex and copilot found on PATH as .cmd shims on Windows' },
  { file: 'tests/acceptance/try.test.ts', test: 'test 116: a script rule on the files it binds, on a file, and on a file it does not bind', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path the user gives is shown with forward slashes, not the backslashes of Windows' },
  { file: 'tests/acceptance/try.test.ts', test: 'test 117: directories, patterns and their union', systems: ['win32'], behaviours: ['windows-paths'], reason: 'targets from a subfolder resolve through backslash paths on Windows' },
  { file: 'tests/acceptance/try.test.ts', test: 'test 122: usage', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path outside the root is told apart with Windows separators and drives' },
  { file: 'tests/contract/discovery.test.ts', test: 'each group of a set names directories that the set walks, and the nightly set only its own directories', systems: ['win32'], behaviours: ['windows-paths'], reason: 'test paths are turned from backslashes to slashes on Windows' },
  { file: 'tests/contract/harness.test.ts', test: 'harness: a run that keeps every invariant passes, and its outputs reach the test', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'run folders in the temporary directory resolve through realpath on Windows and macOS' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: an exit code outside 0, 1 and 2, or a death by signal, fails the run', systems: ['win32'], behaviours: ['process-ends'], reason: 'a process on Windows that kills itself ends with a code, never a signal' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: a signal the test sends ends the run as the spec says, and SIGKILL alone may end it by the signal', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no signals: a sent signal ends a process at once' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-6: a run past its budget fails, and a budget names a time of tests/numbers.ts', systems: ['win32', 'darwin'], behaviours: ['process-ends', 'process-listing'], reason: 'a run past its budget is ended with taskkill on Windows, a process group elsewhere; the processes a run leaves alive are listed by PowerShell on Windows and by ps on macOS, not by /proc' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-6: a process the run leaves alive fails it, however quickly it left', systems: ['win32', 'darwin'], behaviours: ['process-ends', 'process-listing'], reason: 'leftover processes are found by /proc on Linux, ps on macOS, not on Windows' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-7: a change of git state fails the run, except the files its command writes by contract', systems: ['win32'], behaviours: ['windows-paths'], reason: 'git state paths turned from backslashes to slashes on Windows' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-8: a run may change nothing outside its repository: not its temporary directory, its home or the test folder', systems: ['win32', 'darwin'], behaviours: ['temp-folders', 'real-paths'], reason: 'temporary and home folders are TEMP, USERPROFILE and APPDATA on Windows, realpath on macOS' },
  { file: 'tests/contract/harness.test.ts', test: 'harness: the packed tarball starts as the package bin, and nothing else starts Lawcheck as a program', systems: ['win32'], behaviours: ['cmd-shims', 'links'], reason: 'npm is a .cmd file on Windows, and the package folder a junction' },
  { file: 'tests/contract/harness.test.ts', test: 'a skip comes only from PLATFORM_SKIPS, keyed by file and whole test name, with a platform and a reason', systems: ['win32'], behaviours: ['platform-name'], reason: 'a skip entry applies only where process.platform is Windows' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: a hook the test stops exits 0 and prints nothing, as question 56 says', systems: ['win32'], behaviours: ['process-ends'], reason: 'Windows has no signals: a stopped hook ends at once' },
  { file: 'tests/contract/harness.test.ts', test: 'harness: a start of Lawcheck that does not come from the harness fails the test, through every function of child_process and however it is spelt', systems: ['win32'], behaviours: ['windows-paths', 'cmd-shims'], reason: 'a start of the tool is recognised by Windows paths with backslashes and .cmd' },
  { file: 'tests/contract/harness.test.ts', test: 'harness: a start through a shell checks its run as every start of the tool is checked', systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup', 'line-ends'], reason: 'cmd.exe, a .cmd shim, the ; PATH separator and CRLF output on Windows' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-8: the test folder is checked whole: a file named like a run folder, and a run in a folder that is no test folder', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'the temporary directory and run folders resolve through realpath on Windows and macOS' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-7: an empty folder in the repository and every file of .git but its objects, logs and index count', systems: ['win32'], behaviours: ['windows-paths'], reason: 'folders and .git files are compared as paths with Windows separators' },
  { file: 'tests/contract/map.test.ts', test: 'tests/map.json names the tests of every file of src/', systems: ['win32'], behaviours: ['windows-paths'], reason: 'source paths turned from backslashes to slashes on Windows' },
  { file: 'tests/contract/starts.test.ts', test: 'only tests/harness/ starts Lawcheck, a hook or the tarball', systems: ['win32'], behaviours: ['windows-paths'], reason: 'test paths turned from backslashes to slashes on Windows' },
  { file: 'tests/environments/git-faults.test.ts', test: 'S7-15: a repository owned by another user gives no-git with the safe.directory command of git, quoted for a POSIX shell, and that command run there lets check through', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'git prints Windows paths for dubious ownership, run through Git Bash' },
  { file: 'tests/environments/git-faults.test.ts', test: 'R-1: a repository whose HEAD git cannot read gives no-git that sends the user to repair it, and the repair lets check through', systems: ['win32'], behaviours: ['windows-paths'], reason: 'the repository path in the next line is a Windows path, resolved by realpath' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'S6-1: the check before finishing hands back a breach written in the turn, in every repository shape', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'real-paths'], reason: 'hooks start lawcheck from PATH as a .cmd shim on Windows; links and realpath through /private on macOS' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'I-shape-2: control, a clean change lets the agent finish in every repository shape', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'real-paths'], reason: 'hooks start lawcheck from PATH as a .cmd shim on Windows; links and realpath through /private on macOS' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'I-shape-2: the hook after an edit hands back a breach in every repository shape', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'cmd-shims', 'real-paths'], reason: 'an absolute Windows file path from the edit and a .cmd shim; links and realpath through /private on macOS' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'I-shape-2: the session start gives the primer in every repository shape', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'real-paths'], reason: 'hooks start lawcheck from PATH as a .cmd shim on Windows; links and realpath through /private on macOS' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'I-shape-2: a law broken in the turn is handed back under its header in every repository shape', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'real-paths'], reason: 'hooks start lawcheck from PATH as a .cmd shim on Windows; links and realpath through /private on macOS' },
  { file: 'tests/environments/hook-shapes.test.ts', test: 'S6-1: a check before finishing that cannot take its snapshot says so', systems: ['win32', 'darwin'], behaviours: ['path-lookup', 'real-paths'], reason: 'the PATH is split by ; on Windows, git missing from it; links and realpath through /private on macOS' },
  { file: 'tests/environments/refusal.test.ts', test: 'I-env-1: every command but --version, --help and docs refuses an unsupported runtime in its first line, naming it, and doctor leads with the same line', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'Node under --permission is given the entry by its own path, as the .cmd shims of Windows give it' },
  { file: 'tests/environments/refusal.test.ts', test: 'I-env-1: control, posed as Node 24 the same commands answer', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'Node under --permission is given the entry by its own path, as the .cmd shims of Windows give it' },
  { file: 'tests/environments/refusal.test.ts', test: 'S8-2: on Bun with no node on the PATH a check names Bun in its first line, and says to install Node beside it', systems: ['win32', 'darwin'], behaviours: ['path-lookup', 'real-paths'], reason: 'node is looked up by PATHEXT on Windows and compared by realpath with this program, which macOS resolves through /private' },
  { file: 'tests/environments/refusal.test.ts', test: 'S8-2: on Bun with a node first on the PATH, as bun --bun runs it, the refusal names that node and says to start Lawcheck without --bun', systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], reason: 'a node.cmd found on PATH by PATHEXT on Windows' },
  { file: 'tests/environments/refusal.test.ts', test: 'S8-2: on Bun with a link to the program of this run first on the PATH, as Bun\'s own node fallback is, no node counts as found', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'a symlinked node.exe on Windows, and a symlink on macOS, compared by realpath with this program' },
  { file: 'tests/environments/refusal.test.ts', test: 'S8-1: a Lawcheck served from an archive of Yarn PnP refuses every command in its first line, and blames no rule file', systems: ['win32'], behaviours: ['windows-paths'], reason: 'the archive name is found in a Windows package path with backslashes' },
  { file: 'tests/environments/refusal.test.ts', test: 'S8-1: control, a Lawcheck in a folder whose name ends in .zip, with no Plug\'n\'Play, judges the rules', systems: ['win32'], behaviours: ['links'], reason: 'a copied package with a junction to node_modules runs the rules on Windows' },
  { file: 'tests/environments/refusal.test.ts', test: 'I-env-1: Node with --permission in NODE_OPTIONS, given the entry by its own path as the Windows shims give it, gets the refusal and no stack trace', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'Node --permission and the entry by its own path, as Windows shims give it' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 201: a runner file that cannot be read is runner-failed, naming the file', systems: ['darwin'], behaviours: ['real-paths'], reason: 'the copy of the runner lies in a temporary folder that macOS resolves through /private, and its path is compared by realpath' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 201: control, the same copy with a sound runner judges the rules', systems: ['win32'], behaviours: ['links'], reason: 'a copied package with a junction to node_modules runs the rules on Windows' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 210: doctor fails its config row when the runner the config names has no program on the PATH, and names it when it has', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'pnpm is a .cmd file found by PATHEXT on Windows' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-shape-1: the core rows of check give the output the spec gives with the law at the top, from the root and from below it', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'links', 'real-paths', 'unicode-names'], reason: 'a check started from a subfolder resolves paths with Windows separators; repository shapes reach paths, links and realpath: drive letters, junctions and backslashes on Windows, /private and Unicode names on macOS' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-shape-1: the core rows of check give the output the spec gives with the law in pkg/ of a monorepo, node_modules hoisted above it', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'links', 'real-paths', 'unicode-names'], reason: 'a monorepo root below the top and hoisted node_modules, with Windows paths; repository shapes reach paths, links and realpath: drive letters, junctions and backslashes on Windows, /private and Unicode names on macOS' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-shape-1: the core rows of check give the output the spec gives in a linked worktree, from the root and from below it', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'links', 'real-paths', 'unicode-names'], reason: 'a linked worktree has git paths that differ on Windows; repository shapes reach paths, links and realpath: drive letters, junctions and backslashes on Windows, /private and Unicode names on macOS' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-shape-1: the core rows of check give the output the spec gives at a root path with a space and a non-ASCII letter', systems: ['win32', 'darwin'], behaviours: ['cmd-shims', 'unicode-names'], reason: 'a space and non-ASCII letters in the root path: Windows quoting, macOS Unicode names' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-shape-1: the core rows of check give the output the spec gives at a root reached through a symbolic link', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'a root reached through a symlink, a junction on Windows, resolved by realpath through /private on macOS' },
  { file: 'tests/environments/shapes.test.ts', test: 'S2-2: a rule that imports a package from a node_modules above the root is refused in words that name the limit, never a flag', systems: ['win32'], behaviours: ['windows-paths'], reason: 'Node\'s --permission refuses reads above the root, by Windows paths' },
  { file: 'tests/environments/shapes.test.ts', test: 'S2-2: control, the same rule loads the same package from a node_modules below the root', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'a package below the root is read under Node\'s --permission by its real path: Windows drives, macOS /private' },
  { file: 'tests/environments/shapes.test.ts', test: 'S2-2: a node_modules at the root that links to a folder outside it is refused in the same words', systems: ['darwin'], behaviours: ['real-paths'], reason: 'a link resolved by realpath, which macOS takes through /private, before Node\'s --permission checks the path' },
  { file: 'tests/environments/shapes.test.ts', test: 'S2-2: a rule that writes a file is refused in words that name what it did', systems: ['win32'], behaviours: ['windows-paths'], reason: 'Node names the path of the written file with the \\\\?\\ prefix on Windows' },
  { file: 'tests/environments/shapes.test.ts', test: 'I-out-1: a line a rule prints with CRLF reaches standard error as that line, with no carriage return shown', systems: ['win32'], behaviours: ['line-ends'], reason: 'CRLF lines from a rule, the endings Windows programs print' },
  { file: 'tests/environments/systems.test.ts', test: 'test 202: on a file system that ignores case, explain SRC/core/price.ts answers for src/core/price.ts, the file git lists', systems: ['win32', 'darwin'], behaviours: ['case-folding'], reason: 'macOS and Windows ignore case in file names' },
  { file: 'tests/environments/systems.test.ts', test: 'test 203: names in NFC and in NFD are judged, and each finding names the file as git lists it', systems: ['darwin'], behaviours: ['unicode-names'], reason: 'macOS git precomposes Unicode names, and its file systems normalize them' },
  { file: 'tests/environments/systems.test.ts', test: 'test 204: a checkout with core.autocrlf=true sends the reviewer the prompt of the LF checkout and keys its verdict the same', systems: ['win32'], behaviours: ['line-ends'], reason: 'a CRLF checkout with core.autocrlf, as on Windows' },
  { file: 'tests/environments/systems.test.ts', test: 'test 205: the packed tarball, installed globally without the network, starts from every shell of the system and checks the sample', systems: ['win32', 'darwin'], behaviours: ['install'], reason: 'a global npm install with .cmd shims, cmd.exe, PowerShell and Git Bash on Windows; BSD tar and the shells of macOS' },
  { file: 'tests/security/git-programs.test.ts', test: 'S5-14: prime, explain, doctor and docs start no program that the repository names for git (I-git-1)', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'hooks path is the null device, named differently on Windows; git runs hooks through sh' },
  { file: 'tests/security/git-programs.test.ts', test: 'S5-14: init starts no program that the repository names for git (I-git-1)', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'hooks path is the null device, named differently on Windows; git runs hooks through sh' },
  { file: 'tests/security/git-programs.test.ts', test: 'S5-14: check and try start no program that the repository names for git, and still see the change (I-git-1)', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'hooks path is the null device, named differently on Windows; git runs hooks through sh' },
  { file: 'tests/security/git-programs.test.ts', test: 'S5-14: the fixture arms git: the same reads through git itself start the programs', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'git for Windows runs the marker scripts through the sh shell it ships' },
  { file: 'tests/security/git-programs.test.ts', test: 'S5-14: a submodule whose own config names a filter starts nothing during check, explain and doctor (I-git-1)', systems: ['win32'], behaviours: ['git-for-windows'], reason: 'hooks path is the null device, named differently on Windows; git runs hooks through sh' },
  { file: 'tests/security/git-programs.test.ts', test: 'harness-7: check leaves the index as it was when the times of its files no longer match it', systems: ['win32'], behaviours: ['windows-paths', 'locks'], reason: 'the index is copied to a temporary folder, a Windows path with locking' },
  { file: 'tests/security/key-everywhere.test.ts', test: 'S3-2: a key that straddles the 300-character cut of a claude-code message shows none of its characters (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/key-forms.test.ts', test: 'S3-2: claude-code with the key "findings" in its environment: the answer is read, and the key is replaced in its message (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/key-forms.test.ts', test: 'S3-2: claude-code with the key "k\\"e\\\\y-1x" in its environment: the answer is read, and the key is replaced in its message (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/linked.test.ts', test: 'S5-15: a .lawcheck/config.yaml linked to a one-line secret shows none of it (I-secret-2)', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinked law files on Windows; macOS temporary folders resolve through /private' },
  { file: 'tests/security/linked.test.ts', test: 'S5-15: a .lawcheck/law.yaml linked to a one-line secret shows none of it (I-secret-2)', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinked law files on Windows; macOS temporary folders resolve through /private' },
  { file: 'tests/security/linked.test.ts', test: 'S5-15: a .lawcheck folder linked to a folder whose law holds a secret shows none of it (I-secret-2)', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinked folders on Windows; macOS temporary folders resolve through /private' },
  { file: 'tests/security/linked.test.ts', test: 'S5-15: a law and a config that are plain files still show the text of their errors', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'the realpath link check must not flag plain files under macOS /private or Windows paths' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link that leads outside the root stops the run before any rule runs, naming the link', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinks and junctions on Windows; macOS resolves temporary folders through /private' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: an untracked link is the local user\'s own and does not stop the run', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinks and junctions on Windows; macOS resolves temporary folders through /private' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link that stays inside the root does not stop the run', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinks and junctions on Windows; macOS resolves temporary folders through /private' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link whose name holds a line break is not dropped from the guard', systems: ['darwin'], behaviours: ['real-paths'], reason: 'the link guard compares the root by realpath, which macOS resolves through /private' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a link whose target only shares the beginning of the root path is outside it', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'the inside check by separator on Windows; macOS realpath of temporary folders' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link inside a submodule that leads outside the root is refused', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'git for Windows checks links out as plain files; macOS realpath of temporary folders' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link that leads elsewhere inside the git work tree passes, with the law in a package below the top', systems: ['win32', 'darwin'], behaviours: ['links', 'real-paths'], reason: 'symlinks and junctions on Windows; macOS resolves temporary folders through /private' },
  { file: 'tests/security/output-sources.test.ts', test: 'I-out-1: file names cannot forge a line of check, explain or try, and each finding stays one line', systems: ['win32'], behaviours: ['file-names'], reason: 'Windows refuses control characters and :*?"<>| in file names' },
  { file: 'tests/security/output-sources.test.ts', test: 'I-out-1: git\'s error text cannot forge a line of check, prime or doctor', systems: ['win32'], behaviours: ['file-names'], reason: 'Windows refuses control characters in the file name of the folder the test uses' },
  { file: 'tests/security/path-entries.test.ts', test: 'I-start-1: the PATH filter keeps a quoted absolute entry and drops a relative or empty one', systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup'], reason: 'Windows searches the current folder and PATHEXT for a program started by a bare name' },
  { file: 'tests/security/path-entries.test.ts', test: 'I-start-1: findProgram and the hooks find a program in a quoted absolute PATH entry on Windows, and none through a relative entry', systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], reason: 'a quoted PATH entry, a .cmd file and PATHEXT on Windows' },
  { file: 'tests/security/runner.test.ts', test: 'S8-4: a root whose path ends in * lets no rule read the folders beside it', systems: ['darwin'], behaviours: ['real-paths'], reason: 'Node\'s --permission grants the root by its real path, which macOS resolves through /private' },
  { file: 'tests/security/runner.test.ts', test: 'S2-8: a root whose path holds a backslash is refused by name, not blamed on the rule', systems: ['darwin'], behaviours: ['real-paths'], reason: 'Node\'s --permission grants the root by its real path, which macOS resolves through /private' },
  { file: 'tests/security/runner.test.ts', test: 'I-runner-1: a rule reads nothing outside the root and the package at a root path holding *, a comma, a backslash, a space or non-ASCII (test 26, S8-4, S2-8)', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'Node\'s --permission paths on Windows; macOS temporary folders resolve through /private' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode answer (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode raw (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode error (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode boom (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: a key in the environment of claude-code appears in no output, file or temporary file, with claude in mode expired (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-error (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-stderr (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/secrets.test.ts', test: 'S3-2: claude that prints the keys of its environment shows them as [key], with claude in mode echo-answer (I-secret-1)', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a fake claude is a .cmd shim started through cmd.exe on Windows' },
  { file: 'tests/security/start.test.ts', test: 'I-start-1: check, a review through claude-code and the hooks start no program that lies in the repository, through a relative PATH entry or the current folder', systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup'], reason: 'cmd.exe searches the current folder; .cmd shims and PATH lookup on Windows' },
  { file: 'tests/security/start.test.ts', test: 'I-start-1: under runner npx and pnpm the hooks start no program of the repository through a relative PATH entry', systems: ['win32'], behaviours: ['cmd-shims', 'path-lookup'], reason: 'cmd.exe searches the current folder; .cmd shims and PATH lookup on Windows' },
  { file: 'tests/security/start.test.ts', test: 'I-start-1: on Windows a node.cmd at the root does not run when the hooks start a global Lawcheck whose shim calls node', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'cmd.exe and its search of the current folder exist only on Windows' },
  { file: 'tests/security/temp-folder.test.ts', test: 'harness-5: a check whose temporary folder is missing still judges the change, and ends in no internal', systems: ['win32'], behaviours: ['temp-folders'], reason: 'the temporary folder comes from TEMP and TMP on Windows, TMPDIR elsewhere' },
  { file: 'tests/security/temp-folder.test.ts', test: 'harness-5: a review through claude-code whose temporary folder is missing names the folder, and ends in no internal', systems: ['win32'], behaviours: ['temp-folders', 'cmd-shims'], reason: 'TEMP and TMP name the temporary folder on Windows; claude is a .cmd shim' },
  { file: 'tests/unit/check.test.ts', test: 'the root is the nearest directory above that holds .lawcheck/law.yaml, as its real path', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'realpath and directory symlinks of a temporary folder on Windows and macOS' },
  { file: 'tests/unit/programs.test.ts', test: 'a program is found on PATH, and on Windows by the endings of PATHEXT', systems: ['win32'], behaviours: ['path-lookup'], reason: 'PATHEXT and drive-letter PATH entries exist only on Windows' },
  { file: 'tests/unit/programs.test.ts', test: 'every argument and the output pass through a program started as the callers start it, a .cmd file on Windows too', systems: ['win32'], behaviours: ['cmd-shims'], reason: 'a .cmd file started through cmd.exe, with its quoting, on Windows' },
  { file: 'tests/unit/programs.test.ts', test: 'killTree ends a program and the programs it started', systems: ['win32'], behaviours: ['process-ends'], reason: 'killTree uses taskkill on Windows and a process group elsewhere' },
  { file: 'tests/unit/programs.test.ts', test: 'killTree with orphans ends the programs left by a program that has already ended', systems: ['win32'], behaviours: ['process-ends'], reason: 'orphans on Windows are found through PowerShell after taskkill fails' },
  { file: 'tests/unit/providers-claude-code.test.ts', test: 'claude is looked up on PATH', systems: ['win32'], behaviours: ['file-modes', 'cmd-shims'], reason: 'Windows has no executable bit; claude.cmd is found through PATHEXT' },
  { file: 'tests/unit/providers-copilot-cli.test.ts', test: 'a copilot in the folder of the VS Code extension is passed over', systems: ['win32'], behaviours: ['path-lookup', 'cmd-shims'], reason: 'the PATH separator and copilot.cmd on Windows' },
  { file: 'tests/unit/providers-program.test.ts', test: 'the working folder and the folder aside are gone when the call ends, before the tool does', systems: ['win32'], behaviours: ['locks', 'environment', 'cmd-shims'], reason: 'Windows keeps the working folder of a running process; Path case and .cmd shim' },
  { file: 'tests/unit/runner.test.ts', test: 'the runner makes one call per file, in order, and passes repo.filesOf', systems: ['win32', 'darwin'], behaviours: ['windows-paths', 'real-paths'], reason: 'Node\'s --permission paths of the runner on Windows and macOS' },
  { file: 'tests/unit/runner.test.ts', test: 'a call past the time limit crashes the rule', systems: ['win32'], behaviours: ['process-ends'], reason: 'the runner is killed at its time limit, by taskkill on Windows' },
  { file: 'tests/unit/runner.test.ts', test: 'a load past the time limit crashes the rule', systems: ['win32'], behaviours: ['process-ends'], reason: 'the runner is killed at its time limit, by taskkill on Windows' },
  { file: 'tests/unit/runner.test.ts', test: 'a module that does not load', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a module load under Node\'s --permission with Windows paths' },
  { file: 'tests/unit/runner.test.ts', test: 'process.env is empty in a rule, and an unknown type throws', systems: ['win32'], behaviours: ['environment'], reason: 'a child started with an empty environment on Windows' },
  { file: 'tests/unit/runner.test.ts', test: 'the time limit holds for the load and for each call, not for the rule as a whole', systems: ['win32'], behaviours: ['slow-starts'], reason: 'process start on Windows is slow against a one-second limit' },
  { file: 'tests/unit/setup.test.ts', test: 'a path typed from a directory below the root is made relative to the root, and one outside is usage', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a typed path is made relative with backslash separators on Windows' },
  { file: 'tests/unit/setup.test.ts', test: 'locate stops with not-initialized without a law', systems: ['win32', 'darwin'], behaviours: ['real-paths', 'windows-paths'], reason: 'realpath of a temporary folder: /private/var on macOS, long names on Windows' },
  { file: 'tests/unit/try.test.ts', test: 'paths, directories and patterns select files once, in path order, binary ones left out', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a typed path is made relative with backslash separators on Windows' },
  { file: 'tests/unit/try.test.ts', test: 'a target that selects nothing says why', systems: ['win32'], behaviours: ['windows-paths'], reason: 'a path outside the root is detected through separators on Windows' },
  { file: 'tests/unit/verdicts.test.ts', test: 'a recorded pass sorts, drops lines that do not match, writes the attributes once and removes the cache file', systems: ['win32'], behaviours: ['locks'], reason: 'the verdicts file is renamed over an existing file, which Windows may lock' },
  { file: 'tests/contract/discovery.test.ts', test: 'a test file planted outside tests/, in a fixture folder, or with another extension is found and caught (control)', systems: ['win32'], behaviours: ['windows-paths'], reason: 'paths found under a temporary folder are turned from Windows backslashes to slashes' },
];

export function perPushFiles(system: System, files: string[] = setFiles('commit', groupDirs('commit', null)!)): string[] {
  if (system === 'linux') return files;
  const holding = new Set(PLATFORM_TESTS.filter((entry) => entry.systems.includes(system)).map((entry) => entry.file));
  return files.filter((file) => holding.has(file));
}

export function perPushTests(system: System, files: string[]): string[] | null {
  if (system === 'linux') return null;
  const named = new Set(files);
  return PLATFORM_TESTS.filter((entry) => entry.systems.includes(system) && named.has(entry.file)).map((entry) => entry.test);
}

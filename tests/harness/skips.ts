export type SkipPlatform = 'win32' | 'darwin' | 'linux' | 'root';

export interface PlatformSkip {
  file: string;
  test: string;
  part: string;
  platform: SkipPlatform;
  reason: string;
}

const UNREADABLE_WINDOWS = 'chmod on Windows sets only the read-only flag, so a file cannot be made unreadable';
const UNREADABLE_ROOT = 'chmod cannot make a file unreadable for root';
const SIGNALS = 'every signal ends a process on Windows at once, so the tool cannot answer it with its own exit code';

const ESCAPED = 'Windows lets no process read the environment of another, which is how the tool finds a child that left the program\'s group, and such a child keeps the folder of the test from being removed';

export const HARNESS = 'tests/harness';

export const PLATFORM_SKIPS: PlatformSkip[] = [
  { file: 'tests/acceptance/hostile.test.ts', test: 'R-37: an untracked src/core/a<LF>b.ts holding console.log is in the change and fails the check', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a line break in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-2: a file whose name holds a line break, a carriage return or an invalid byte is judged, its name escaped', part: 'the whole test', platform: 'win32', reason: 'Windows refuses these characters in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-2: a name given on the command line in its escaped form selects that file, and a raw backslash selects the same file as its escape', part: 'the whole test', platform: 'win32', reason: 'Windows refuses these characters in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S5-9: explain gives a file whose name holds a line break its type, on one line', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a line break in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S5-6: explain of a path with a segment over 255 bytes is usage as test 245 says, and an escaped segment is measured by the bytes it stands for, never internal', part: 'an escaped segment', platform: 'win32', reason: 'a backslash separates directories on Windows' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'S6-4: an edit of a file with a backslash in its name checks that file', part: 'the whole test', platform: 'win32', reason: 'a backslash separates directories on Windows' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'S6-10: the check before finishing sees a file whose name holds a line break', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a line break in a file name' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'R-24: a file whose name starts with a double quote does not stop the check before finishing from seeing the rest', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a double quote in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-14: a name that starts with a double quote, marked assume-unchanged and edited, is in the change, and its twin without quotes is not', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a double quote in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-14: a name in double quotes, marked assume-unchanged and edited, is in the change, and its twin without quotes is not', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a double quote in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-14: a name with a line feed, marked assume-unchanged and edited, is in the change, and its twin without quotes is not', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a line feed in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-14: a name with a carriage return, marked assume-unchanged and edited, is in the change, and its twin without quotes is not', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a carriage return in a file name' },
  { file: 'tests/acceptance/hostile.test.ts', test: 'S1-2: a file whose name holds a line break, a carriage return or an invalid byte is judged, its name escaped', part: 'a name that is not valid UTF-8', platform: 'darwin', reason: 'the file system of macOS refuses a name that is not valid UTF-8' },
  { file: 'tests/contract/codes.test.ts', test: 'test 239: stopped, in text and in JSON, and the command its next line names', part: 'the whole test', platform: 'win32', reason: SIGNALS },
  { file: 'tests/limits/signals.test.ts', test: 'test 239: S1-1, R-28, a signal while files are typed against a heavy pattern ends the run as stopped', part: 'the whole test', platform: 'win32', reason: SIGNALS },
  { file: 'tests/limits/signals.test.ts', test: 'test 239: S1-1, a signal while a rule spins ends the run as stopped, and the runner with it', part: 'the whole test', platform: 'win32', reason: SIGNALS },
  { file: 'tests/limits/signals.test.ts', test: 'test 239: S3-3, a signal while a one-megabyte answer is read ends the run as stopped', part: 'the whole test', platform: 'win32', reason: SIGNALS },
  { file: 'tests/limits/signals.test.ts', test: 'test 258: a signal while git runs ends the run as stopped within two seconds, and git with it', part: 'the whole test', platform: 'win32', reason: SIGNALS },
  { file: 'tests/limits/internals.test.ts', test: 'test 244: S1-7, a folder that cannot be read is file-unreadable for the typed files below it, and a law that cannot be read is law-invalid', part: 'the whole test', platform: 'win32', reason: 'chmod on Windows sets only the read-only flag, so a folder cannot be made unreadable' },
  { file: 'tests/limits/internals.test.ts', test: 'test 244: S1-7, a folder that cannot be read is file-unreadable for the typed files below it, and a law that cannot be read is law-invalid', part: 'the whole test', platform: 'root', reason: 'chmod cannot make a folder unreadable for root' },
  { file: 'tests/limits/internals.test.ts', test: 'test 241: S5-4, init where .lawcheck is a symbolic link to nothing names it', part: 'the whole test', platform: 'win32', reason: 'a symbolic link on Windows needs a right a test user does not have' },
  { file: 'tests/limits/internals.test.ts', test: 'test 1005: S5-5, .lawcheck/law.yaml is a symbolic link to nothing, so init sends the user to doctor, and doctor and check say the law cannot be read', part: 'the whole test', platform: 'win32', reason: 'a symbolic link on Windows needs a right a test user does not have' },
  { file: 'tests/limits/internals.test.ts', test: 'test 1006: S1-8, a rule file that is a symbolic link is named as one, since Lawcheck reads no rule through a link, and the rule is not said to have no file', part: 'the whole test', platform: 'win32', reason: 'a symbolic link on Windows needs a right a test user does not have' },
  { file: 'tests/limits/internals.test.ts', test: 'test 260: a named pipe is no regular file: explain names it, and as .lawcheck/verdicts it is file-unreadable, with no call', part: 'the whole test', platform: 'win32', reason: 'Windows has no named pipe in the file system' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, S5-13, S8-8, every command writing to /dev/full ends with exit 2 and says the result is lost', part: 'the whole test', platform: 'darwin', reason: 'only Linux has /dev/full' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, S5-13, S8-8, every command writing to /dev/full ends with exit 2 and says the result is lost', part: 'the whole test', platform: 'win32', reason: 'only Linux has /dev/full' },
  { file: 'tests/limits/writes.test.ts', test: 'test 240: S1-6, a closed standard output is the same as one sent to /dev/null', part: 'the whole test', platform: 'win32', reason: 'Windows has no shell that closes a standard output' },
  { file: HARNESS, test: 'every run', part: 'no process of the run is left alive', platform: 'win32', reason: 'Node on Windows cannot read the environment of another process, so no process can be told by the run\'s mark, and a list of processes with their parents comes only from PowerShell, which takes seconds a call on a busy machine' },
  { file: HARNESS, test: 'every run', part: 'a signal the test sent ends the run as docs/codes.md says (stopped, exit 2) and as decision 56 says (a hook, exit 0)', platform: 'win32', reason: SIGNALS },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: an exit code outside 0, 1 and 2, or a death by signal, fails the run', part: 'a death by a signal nobody sent', platform: 'win32', reason: 'a process on Windows that kills itself ends with an exit code, never by a signal' },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: a signal the test sends ends the run as docs/codes.md says (stopped, exit 2) and as decision 56 says (a hook, exit 0), and SIGKILL alone may end it by the signal', part: 'the answer to a caught signal', platform: 'win32', reason: SIGNALS },
  { file: 'tests/contract/harness.test.ts', test: 'harness-1: a hook the test stops exits 0 and prints nothing, as question 56 says', part: 'the answer of a stopped hook', platform: 'win32', reason: SIGNALS },
  { file: 'tests/contract/harness.test.ts', test: 'harness-6: a process the run leaves alive fails it, however quickly it left', part: 'a process left alive', platform: 'win32', reason: 'Node on Windows cannot read the environment of another process, so no process can be told by the run\'s mark, and a list of processes with their parents comes only from PowerShell, which takes seconds a call on a busy machine' },
  { file: 'tests/acceptance/law.test.ts', test: 'test 15: a symlink and a binary file have no type; an unreadable file stops the run', part: 'an unreadable file', platform: 'win32', reason: UNREADABLE_WINDOWS },
  { file: 'tests/acceptance/law.test.ts', test: 'test 15: a symlink and a binary file have no type; an unreadable file stops the run', part: 'an unreadable file', platform: 'root', reason: UNREADABLE_ROOT },
  { file: 'tests/acceptance/law.test.ts', test: 'check-slice §6: a law that cannot be read is law-invalid', part: 'the whole test', platform: 'win32', reason: UNREADABLE_WINDOWS },
  { file: 'tests/acceptance/law.test.ts', test: 'check-slice §6: a law that cannot be read is law-invalid', part: 'the whole test', platform: 'root', reason: UNREADABLE_ROOT },
  { file: 'tests/acceptance/changes.test.ts', test: 'check-slice §4: a change of the mode alone counts', part: 'the whole test', platform: 'win32', reason: 'Windows keeps no executable bit, and git there does not track one (core.fileMode is false)' },
  { file: 'tests/acceptance/changes.test.ts', test: 'check-slice §4: every git command runs with GIT_OPTIONAL_LOCKS=0, in the order of the table', part: 'the whole test', platform: 'win32', reason: 'Node starts git on Windows only as an .exe or .com file, so a script cannot stand in for it' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'test 163: the deadline, and a hook that is stopped', part: 'a hook stopped by SIGTERM', platform: 'win32', reason: 'every signal ends a process on Windows at once, so a stopped hook cannot end what it started' },
  { file: 'tests/deadlines/hook-deadlines.nightly.test.ts', test: 'test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships', part: 'a hook stopped by SIGTERM', platform: 'win32', reason: 'every signal ends a process on Windows at once, so a stopped hook cannot end what it started' },
  { file: 'tests/acceptance/plugin.test.ts', test: 'plugin-slice §5: the call ends 2 seconds after Lawcheck exits while a child holds its output', part: 'the child left behind is ended', platform: 'win32', reason: 'Windows has no process groups: a child left by a program that has ended cannot be reached through it' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 67: claude-code past its timeout, and the tool killed', part: 'exit 2 after SIGTERM and SIGINT', platform: 'win32', reason: SIGNALS },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 406: codex', part: 'a child that left the group', platform: 'win32', reason: ESCAPED },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 407: gemini-cli', part: 'a child that left the group', platform: 'win32', reason: ESCAPED },
  { file: 'tests/acceptance/program-providers.test.ts', test: 'test 408: copilot-cli', part: 'a child that left the group', platform: 'win32', reason: ESCAPED },
  { file: 'tests/acceptance/rules.test.ts', test: 'check-slice §3: a rule that spins ends with the tool, whatever ends the tool', part: 'exit 2 after SIGTERM', platform: 'win32', reason: SIGNALS },
  { file: 'tests/unit/providers-claude-code.test.ts', test: 'reviewer-slice §6: claude is looked up on PATH', part: 'a claude that is not executable', platform: 'win32', reason: 'Windows has no executable bit; a .cmd file is always a program' },
  { file: 'tests/unit/programs.test.ts', test: 'reviewer-slice §6: a program is found on PATH, and on Windows by the endings of PATHEXT', part: 'the lookup with the rules of Linux', platform: 'win32', reason: 'a folder on Windows holds a drive colon, which a PATH split with the rules of Linux cuts in two' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link whose name holds a line break is not dropped from the guard', part: 'the whole test', platform: 'win32', reason: 'Windows refuses a line break in a file name' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link whose name is not valid UTF-8 is not dropped from the guard', part: 'the whole test', platform: 'win32', reason: 'Windows takes a file name only as valid UTF-16' },
  { file: 'tests/security/links.test.ts', test: 'I-runner-1: a tracked link whose name is not valid UTF-8 is not dropped from the guard', part: 'the whole test', platform: 'darwin', reason: 'the file system of macOS refuses a name that is not valid UTF-8' },
  { file: 'tests/security/start.test.ts', test: 'R-8: I-start-1, on Windows a node.cmd at the root does not run when the hooks start a global Lawcheck whose shim calls node', part: 'the whole test', platform: 'linux', reason: 'cmd.exe and its search of the current folder exist only on Windows' },
  { file: 'tests/security/start.test.ts', test: 'R-8: I-start-1, on Windows a node.cmd at the root does not run when the hooks start a global Lawcheck whose shim calls node', part: 'the whole test', platform: 'darwin', reason: 'cmd.exe and its search of the current folder exist only on Windows' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1008: on Windows the guard of a killed tool ends what a root left, and leaves alive a process that holds a root\'s id and the child of an older process whose parent id is a root\'s, whether its list of processes comes in time or not', part: 'the whole test', platform: 'linux', reason: 'elsewhere the guard ends a process group, and only Windows ends a tree from its list of processes' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1008: on Windows the guard of a killed tool ends what a root left, and leaves alive a process that holds a root\'s id and the child of an older process whose parent id is a root\'s, whether its list of processes comes in time or not', part: 'the whole test', platform: 'darwin', reason: 'elsewhere the guard ends a process group, and only Windows ends a tree from its list of processes' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1010: on Windows the guard of a killed tool stops its own PowerShell that hangs, ends within a bound and removes the folders it was told of', part: 'the whole test', platform: 'linux', reason: 'elsewhere the guard ends a process group and takes no list of processes, so there is no PowerShell to hang' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1010: on Windows the guard of a killed tool stops its own PowerShell that hangs, ends within a bound and removes the folders it was told of', part: 'the whole test', platform: 'darwin', reason: 'elsewhere the guard ends a process group and takes no list of processes, so there is no PowerShell to hang' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1011: on Windows the guard of a killed tool leaves alive a process that holds the id of a rule runner, with a list of processes that does not show the runner', part: 'the whole test', platform: 'linux', reason: 'elsewhere the guard ends a rule runner by its id, and only Windows gives an ended process\'s id to a new one' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1011: on Windows the guard of a killed tool leaves alive a process that holds the id of a rule runner, with a list of processes that does not show the runner', part: 'the whole test', platform: 'darwin', reason: 'elsewhere the guard ends a rule runner by its id, and only Windows gives an ended process\'s id to a new one' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1045: on Windows the guard of a tool killed before its first list of processes ends what a program left, and leaves alive the child that an older holder of the program\'s id made after the guard started', part: 'the whole test', platform: 'linux', reason: 'elsewhere the guard ends a process group, and only Windows ends a tree from its list of processes' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1045: on Windows the guard of a tool killed before its first list of processes ends what a program left, and leaves alive the child that an older holder of the program\'s id made after the guard started', part: 'the whole test', platform: 'darwin', reason: 'elsewhere the guard ends a process group, and only Windows ends a tree from its list of processes' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1046: on Windows a program call that ends normally ends nothing by the program\'s id once the program has ended, so a process given that id is left alive with its child', part: 'the whole test', platform: 'linux', reason: 'elsewhere the tool ends a program\'s process group, not a tree by the program\'s id' },
  { file: 'tests/acceptance/providers.test.ts', test: 'test 1046: on Windows a program call that ends normally ends nothing by the program\'s id once the program has ended, so a process given that id is left alive with its child', part: 'the whole test', platform: 'darwin', reason: 'elsewhere the tool ends a program\'s process group, not a tree by the program\'s id' },
  { file: 'tests/security/runner.test.ts', test: 'S8-4: a root whose path ends in * lets no rule read the folders beside it', part: 'the whole test', platform: 'win32', reason: 'Windows refuses * in a file name' },
  { file: 'tests/security/runner.test.ts', test: 'S2-8: a root whose path holds a backslash is refused by name, not blamed on the rule', part: 'the whole test', platform: 'win32', reason: 'a backslash is the separator on Windows' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 200: below git 2.34 every command but --version, --help and docs refuses in its first line, naming the version', part: 'the whole test', platform: 'win32', reason: 'Node starts git on Windows only as an .exe or .com file, so a script cannot stand in for it' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 200: control, git 2.34.1 is not refused', part: 'the whole test', platform: 'win32', reason: 'Node starts git on Windows only as an .exe or .com file, so a script cannot stand in for it' },
  { file: 'tests/environments/refusal.test.ts', test: 'test 201: a runner file that cannot be read is runner-failed, naming the file', part: 'the whole test', platform: 'win32', reason: UNREADABLE_WINDOWS },
  { file: 'tests/environments/refusal.test.ts', test: 'test 201: a runner file that cannot be read is runner-failed, naming the file', part: 'the whole test', platform: 'root', reason: UNREADABLE_ROOT },
  { file: 'tests/environments/shapes.test.ts', test: 'S2-2: a node_modules at the root that links to a folder outside it is refused in the same words', part: 'the whole test', platform: 'win32', reason: 'a junction on Windows is resolved before Node checks the path, so the package it leads to reads as inside the root' },
  { file: 'tests/contract/codes.test.ts', test: 'check-slice §6: file-unreadable, in text and in JSON, and its next line gets further', part: 'the whole test', platform: 'win32', reason: UNREADABLE_WINDOWS },
  { file: 'tests/contract/codes.test.ts', test: 'check-slice §6: file-unreadable, in text and in JSON, and its next line gets further', part: 'the whole test', platform: 'root', reason: UNREADABLE_ROOT },
  { file: 'tests/contract/codes.test.ts', test: 'check-slice §6: base-unreachable, rule-crashed, parser-failed, internal, link-outside-root, path-unsupported and runner-failed, in text and in JSON, and the commands their next lines name', part: 'path-unsupported', platform: 'win32', reason: 'Windows refuses * in a file name' },
  { file: 'tests/environments/systems.test.ts', test: 'test 202: on a file system that ignores case, explain SRC/core/price.ts answers for src/core/price.ts, the file git lists', part: 'the whole test', platform: 'linux', reason: 'the file systems of Linux tell SRC from src' },
  { file: 'tests/environments/systems.test.ts', test: 'test 202: control, where the file system tells case apart, SRC/core/price.ts is a file that does not exist yet', part: 'the whole test', platform: 'darwin', reason: 'the default file system of macOS ignores case' },
  { file: 'tests/environments/systems.test.ts', test: 'test 202: control, where the file system tells case apart, SRC/core/price.ts is a file that does not exist yet', part: 'the whole test', platform: 'win32', reason: 'the file systems of Windows ignore case' },
  { file: 'tests/security/old-git.test.ts', test: 'I-git-2: a check of a repository with a submodule sends no git command that git 2.34 refuses, and its link guard still reads the submodule', part: 'the whole test', platform: 'win32', reason: 'Node starts git on Windows only as an .exe or .com file, so a script cannot stand in for it' },
];

export function applies(platform: SkipPlatform): boolean {
  if (platform === 'root') return process.getuid?.() === 0;
  return process.platform === platform;
}

const printed = new Set<PlatformSkip>();

function say(entry: PlatformSkip): void {
  if (printed.has(entry)) return;
  printed.add(entry);
  process.stdout.write(`skip ${entry.file} > ${entry.test}: ${entry.part} on ${entry.platform}: ${entry.reason}\n`);
}

export function skipReason(file: string, name: string, part: string): string | null {
  const listed = PLATFORM_SKIPS.filter((entry) => entry.file === file && entry.test === name && entry.part === part);
  if (listed.length === 0) throw new Error(`harness: "${part}" of ${file} > "${name}" is skipped without an entry in PLATFORM_SKIPS (tests/harness/skips.ts)`);
  const hit = listed.find((entry) => applies(entry.platform));
  if (hit === undefined) return null;
  say(hit);
  return hit.reason;
}

export function harnessSkip(part: string): boolean {
  const hit = PLATFORM_SKIPS.find((entry) => entry.file === HARNESS && entry.part === part && applies(entry.platform));
  if (hit === undefined) return false;
  say(hit);
  return true;
}

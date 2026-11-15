import { testIds } from './promises.ts';

export type SkipPlatform = 'win32' | 'darwin' | 'linux' | 'root';

export interface PlatformSkip {
  test: string;
  part: string;
  platform: SkipPlatform;
  reason: string;
}

export const PLATFORM_SKIPS: PlatformSkip[] = [
  { test: 'test 15', part: 'an unreadable file', platform: 'win32', reason: 'chmod on Windows sets only the read-only flag, so a file cannot be made unreadable' },
  { test: 'test 15', part: 'an unreadable file', platform: 'root', reason: 'chmod cannot make a file unreadable for root' },
  { test: 'section 6: a law that cannot be read is law-invalid', part: 'the whole test', platform: 'win32', reason: 'chmod on Windows sets only the read-only flag, so a file cannot be made unreadable' },
  { test: 'section 6: a law that cannot be read is law-invalid', part: 'the whole test', platform: 'root', reason: 'chmod cannot make a file unreadable for root' },
  { test: 'section 4: a change of the mode alone counts', part: 'the whole test', platform: 'win32', reason: 'Windows keeps no executable bit, and git there does not track one (core.fileMode is false)' },
  { test: 'section 4: every git command runs with GIT_OPTIONAL_LOCKS=0, in the order of the table', part: 'the whole test', platform: 'win32', reason: 'Node starts git on Windows only as an .exe or .com file, so a script cannot stand in for it' },
  { test: 'test 163', part: 'a hook stopped by SIGTERM', platform: 'win32', reason: 'every signal ends a process on Windows at once, so a stopped hook cannot end what it started' },
  { test: 'section 5: the call ends 2 seconds after Lawcheck exits while a child holds its output', part: 'the child left behind is ended', platform: 'win32', reason: 'Windows has no process groups: a child left by a program that has ended cannot be reached through it' },
  { test: 'test 67', part: 'exit 2 after SIGTERM and SIGINT', platform: 'win32', reason: 'every signal ends a process on Windows at once, so the tool cannot answer it with its own exit code' },
  { test: 'section 3: a rule that spins ends with the tool, whatever ends the tool', part: 'exit 2 after SIGTERM', platform: 'win32', reason: 'every signal ends a process on Windows at once, so the tool cannot answer it with its own exit code' },
  { test: 'claude is looked up on PATH', part: 'a claude that is not executable', platform: 'win32', reason: 'Windows has no executable bit; a .cmd file is always a program' },
];

function applies(platform: SkipPlatform): boolean {
  if (platform === 'root') return process.getuid?.() === 0;
  return process.platform === platform;
}

function matches(entry: PlatformSkip, name: string): boolean {
  return testIds(name).includes(entry.test) || name === entry.test || name.startsWith(`${entry.test}:`);
}

export function skipReason(name: string, part: string): string | null {
  const listed = PLATFORM_SKIPS.filter((entry) => entry.part === part && matches(entry, name));
  if (listed.length === 0) throw new Error(`harness: "${part}" of "${name}" is skipped without an entry in PLATFORM_SKIPS (tests/harness/skips.ts)`);
  const hit = listed.find((entry) => applies(entry.platform));
  if (hit === undefined) return null;
  process.stdout.write(`skip ${hit.test}: ${part} on ${hit.platform}: ${hit.reason}\n`);
  return hit.reason;
}

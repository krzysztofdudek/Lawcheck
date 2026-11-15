import { fileURLToPath } from 'node:url';
import { git } from './files.js';
import type { ErrorItem } from './output.js';

export const OLDEST_NODE = 24;
export const OLDEST_GIT: readonly [number, number] = [2, 34];

export interface Runtime {
  node: string;
  bun: string | undefined;
  pnp: string | undefined;
  packageDir: string;
}

export function runtimeNow(): Runtime {
  const versions = process.versions as Record<string, string | undefined>;
  return { node: process.versions.node, bun: versions.bun, pnp: versions.pnp, packageDir: fileURLToPath(new URL('..', import.meta.url)) };
}

function refusal(message: string, next: string): ErrorItem {
  return { code: 'unsupported-environment', file: null, line: null, message, next };
}

export function runtimeRefusal(runtime: Runtime): ErrorItem | null {
  if (runtime.bun !== undefined) {
    return refusal(
      `this run is on Bun ${runtime.bun}, and Lawcheck runs on Node ${OLDEST_NODE} or later`,
      `install Node ${OLDEST_NODE} or later beside Bun, so that bun x starts Lawcheck on Node, then run lawcheck check`,
    );
  }
  const major = Number(runtime.node.split('.')[0]);
  if (!(major >= OLDEST_NODE)) {
    return refusal(`Node ${runtime.node} is older than ${OLDEST_NODE}, the oldest Node Lawcheck runs on`, `install Node ${OLDEST_NODE} or later, then run lawcheck check`);
  }
  // Yarn's Plug'n'Play keeps packages inside zip archives that only its own loader can open, and a runner of script rules starts with no loader.
  if (runtime.pnp !== undefined || /\.zip[\\/]/i.test(runtime.packageDir)) {
    return refusal(
      `Lawcheck is installed by Yarn Plug'n'Play, inside an archive that the runner of script rules cannot open`,
      'set nodeLinker: node-modules in .yarnrc.yml and run yarn install, then run lawcheck check',
    );
  }
  return null;
}

export function gitVersionOf(text: string): [number, number] | null {
  const found = /^git version (\d+)\.(\d+)/.exec(text.trim());
  return found === null ? null : [Number(found[1]), Number(found[2])];
}

export function gitRefusal(text: string): ErrorItem | null {
  const version = gitVersionOf(text);
  if (version === null) return null;
  const [major, minor] = version;
  const [oldestMajor, oldestMinor] = OLDEST_GIT;
  if (major > oldestMajor || (major === oldestMajor && minor >= oldestMinor)) return null;
  const oldest = `${oldestMajor}.${oldestMinor}`;
  return refusal(`git ${text.trim().slice('git version '.length)} is older than ${oldest}, the oldest git Lawcheck runs with`, `install git ${oldest} or later, then run lawcheck check`);
}

// A git that cannot start, or prints no version, is left to the command, which names it as no-git.
export function gitNow(cwd: string): string | null {
  try {
    const result = git(cwd, ['--version']);
    return result.status === 0 ? result.stdout.toString('utf8') : null;
  } catch {
    return null;
  }
}

export function environmentRefusal(runtime: Runtime, gitText: () => string | null): ErrorItem | null {
  const refused = runtimeRefusal(runtime);
  if (refused !== null) return refused;
  const text = gitText();
  return text === null ? null : gitRefusal(text);
}

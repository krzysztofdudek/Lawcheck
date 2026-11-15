import { spawnSync } from 'node:child_process';
import { lstatSync } from 'node:fs';
import { bytesOfName, nameOf, onDisk, quotedLine } from './names.mjs';
import { findProgram } from './start.mjs';

class NoSnapshot extends Error {}

let gitProgram;

function git(root, args, deadline, input) {
  const left = deadline.left();
  if (left === 0) throw new NoSnapshot('the deadline passed before git could list the files');
  gitProgram ??= findProgram('git', { ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'PATHEXT')), PATHEXT: '.EXE' });
  if (gitProgram === null) throw new NoSnapshot('git cannot be started (it is not on the PATH)');
  const result = spawnSync(gitProgram, args, {
    cwd: root,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    input,
    maxBuffer: 1 << 30,
    timeout: left,
    killSignal: 'SIGKILL',
    stdio: [input === undefined ? 'ignore' : 'pipe', 'pipe', 'pipe'],
  });
  if (result.error) throw new NoSnapshot(`git cannot be started (${result.error.code ?? firstOf(result.error.message)})`);
  if (result.status === null) throw new NoSnapshot(`git ${args[0]} was stopped`);
  return result;
}

function firstOf(text) {
  return String(text).split(/\r?\n/).find((line) => line.trim() !== '') ?? '';
}

function ok(result, args) {
  if (result.status !== 0) {
    const said = firstOf(result.stderr.toString('utf8'));
    throw new NoSnapshot(`git ${args[0]} exited with ${result.status}${said === '' ? '' : `: ${said}`}`);
  }
  return result.stdout;
}

function run(root, args, deadline, input) {
  return ok(git(root, args, deadline, input), args);
}

function splitZ(buffer) {
  const paths = [];
  let start = 0;
  for (let i = 0; i < buffer.length; i++) {
    if (buffer[i] !== 0) continue;
    if (i > start) paths.push(nameOf(buffer.subarray(start, i)));
    start = i + 1;
  }
  return paths;
}

export function isRegular(root, path) {
  try {
    return lstatSync(onDisk(root, path)).isFile();
  } catch {
    return false;
  }
}

function headOf(root, deadline) {
  const result = git(root, ['rev-parse', '--verify', '--quiet', 'HEAD^{commit}'], deadline);
  if (result.status === 0) return result.stdout.toString('utf8').trim();
  if (result.status === 1) return null;
  throw new NoSnapshot(`git rev-parse exited with ${result.status}${firstOf(result.stderr.toString('utf8')) === '' ? '' : `: ${firstOf(result.stderr.toString('utf8'))}`}`);
}

export function snapshot(root, deadline) {
  try {
    const head = headOf(root, deadline);
    const listed = head === null
      ? splitZ(run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], deadline))
      : [
          ...splitZ(run(root, ['diff', '-z', '--name-only', '--no-renames', '--relative', 'HEAD', '--'], deadline)),
          ...splitZ(run(root, ['ls-files', '-z', '--others', '--exclude-standard'], deadline)),
        ];
    const paths = [...new Set(listed)].filter((path) => !path.startsWith('.lawcheck/.local/'));
    const files = {};
    const hashed = [];
    for (const path of paths) {
      files[path] = '-';
      if (isRegular(root, path)) hashed.push(path);
    }
    if (hashed.length > 0) {
      const prefix = run(root, ['rev-parse', '--show-prefix'], deadline).toString('utf8').replace(/\r?\n$/, '');
      const input = Buffer.concat(hashed.map((path) => quotedLine(prefix, bytesOfName(path))));
      const ids = run(root, ['hash-object', '--stdin-paths'], deadline, input).toString('utf8').split('\n');
      hashed.forEach((path, i) => {
        if (ids[i]) files[path] = ids[i];
      });
    }
    return { head, files };
  } catch (error) {
    if (error instanceof NoSnapshot) return { problem: error.message };
    throw error;
  }
}

function tree(root, head, deadline) {
  const out = new Map();
  if (head === null) return out;
  for (const entry of splitZ(run(root, ['ls-tree', '-r', '-z', head], deadline))) {
    const tab = entry.indexOf('\t');
    out.set(entry.slice(tab + 1), entry.slice(0, tab).split(' ')[2]);
  }
  return out;
}

function committedInTurn(root, before, after, started, deadline) {
  if (before.head === null || after.head === null || before.head === after.head) return [];
  const fork = git(root, ['merge-base', before.head, after.head], deadline);
  if (fork.status !== 0) return [];
  const base = fork.stdout.toString('utf8').trim();
  const commits = run(root, ['log', '--no-merges', '--format=%H %ct', `${base}..${after.head}`], deadline)
    .toString('utf8')
    .split('\n')
    .filter((line) => line !== '')
    .map((line) => line.split(' '))
    .filter(([, time]) => Number(time) >= started);
  const paths = [];
  for (const [commit] of commits) {
    paths.push(...splitZ(run(root, ['diff-tree', '--no-commit-id', '-r', '-z', '--name-only', '--no-renames', '--relative', commit, '--'], deadline)));
  }
  return paths;
}

export function turnPaths(root, before, after, started, deadline) {
  try {
    const changed = new Set();
    if (before === null) {
      for (const path of Object.keys(after.files)) changed.add(path);
    } else {
      const committed = committedInTurn(root, before, after, started, deadline).filter((path) => !path.startsWith('.lawcheck/.local/'));
      for (const path of committed) changed.add(path);
      const candidates = new Set([...Object.keys(before.files), ...Object.keys(after.files)]);
      const trees = new Map();
      const blob = (shot, path) => {
        if (Object.hasOwn(shot.files, path)) return shot.files[path];
        if (!trees.has(shot.head)) trees.set(shot.head, tree(root, shot.head, deadline));
        return trees.get(shot.head).get(path) ?? '-';
      };
      for (const path of candidates) if (!changed.has(path) && blob(before, path) !== blob(after, path)) changed.add(path);
    }
    return [...changed].filter((path) => isRegular(root, path)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  } catch (error) {
    if (error instanceof NoSnapshot) return { problem: error.message };
    throw error;
  }
}

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './edit.mjs';

export const PAGES = ['quick-start', 'forbid-a-use', 'write-a-script-rule', 'write-a-reviewer-rule', 'ci'];

export function chapterOf(page, root = ROOT) {
  if (!PAGES.includes(page)) throw new Error(`no chapter for the page ${page}; the chapters are ${PAGES.join(', ')}`);
  return JSON.parse(readFileSync(join(root, 'film', 'fixture', 'chapters', page, 'chapter.json'), 'utf8'));
}

export function gitIn(env) {
  return (cwd, ...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    if (result.status !== 0) throw new Error(`git ${args.join(' ')} ended with ${result.status}: ${result.stderr.trim()}`);
    return result.stdout;
  };
}

function overlay(root, name, into) {
  cpSync(join(root, 'film', 'fixture', 'chapters', name), into, { recursive: true });
}

// The repository a chapter starts from: the shop, the chapter's law and files on main, its branches, and the one it starts on.
// `onMain` runs in the folder of main before its commit; `takeOf(page)` names the folder of the take a branch builds on.
export function makeChapter(folder, page, env, { root = ROOT, onMain, takeOf } = {}) {
  const chapter = chapterOf(page, root);
  const git = gitIn(env);
  const seed = join(folder, 'seed');
  cpSync(join(root, 'film', 'fixture', 'shop'), seed, { recursive: true });
  if (chapter.law !== undefined) {
    mkdirSync(join(seed, '.lawcheck'), { recursive: true });
    cpSync(join(root, chapter.law), join(seed, '.lawcheck', 'law.yaml'));
  }
  for (const name of chapter.main ?? []) overlay(root, name, seed);
  onMain?.(seed);
  git(seed, 'init', '-q', '-b', 'main');
  git(seed, 'add', '-A');
  git(seed, 'commit', '-q', '-m', 'shop');
  git(folder, 'clone', '-q', '--bare', 'seed', 'origin.git');
  git(folder, 'clone', '-q', 'origin.git', 'shop');
  rmSync(seed, { recursive: true, force: true });
  const work = join(folder, 'shop');
  for (const branch of chapter.branches ?? []) {
    git(work, 'checkout', '-q', '-b', branch.name, 'main');
    for (const name of branch.overlays ?? []) overlay(root, name, work);
    if (branch.take !== undefined) {
      const files = join(takeOf(branch.take), 'files');
      if (existsSync(files)) cpSync(files, work, { recursive: true });
    }
    git(work, 'add', '-A');
    if (git(work, 'status', '--porcelain') !== '') git(work, 'commit', '-q', '-m', branch.name);
  }
  git(work, 'checkout', '-q', chapter.start);
  if (chapter.aside !== undefined) overlay(root, chapter.aside, join(folder, 'aside'));
  return { chapter, work };
}

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './edit.mjs';

export const GITHUB = 'https://github.com/krzysztofdudek/Lawcheck';
const IMAGE = /https:\/\/github\.com\/krzysztofdudek\/Lawcheck\/releases\/download\/[^/\s)]+\/(?:loop|hero)\.gif/g;

export const loopUrl = (release) => `${GITHUB}/releases/download/${release}/loop.gif`;
export const heroUrl = (release) => `${GITHUB}/releases/download/${release}/hero.gif`;
const TITLE = '# Lawcheck\n\n';
export const LOOP_TEXT = 'Claude Code imports the HTTP handlers into the business logic, and the tests pass. Lawcheck names the line.';
export const HERO_TEXT = 'An animation of Lawcheck. In my pilot, the agent imported the HTTP layer into the business logic in 8 of 20 sessions, and every test passed. With a law, Lawcheck names the file and line after the edit, the agent fixes the code, and the same check runs on the pull request in CI.';

export const loopLine = (release) => `[![${LOOP_TEXT}](${loopUrl(release)})](https://lawcheck.dev)`;
export const heroLine = (release) => `[![${HERO_TEXT}](${heroUrl(release)})](https://lawcheck.dev)`;

function fail(message) {
  process.stderr.write(`film/publish.mjs: ${message}\n`);
  process.exit(2);
}

function checked(file, bytes, where) {
  if (bytes === null) throw new Error(`${where} holds no ${file.name}`);
  const hash = createHash('sha256').update(bytes).digest('hex');
  if (hash !== file.sha256 || bytes.length !== file.bytes) throw new Error(`${file.name} of ${where} has ${bytes.length} bytes and the hash ${hash}, and its chapters.json names ${file.bytes} bytes and ${file.sha256}`);
}

export async function publishedOf(release, read, where) {
  const listing = await read('chapters.json');
  if (listing === null) throw new Error(`${where} holds no chapters.json, the list that node film/render.mjs writes`);
  const { chapters = [], loop = null, hero = null } = JSON.parse(listing.toString('utf8'));
  if (loop === null && hero === null) throw new Error(`the chapters.json of ${where} holds no hero and no loop, one of which the README shows: render them with node film/render.mjs, which lists them beside the chapters`);
  for (const item of [hero, loop, ...chapters].filter((entry) => entry !== null)) for (const file of Object.values(item.files)) checked(file, await read(file.name), where);
  const of = (item) => (item === null ? null : { ...item, release });
  return { chapters: chapters.map((chapter) => ({ ...chapter, release })), loop: of(loop), hero: of(hero) };
}

// The README shows the hero of a release that holds one, and the loop of a release made before the hero.
export function readmeWith(readme, release, image = 'hero') {
  const line = image === 'hero' ? heroLine(release) : loopLine(release);
  const found = readme.match(IMAGE) ?? [];
  if (found.length > 1) throw new Error(`README.md names the hero or the loop ${found.length} times, and the release step points one address at it`);
  if (found.length === 1) {
    const lines = readme.split('\n');
    const at = lines.findIndex((row) => row.includes(found[0]));
    if (!lines[at].startsWith('[![') || !lines[at].endsWith('](https://lawcheck.dev)')) throw new Error(`line ${at + 1} of README.md names ${found[0]} and is not the image line the release step writes`);
    lines[at] = line;
    return lines.join('\n');
  }
  if (!readme.startsWith(TITLE)) throw new Error('README.md does not start with the heading "# Lawcheck", under which the release step puts the image');
  return `${TITLE}${line}\n\n${readme.slice(TITLE.length)}`;
}

export function fromFolder(folder) {
  return async (name) => (existsSync(join(folder, name)) ? readFileSync(join(folder, name)) : null);
}

export function fromRelease(release) {
  return async (name) => {
    const answer = await fetch(`${GITHUB}/releases/download/${release}/${name}`);
    if (answer.status === 404) return null;
    if (!answer.ok) throw new Error(`the release ${release} answers ${answer.status} for ${name}`);
    return Buffer.from(await answer.arrayBuffer());
  };
}

export async function publish(root, release, read, where) {
  const published = await publishedOf(release, read, where);
  const readme = readmeWith(readFileSync(join(root, 'README.md'), 'utf8'), release, published.hero === null ? 'loop' : 'hero');
  writeFileSync(join(root, 'film', 'published.json'), `${JSON.stringify(published, null, 2)}\n`);
  writeFileSync(join(root, 'README.md'), readme);
  return published;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--release');
  const from = args.indexOf('--from');
  const release = at >= 0 ? args[at + 1] : undefined;
  const known = new Set(['--release', '--from']);
  if (release === undefined || release.startsWith('--') || (from >= 0 && args[from + 1] === undefined) || args.some((arg, index) => arg.startsWith('--') && !known.has(arg) && index !== at + 1 && index !== from + 1)) fail('usage: node film/publish.mjs --release <tag> [--from <folder that node film/render.mjs wrote>]');
  const folder = from >= 0 ? resolve(args[from + 1]) : null;
  try {
    const published = await publish(ROOT, release, folder === null ? fromRelease(release) : fromFolder(folder), folder ?? `the release ${release}`);
    process.stdout.write(`film/publish.mjs: film/published.json lists ${published.hero === null ? 'no hero' : 'the hero'}, ${published.loop === null ? 'no loop' : 'the loop'} and ${published.chapters.length} chapters of the release ${release}, and README.md shows ${published.hero === null ? loopUrl(release) : heroUrl(release)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

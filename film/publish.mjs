import { createHash } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT } from './edit.mjs';

export const GITHUB = 'https://github.com/krzysztofdudek/Lawcheck';
const LOOP = /https:\/\/github\.com\/krzysztofdudek\/Lawcheck\/releases\/download\/[^/\s)]+\/loop\.gif/g;

export const loopUrl = (release) => `${GITHUB}/releases/download/${release}/loop.gif`;
const TITLE = '# Lawcheck\n\n';
export const LOOP_TEXT = 'Claude Code imports the HTTP handlers into the business logic, and the tests pass. Lawcheck names the line. With the same prompt, the law and the plugin, the agent keeps the layers apart.';

export const loopLine = (release) => `[![${LOOP_TEXT}](${loopUrl(release)})](https://lawcheck.dev)`;

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
  const { chapters = [], loop = null } = JSON.parse(listing.toString('utf8'));
  if (loop === null) throw new Error(`the chapters.json of ${where} holds no loop: render it with node film/render.mjs, which lists the loop beside the chapters`);
  for (const item of [loop, ...chapters]) for (const file of Object.values(item.files)) checked(file, await read(file.name), where);
  return { chapters: chapters.map((chapter) => ({ ...chapter, release })), loop: { ...loop, release } };
}

export function readmeWith(readme, release) {
  const found = readme.match(LOOP) ?? [];
  if (found.length > 1) throw new Error(`README.md names the loop ${found.length} times, and the release step points one address at it`);
  if (found.length === 1) return readme.replace(LOOP, loopUrl(release));
  if (!readme.startsWith(TITLE)) throw new Error('README.md does not start with the heading "# Lawcheck", under which the release step puts the loop');
  return `${TITLE}${loopLine(release)}\n\n${readme.slice(TITLE.length)}`;
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
  const readme = readmeWith(readFileSync(join(root, 'README.md'), 'utf8'), release);
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
    process.stdout.write(`film/publish.mjs: film/published.json lists the loop and ${published.chapters.length} chapters of the release ${release}, and README.md shows ${loopUrl(release)}\n`);
  } catch (error) {
    fail(error.message);
  }
}

import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { judge, judgeChapter } from './accept.mjs';
import { decodeTerminal, lengthOf, readEdit, ROOT, screensOf, stringsOf, timelinesOf, words } from './edit.mjs';
import { fingerprint } from './pilot.mjs';
import { gitIn, makeChapter } from './shop.mjs';

export { decodeTerminal };

const LOOP_SECONDS = [15, 30];
const CHAPTER_SECONDS = [40, 60];
const SCREEN_WORDS = 45;
const IDENTITY = { GIT_AUTHOR_NAME: 'Dev', GIT_AUTHOR_EMAIL: 'dev@example.com', GIT_COMMITTER_NAME: 'Dev', GIT_COMMITTER_EMAIL: 'dev@example.com' };
// A variable that names a CI system or a Lawcheck setting would change the base or the output of a run.
const UNSET = /^(?:LAWCHECK_|GITHUB_|GITLAB_|CI_|SYSTEM_|BUILD_|BITBUCKET_|TEAMCITY_|CODEBUILD_|GIT_)|^(?:CI|TF_BUILD|JENKINS_URL|BUILDKITE|CIRCLECI|TRAVIS|APPVEYOR|DRONE|WOODPECKER)$/;
const PRIVATE = [
  [/(?<![\w./-])(?:\/home|\/Users|[A-Z]:\\Users)[\\/](?!dev[\\/])[\w.-]+/g, 'a home folder other than /home/dev'],
  [/sk-ant-[\w-]{8,}/g, 'an Anthropic key'],
  [/\bgh[pousr]_\w{20,}/g, 'a GitHub token'],
  [/\beyJ[\w-]{20,}\.[\w-]{20,}/g, 'a signed token'],
  [/[\w.%+-]+@[\w-]+(?:\.[\w-]+)*\.[a-z]{2,}/gi, 'an e-mail address'],
  [/orbstack/gi, 'the word orbstack'],
  [/\b[\w.-]+\.ts\.net\b/gi, 'a host name under ts.net'],
  [/\btailnet\b/gi, 'the word tailnet'],
  [/clientbox/gi, 'the word clientbox'],
  [/\/mnt\/mac\b/gi, 'a path under /mnt/mac'],
];
// Names that only the recording machine knows, such as its tailnet's name, come from the environment so that this file does not publish them.
const PRIVATE_WORDS = 'LAWCHECK_FILM_PRIVATE';
const ADDRESSES = new Set(['dev@example.com', 'noreply@anthropic.com']);

function leaves(value, into = []) {
  if (typeof value === 'string') into.push(value);
  else if (Array.isArray(value)) for (const item of value) leaves(item, into);
  else if (value !== null && typeof value === 'object') for (const item of Object.values(value)) leaves(item, into);
  return into;
}

function linesOfText(text) {
  return text.split('\n').map((line) => ({ text: line, colors: null }));
}

export function sourceOf(root, edit, from) {
  if (from.repo !== undefined) return { name: from.repo, lines: linesOfText(readFileSync(join(root, from.repo), 'utf8')) };
  if (from.run !== undefined) {
    const name = `film/takes/${from.run}/output.txt`;
    if (from.command) {
      const run = edit.runs[from.run];
      return { name: `the command of run ${from.run}`, lines: linesOfText(run === undefined ? '' : `lawcheck ${run.args.join(' ')}`) };
    }
    return { name, lines: existsSync(join(root, name)) ? linesOfText(readFileSync(join(root, name), 'utf8')) : [] };
  }
  const name = `film/takes/${from.take}/${from.file}`;
  const path = join(root, name);
  if (!existsSync(path)) return { name, lines: [] };
  const text = readFileSync(path, 'utf8');
  if (/^terminal.*\.jsonl$/.test(from.file)) return { name, lines: decodeTerminal(text) };
  if (from.file.endsWith('.jsonl')) return { name, lines: text.split('\n').filter((line) => line.trim() !== '').flatMap((line) => leaves(JSON.parse(line))).flatMap(linesOfText) };
  if (from.file.endsWith('.json')) return { name, lines: leaves(JSON.parse(text)).flatMap(linesOfText) };
  return { name, lines: linesOfText(text) };
}

function colorAt(line, at, length) {
  const colors = new Set((line.colors ?? []).slice(at, at + length));
  return colors.size === 1 ? [...colors][0] : colors.size === 0 ? null : undefined;
}

function itemProblems(root, edit, where, item) {
  const source = sourceOf(root, edit, item.from);
  const quoted = JSON.stringify(item.text);
  if (item.from.line !== undefined) {
    const line = source.lines[item.from.line - 1];
    if (line === undefined || line.text !== item.text) return [`${where}: ${quoted} is not line ${item.from.line} of ${source.name}`];
    return item.number !== undefined && item.number !== item.from.line ? [`${where}: ${quoted} is numbered ${item.number}, but it is line ${item.from.line} of ${source.name}`] : [];
  }
  const found = source.lines.map((line) => ({ line, at: line.text.indexOf(item.text) })).filter((hit) => hit.at >= 0);
  if (found.length === 0) return [`${where}: ${quoted} is not in ${source.name}`];
  if (source.lines.some((line) => line.colors !== null)) {
    const want = item.color ?? null;
    if (!found.some((hit) => colorAt(hit.line, hit.at, item.text.length) === want)) return [`${where}: ${quoted} is shown ${want ?? 'without a color'}, and ${source.name} printed it ${found.map((hit) => colorAt(hit.line, hit.at, item.text.length) ?? 'without a color').join(' or ')}`];
  }
  if (item.now !== undefined && !sourceOf(root, edit, { run: item.now }).lines.some((line) => line.text.includes(item.text))) return [`${where}: ${quoted} is not in the output of run ${item.now}, film/takes/${item.now}/output.txt`];
  return [];
}

function takeProblems(root, edit) {
  const problems = [];
  const pilot = JSON.parse(readFileSync(join(root, 'film', 'pilot.json'), 'utf8'));
  for (const [role, id] of Object.entries(edit.takes)) {
    const folder = join(root, 'film', 'takes', id);
    if (!existsSync(join(folder, 'take.json'))) {
      problems.push(`the take ${id} has no folder film/takes/${id}`);
      continue;
    }
    const row = pilot.sessions.find((session) => session.id === id);
    if (row === undefined) problems.push(`the take ${id} is not a session of film/pilot.json`);
    else if (fingerprint(folder) !== row.record) problems.push(`film/takes/${id} is not the record that film/pilot.json counts: its hash differs`);
    const verdict = judge(folder);
    if (!verdict.accepted) problems.push(`the take ${id} is refused by film/accept.mjs: ${verdict.reasons.join('; ')}`);
    if (verdict.arm !== (role === 'without' ? 'a' : 'b')) problems.push(`the take ${id} is of arm ${verdict.arm}, and the edit uses it as the session ${role} Lawcheck`);
  }
  for (const chapter of edit.chapters ?? []) {
    const folder = join(root, 'film', 'takes', chapter.take);
    if (!existsSync(join(folder, 'take.json'))) {
      problems.push(`the take ${chapter.take} of the chapter ${chapter.page} has no folder film/takes/${chapter.take}`);
      continue;
    }
    if (fingerprint(folder) !== chapter.record) problems.push(`film/takes/${chapter.take} is not the take the chapter ${chapter.page} records: its hash differs`);
    const verdict = judgeChapter(folder);
    if (verdict.page !== chapter.page) problems.push(`the take ${chapter.take} is a take of ${verdict.page}, and the edit uses it for the chapter ${chapter.page}`);
    if (!verdict.accepted) problems.push(`the take ${chapter.take} is refused by film/accept.mjs: ${verdict.reasons.join('; ')}`);
  }
  return problems;
}

export function truthProblems(root = ROOT, edit = readEdit(root)) {
  const problems = takeProblems(root, edit);
  let strings = 0;
  for (const timeline of timelinesOf(edit)) {
    for (const segment of timeline.segments) {
      segment.screens.forEach((screen, index) => {
        const where = `${segment.id}, screen ${index + 1}`;
        for (const block of screen.blocks) {
          if (block.label !== undefined && typeof block.label !== 'string') {
            strings++;
            problems.push(...itemProblems(root, edit, where, block.label));
          }
          for (const item of [...(block.lines ?? []), ...(block.small === undefined ? [] : [block.small])]) {
            if (item.more) continue;
            strings++;
            if (item.from === undefined) problems.push(`${where}: ${JSON.stringify(item.text)} names no source`);
            else problems.push(...itemProblems(root, edit, where, item));
          }
        }
      });
    }
  }
  return { problems, strings };
}

export function privateWords(value = process.env[PRIVATE_WORDS]) {
  return (value ?? '').split(',').map((word) => word.trim()).filter((word) => word !== '');
}

export function privateSummary(words) {
  const listed = words.length === 0 ? `; ${PRIVATE_WORDS} is empty, so the names only the recording machine knows were not looked for` : ` or a name listed in ${PRIVATE_WORDS}`;
  return `no file of film/takes holds a home folder, a key, a token, an e-mail address, orbstack, a ts.net host, the word tailnet, clientbox or /mnt/mac${listed}`;
}

export function privateProblems(root = ROOT, words = privateWords()) {
  const problems = [];
  const patterns = [...PRIVATE, ...privateWords(words.join(',')).map((word) => [new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'), `a name listed in ${PRIVATE_WORDS}`])];
  const walk = (folder, prefix) => {
    for (const entry of readdirSync(folder, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
      const path = `${prefix}/${entry.name}`;
      if (entry.isDirectory()) walk(join(folder, entry.name), path);
      else {
        const text = readFileSync(join(folder, entry.name), 'utf8');
        for (const [pattern, what] of patterns) {
          for (const match of text.matchAll(pattern)) if (!ADDRESSES.has(match[0].toLowerCase())) problems.push(`${path} holds ${what}: ${match[0]}`);
        }
      }
    }
  };
  walk(join(root, 'film', 'takes'), 'film/takes');
  return [...new Set(problems)];
}

export function readingProblems(edit) {
  const problems = [];
  for (const timeline of timelinesOf(edit)) {
    const seconds = lengthOf(timeline.segments);
    const [least, most] = timeline.name === 'loop' ? LOOP_SECONDS : CHAPTER_SECONDS;
    if (seconds < least || seconds > most) problems.push(`${timeline.name === 'loop' ? 'the loop' : `the chapter ${timeline.name}`} lasts ${seconds} s, outside ${least} to ${most} s`);
    let before = new Set();
    for (const screen of screensOf(timeline.segments)) {
      const all = screen.text.flatMap(words);
      const fresh = all.filter((word) => !before.has(word)).length;
      const needed = 1 + fresh / 3;
      const stands = screen.end - screen.start;
      if (stands + 1e-9 < needed) problems.push(`${screen.id}: ${fresh} new words need ${needed.toFixed(2)} s on screen, and it stands ${stands.toFixed(2)} s`);
      if (all.length > SCREEN_WORDS) problems.push(`${screen.id}: ${all.length} words on screen at once, over ${SCREEN_WORDS}`);
      before = new Set(all);
    }
  }
  return problems;
}

// A film that names a release, a version of a tool or a model is wrong after the next release.
const VERSIONED = [
  [/\d+\.\d+/g, 'a number with a point, as a version has'],
  [/@v?\d/gi, 'a version after @'],
  [/\bv\d+\b/gi, 'a version as v and a number'],
  [/\b(?:sonnet|opus|haiku|fable)\b|\bclaude-[a-z]+-\d/gi, 'the name of a model'],
];

export function versionProblems(edit) {
  const problems = [];
  for (const timeline of timelinesOf(edit)) {
    for (const screen of screensOf(timeline.segments)) {
      for (const text of [...screen.screen.blocks.flatMap(stringsOf), screen.segment.caption ?? '', screen.segment.subtitle ?? '']) {
        for (const [pattern, what] of VERSIONED) for (const match of text.matchAll(pattern)) problems.push(`${screen.id}: ${JSON.stringify(text)} shows ${what}: ${match[0]}`);
      }
    }
  }
  return [...new Set(problems)];
}

function environment(home) {
  const env = Object.fromEntries(Object.entries(process.env).filter(([name]) => !UNSET.test(name)));
  return { ...env, ...IDENTITY, HOME: home, USERPROFILE: home, LANG: 'C.UTF-8', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: join(home, '.gitconfig') };
}

export function runOf(root, edit, id, cli) {
  const run = edit.runs[id];
  const folder = mkdtempSync(join(tmpdir(), 'lawcheck-film-'));
  try {
    const home = join(folder, 'home');
    mkdirSync(home);
    writeFileSync(join(home, '.gitconfig'), '');
    const env = environment(home);
    const git = (cwd, ...args) => {
      const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
      if (result.status !== 0) throw new Error(`git ${args.join(' ')} ended with ${result.status}: ${result.stderr.trim()}`);
    };
    let shop;
    if (run.chapter !== undefined) {
      const takeOf = (page) => join(root, 'film', 'takes', (edit.chapters ?? []).find((chapter) => chapter.page === page)?.take ?? '');
      shop = makeChapter(folder, run.chapter, env, { root, takeOf }).work;
      if (run.branch !== undefined) gitIn(env)(shop, 'checkout', '-q', run.branch);
    } else {
      const seed = join(folder, 'seed');
      cpSync(join(root, 'film', 'fixture', 'shop'), seed, { recursive: true });
      if (run.law !== undefined) {
        mkdirSync(join(seed, '.lawcheck'));
        cpSync(join(root, run.law), join(seed, '.lawcheck', 'law.yaml'));
      }
      git(seed, 'init', '-q', '-b', 'main');
      git(seed, 'add', '-A');
      git(seed, 'commit', '-q', '-m', 'shop');
      git(folder, 'clone', '-q', '--bare', 'seed', 'origin.git');
      git(folder, 'clone', '-q', 'origin.git', 'shop');
      shop = join(folder, 'shop');
      git(shop, 'checkout', '-q', '-b', 'loyalty-discount');
    }
    if (run.take !== undefined) cpSync(join(root, 'film', 'takes', run.take, 'files'), shop, { recursive: true });
    const result = spawnSync(process.execPath, [cli, ...run.args], { cwd: shop, env, encoding: 'utf8', timeout: 60000 });
    return { exit: result.status, output: result.stdout, error: result.stderr };
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
}

export function stalenessProblems(root, edit, run) {
  const problems = [];
  for (const id of Object.keys(edit.runs)) {
    const now = run(id);
    const folder = join(root, 'film', 'takes', id);
    if (!existsSync(join(folder, 'output.txt'))) {
      problems.push(`run ${id} has no recorded output in film/takes/${id}; node film/check.mjs --write records it`);
      continue;
    }
    const kept = { ...JSON.parse(readFileSync(join(folder, 'run.json'), 'utf8')), output: readFileSync(join(folder, 'output.txt'), 'utf8') };
    if (now.error !== '') problems.push(`run ${id} printed on standard error: ${now.error.trim().split('\n')[0]}`);
    if (now.exit !== kept.exit || now.output !== kept.output) {
      const [had, has] = [kept.output.split('\n'), now.output.split('\n')];
      const at = had.findIndex((line, index) => line !== has[index]);
      problems.push(`the film shows output this build no longer prints: run ${id} (lawcheck ${edit.runs[id].args.join(' ')}) exits ${now.exit}, the film's record ${kept.exit}${at < 0 ? '' : `; line ${at + 1} was ${JSON.stringify(had[at] ?? '')} and is now ${JSON.stringify(has[at] ?? '')}`}. node film/check.mjs --write records the new output, and film/README.md says what follows`);
    }
  }
  return problems;
}

export function write(root, edit, run, version) {
  for (const id of Object.keys(edit.runs)) {
    const now = run(id);
    const folder = join(root, 'film', 'takes', id);
    mkdirSync(folder, { recursive: true });
    writeFileSync(join(folder, 'run.json'), `${JSON.stringify({ id, ...edit.runs[id], exit: now.exit, lawcheck: version }, null, 2)}\n`);
    writeFileSync(join(folder, 'output.txt'), now.output);
  }
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const writing = args.includes('--write');
  const unknown = args.filter((arg) => arg !== '--write');
  if (unknown.length > 0) {
    process.stderr.write(`usage: node film/check.mjs [--write]\nunknown argument ${unknown[0]}\n`);
    process.exit(2);
  }
  const cli = join(ROOT, 'dist', 'cli.js');
  if (!existsSync(cli)) {
    process.stderr.write('film/check.mjs: dist/cli.js is missing; run npm run build first\n');
    process.exit(2);
  }
  const edit = readEdit(ROOT);
  const run = (id) => runOf(ROOT, edit, id, cli);
  if (writing) {
    const version = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
    write(ROOT, edit, run, version);
    process.stdout.write(`film/check.mjs: recorded the output of ${Object.keys(edit.runs).length} runs in film/takes with the build of ${version}\n`);
  }
  const truth = truthProblems(ROOT, edit);
  const stale = stalenessProblems(ROOT, edit, run);
  const reading = readingProblems(edit);
  const secret = privateProblems(ROOT);
  const versions = versionProblems(edit);
  const report = (name, problems, good) => {
    process.stdout.write(problems.length === 0 ? `${name}: ${good}\n` : problems.map((problem) => `${name}: ${problem}\n`).join(''));
  };
  report('truth', truth.problems, `all ${truth.strings} strings on screen come from their take, run or page`);
  report('staleness', stale, `${Object.keys(edit.runs).length} runs of this build print what the film shows`);
  report('reading time', reading, `the loop lasts ${lengthOf(edit.loop)} s, ${(edit.chapters ?? []).map((chapter) => `the chapter ${chapter.page} ${lengthOf(chapter.timeline)} s`).join(', ')}, and every screen stands long enough to be read`);
  report('versions', versions, 'no screen, caption or subtitle shows a version or the name of a model');
  report('private', secret, privateSummary(privateWords()));
  const problems = truth.problems.length + stale.length + reading.length + secret.length + versions.length;
  process.stdout.write(problems === 0 ? 'film/check.mjs: PASS\n' : `film/check.mjs: FAIL  ${problems} problems\n`);
  process.exit(problems === 0 ? 0 : 1);
}

import { spawn, spawnSync } from 'node:child_process';
import { closeSync, cpSync, existsSync, mkdirSync, openSync, readFileSync, readSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { fileURLToPath } from 'node:url';
import { chapterOf, makeChapter } from './shop.mjs';

const FILM = dirname(fileURLToPath(import.meta.url));
export const PROMPT = 'Add a loyalty discount in src/core: a customer with more than five orders gets ten percent off. Return the new total and a message that shows the saved amount as money, the way the receipts do.';
const PS1 = 'shop $ ';
const COLUMNS = 88;
const ROWS = 26;
const KEY_MS = 30;
const TURN_LIMIT_MS = 15 * 60 * 1000;
const ALLOW = ['Read', 'Write', 'Edit', 'Glob', 'Grep', 'Bash'];

function fail(message) {
  process.stderr.write(`record: ${message}\n`);
  process.exit(2);
}

function run(cwd, env, command, args, options = {}) {
  const result = spawnSync(command, args, { cwd, env, encoding: 'utf8', maxBuffer: 1 << 28, ...options });
  return { code: result.status, out: result.stdout ?? '', err: result.stderr ?? '' };
}

function must(cwd, env, command, args) {
  const result = run(cwd, env, command, args);
  if (result.code !== 0) fail(`${command} ${args.join(' ')} ended with ${result.code}: ${(result.err || result.out).trim().split('\n').slice(-3).join(' | ')}`);
  return result.out;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function readOptions(argv) {
  const options = { arm: '', chapter: '', id: '', out: '', runs: '/home/dev/runs', pack: '', commit: '', offline: false, takes: {} };
  for (let i = 0; i < argv.length; i += 2) {
    if (argv[i] === '--offline') {
      options.offline = true;
      i -= 1;
      continue;
    }
    const value = argv[i + 1];
    if (value === undefined) fail(`${argv[i]} takes a value`);
    if (argv[i] === '--arm') options.arm = value;
    else if (argv[i] === '--chapter') options.chapter = value;
    else if (argv[i] === '--id') options.id = value;
    else if (argv[i] === '--out') options.out = value;
    else if (argv[i] === '--runs') options.runs = value;
    else if (argv[i] === '--pack') options.pack = value;
    else if (argv[i] === '--commit') options.commit = value;
    else if (argv[i] === '--take') {
      const [page, folder] = value.split('=');
      options.takes[page] = folder;
    } else fail(`unknown flag ${argv[i]}`);
  }
  if ((options.arm === '') === (options.chapter === '')) fail('give either --arm a|b or --chapter <page>');
  if (options.arm !== '' && !['a', 'b'].includes(options.arm)) fail('--arm takes a or b');
  if (!/^[a-z0-9-]+$/.test(options.id)) fail('--id takes lowercase letters, digits and hyphens');
  if (options.out === '') fail('--out names the folder that receives the take');
  if (options.chapter !== '' && (options.pack === '' || options.commit === '')) fail('--chapter needs --pack, the packed build of the candidate, and --commit, the commit it was built from');
  return options;
}

function makeRepository(root, arm, env) {
  const seed = join(root, 'seed');
  cpSync(join(FILM, 'fixture', 'shop'), seed, { recursive: true });
  if (arm === 'b') {
    mkdirSync(join(seed, '.lawcheck'));
    cpSync(join(FILM, 'fixture', 'law', 'law.yaml'), join(seed, '.lawcheck', 'law.yaml'));
  }
  must(seed, env, 'git', ['init', '-q', '-b', 'main']);
  must(seed, env, 'git', ['add', '-A']);
  must(seed, env, 'git', ['commit', '-q', '-m', 'shop']);
  must(root, env, 'git', ['clone', '-q', '--bare', seed, 'origin.git']);
  must(root, env, 'git', ['clone', '-q', 'origin.git', 'shop']);
  rmSync(seed, { recursive: true, force: true });
  const work = join(root, 'shop');
  must(work, env, 'git', ['checkout', '-q', '-b', 'loyalty-discount']);
  return work;
}

function readFrom(file, offset) {
  const size = statSync(file).size;
  if (size <= offset) return Buffer.alloc(0);
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(file, 'r');
  readSync(fd, buffer, 0, buffer.length, offset);
  closeSync(fd);
  return buffer;
}

async function terminal(work, env, folder, commands, name = 'terminal') {
  const out = join(folder, `${name}.out`);
  const timing = join(folder, `${name}.timing`);
  const exits = join(folder, `${name}.exits`);
  const child = spawn('script', ['-q', '-f', '--log-out', out, '--log-timing', timing, '-c', 'bash --norc --noprofile -i'], {
    cwd: work,
    env: { ...env, PS1, PROMPT_COMMAND: `echo $? >> '${exits}'`, TERM: 'xterm-256color', GIT_PAGER: 'cat', PAGER: 'cat', NO_UPDATE_NOTIFIER: '1' },
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  const waitPrompt = async (from, limit) => {
    const begin = Date.now();
    while (Date.now() - begin < limit) {
      await sleep(100);
      if (existsSync(out) && readFrom(out, from).toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').endsWith(PS1)) return true;
    }
    return false;
  };
  const marks = [];
  const type = async (text, limit, paced) => {
    const from = existsSync(out) ? statSync(out).size : 0;
    if (paced) {
      for (const key of text) {
        child.stdin.write(key);
        await sleep(KEY_MS);
      }
      await sleep(300);
    } else child.stdin.write(text);
    const sent = Date.now();
    child.stdin.write('\n');
    await sleep(200);
    const ended = await waitPrompt(from + Buffer.byteLength(text), limit);
    marks.push({ command: text, seconds: (Date.now() - sent) / 1000, ended });
    return ended;
  };
  if (!(await waitPrompt(0, 10000))) fail('the shell showed no prompt');
  await type(`stty cols ${COLUMNS} rows ${ROWS} && clear`, 10000, false);
  let complete = true;
  for (const [index, command] of commands.entries()) {
    await sleep(600);
    if (!(await type(command, command.startsWith('claude -p') ? TURN_LIMIT_MS : 300000, true))) {
      complete = false;
      break;
    }
  }
  await sleep(500);
  child.stdin.end('exit\n');
  await new Promise((resolve) => child.on('close', resolve));
  const bytes = readFileSync(out);
  const decoder = new StringDecoder('utf8');
  const header = bytes.indexOf(0x0a) + 1;
  let offset = header;
  let time = 0;
  const events = [];
  for (const line of readFileSync(timing, 'utf8').split('\n')) {
    const match = /^(?:O )?([0-9.]+) ([0-9]+)$/.exec(line.trim());
    if (match === null) continue;
    time += Number(match[1]);
    const data = decoder.write(bytes.subarray(offset, offset + Number(match[2])));
    offset += Number(match[2]);
    if (data !== '') events.push(JSON.stringify([Math.round(time * 1000) / 1000, data]));
  }
  writeFileSync(join(folder, `${name}.jsonl`), [JSON.stringify({ columns: COLUMNS, rows: ROWS, prompt: PS1 }), ...events].join('\n') + '\n');
  const codes = existsSync(exits) ? readFileSync(exits, 'utf8').split('\n').filter((line) => line !== '').map(Number) : [];
  marks.forEach((mark, index) => {
    if (mark.ended) mark.exit = codes[index + 1] ?? null;
  });
  rmSync(out);
  rmSync(timing);
  rmSync(exits, { force: true });
  return { complete, marks };
}

function changedFiles(work, env) {
  const listed = [
    ...must(work, env, 'git', ['diff', '-z', '--name-only', '--no-renames', 'origin/main', '--']).split('\0'),
    ...must(work, env, 'git', ['ls-files', '-z', '--others', '--exclude-standard']).split('\0'),
  ];
  return [...new Set(listed.filter((path) => path !== ''))].sort();
}

function transcriptsOf(home) {
  const projects = join(home, '.claude', 'projects');
  if (!existsSync(projects)) return [];
  const found = [];
  for (const project of readdirSync(projects)) {
    for (const file of readdirSync(join(projects, project))) if (file.endsWith('.jsonl')) found.push(join(projects, project, file));
  }
  return found;
}

function modelsOf(transcripts) {
  const models = new Set();
  for (const file of transcripts) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      const model = /"model":"([^"]+)"/.exec(line);
      if (model !== null && model[1] !== '<synthetic>') models.add(model[1]);
    }
  }
  return [...models].sort();
}

function pluginsOf(home) {
  const file = join(home, '.claude', 'plugins', 'installed_plugins.json');
  return existsSync(file) ? Object.values(JSON.parse(readFileSync(file, 'utf8')).plugins ?? {}).flat().map((entry) => ({ version: entry.version, commit: entry.gitCommitSha })) : [];
}

function keepFiles(work, folder, changed) {
  for (const path of changed) {
    const full = join(work, path);
    if (!existsSync(full) || !statSync(full).isFile()) continue;
    mkdirSync(dirname(join(folder, 'files', path)), { recursive: true });
    cpSync(full, join(folder, 'files', path));
  }
}

function environmentOf(home, extra = {}) {
  return {
    HOME: home,
    USER: 'dev',
    LANG: 'C.UTF-8',
    PATH: process.env.PATH,
    CLAUDE_CODE_OAUTH_TOKEN: process.env.CLAUDE_CODE_OAUTH_TOKEN,
    ENABLE_CLAUDEAI_MCP_SERVERS: 'false',
    DISABLE_AUTOUPDATER: '1',
    GIT_AUTHOR_NAME: 'Dev',
    GIT_AUTHOR_EMAIL: 'dev@example.com',
    GIT_COMMITTER_NAME: 'Dev',
    GIT_COMMITTER_EMAIL: 'dev@example.com',
    ...extra,
  };
}

function writeSettings(home) {
  mkdirSync(join(home, '.claude'), { recursive: true });
  writeFileSync(join(home, '.claude', 'settings.json'), JSON.stringify({ model: 'sonnet', effortLevel: 'medium', permissions: { defaultMode: 'dontAsk', allow: ALLOW } }, null, 2) + '\n');
}

async function recordArm(options) {
  const root = join(options.runs, options.id);
  if (existsSync(root)) fail(`${root} exists already`);
  const home = join(root, 'home');
  writeSettings(home);
  const env = environmentOf(home);
  const work = makeRepository(root, options.arm, env);
  if (options.arm === 'b') {
    must(work, env, 'claude', ['plugin', 'marketplace', 'add', 'krzysztofdudek/Lawcheck']);
    must(work, env, 'claude', ['plugin', 'install', 'lawcheck@lawcheck-marketplace']);
  }

  const folder = join(options.out, options.id);
  mkdirSync(folder, { recursive: true });
  const commands = [`claude -p "${PROMPT}"`, 'npm test', 'git add --all', 'git diff --staged'];
  if (options.arm === 'b') commands.push('lawcheck check', 'lawcheck check --base origin/main');
  const begin = Date.now();
  const session = await terminal(work, env, folder, commands);

  const transcripts = transcriptsOf(home);
  for (const [index, file] of transcripts.entries()) writeFileSync(join(folder, transcripts.length === 1 ? 'transcript.jsonl' : `transcript-${index + 1}.jsonl`), readFileSync(file));
  writeFileSync(join(folder, 'change.diff'), must(work, env, 'git', ['diff', '--staged', 'origin/main']));
  const changed = changedFiles(work, env);
  keepFiles(work, folder, changed);
  if (options.arm === 'b') cpSync(join(work, '.lawcheck', 'law.yaml'), join(folder, 'law.yaml'));

  const tests = run(work, env, 'npm', ['test'], { timeout: 120000 });
  const count = (name) => Number((new RegExp(`^. ${name} ([0-9]+)$`, 'm').exec(tests.out) ?? [])[1] ?? -1);
  const check = options.arm === 'b' ? run(work, env, 'lawcheck', ['check', '--base', 'origin/main'], { timeout: 120000 }) : null;
  writeFileSync(join(folder, 'take.json'), JSON.stringify({
    id: options.id,
    arm: options.arm,
    recorded: new Date(begin).toISOString(),
    prompt: PROMPT,
    complete: session.complete,
    commands: session.marks,
    changed,
    tests: { exit: tests.code, tests: count('tests'), pass: count('pass'), fail: count('fail') },
    check: check === null ? null : { exit: check.code, first: check.out.split('\n')[0] },
    versions: {
      lawcheck: must(work, env, 'lawcheck', ['--version']).trim(),
      claude_code: must(work, env, 'claude', ['--version']).trim(),
      node: process.version,
      models: modelsOf(transcripts),
      effort: 'medium',
      plugin: pluginsOf(home),
    },
  }, null, 2) + '\n');
  process.stdout.write(`${options.id}: ${session.complete ? 'recorded' : 'the turn did not end in time'}, ${changed.length} changed files, tests exit ${tests.code}${check === null ? '' : `, check exit ${check.code}`}\n`);
}

const REGISTRY_PORT = 4873;

async function startRegistry(pack) {
  const child = spawn(process.execPath, [join(FILM, 'registry.mjs'), pack, String(REGISTRY_PORT)], { stdio: ['ignore', 'pipe', 'inherit'] });
  const line = await new Promise((resolve) => child.stdout.once('data', (data) => resolve(String(data).trim())));
  return { url: line.split(' ')[0], stop: () => child.kill() };
}

function changedSince(work, env, start) {
  const listed = [
    ...must(work, env, 'git', ['diff', '-z', '--name-only', '--no-renames', start, '--']).split('\0'),
    ...must(work, env, 'git', ['ls-files', '-z', '--others', '--exclude-standard']).split('\0'),
  ];
  return [...new Set(listed.filter((path) => path !== ''))].sort();
}

function diffSince(work, env, start) {
  must(work, env, 'git', ['add', '--all', '--intent-to-add']);
  const diff = must(work, env, 'git', ['diff', start]);
  must(work, env, 'git', ['reset', '-q']);
  return diff;
}

async function online(fetchTimeout = 5000) {
  try {
    await fetch('https://registry.npmjs.org/', { signal: AbortSignal.timeout(fetchTimeout) });
    return true;
  } catch {
    return false;
  }
}

async function recordChapter(options) {
  const root = join(options.runs, options.id);
  const folder = join(options.out, options.id);
  const home = join(root, 'home');
  const npmHome = join(home, '.npm-global');
  const chapter = chapterOf(options.chapter);
  const extra = { NPM_CONFIG_PREFIX: npmHome, PATH: `${join(npmHome, 'bin')}:${process.env.PATH}`, npm_config_update_notifier: 'false' };

  if (options.offline) {
    if (!existsSync(join(folder, 'take.json'))) fail(`${folder} holds no take to go on with`);
    const env = environmentOf(home, extra);
    delete env.CLAUDE_CODE_OAUTH_TOKEN;
    const network = (await online()) ? 'on' : 'off';
    if (network === 'on') fail('the network answers; start this step in a container with no network');
    const keys = Object.keys(env).filter((name) => /KEY|TOKEN|SECRET|PASSWORD/i.test(name));
    const session = await terminal(join(root, 'shop'), env, folder, chapter.offline, 'terminal-2');
    const take = JSON.parse(readFileSync(join(folder, 'take.json'), 'utf8'));
    take.offline = { network, keys, complete: session.complete, commands: session.marks };
    writeFileSync(join(folder, 'take.json'), JSON.stringify(take, null, 2) + '\n');
    process.stdout.write(`${options.id}: the offline part recorded, ${session.marks.map((mark) => `${mark.command} exits ${mark.exit}`).join('; ')}\n`);
    return;
  }

  if (existsSync(root)) fail(`${root} exists already`);
  writeSettings(home);
  const registry = ['registry', 'project'].includes(chapter.lawcheck) ? await startRegistry(options.pack) : null;
  const env = environmentOf(home, { ...extra, ...(registry === null ? {} : { npm_config_registry: registry.url }) });
  try {
    if (['global', 'project'].includes(chapter.lawcheck)) must(root, env, 'npm', ['install', '--global', '--no-audit', '--no-fund', options.pack]);
    const onMain = chapter.lawcheck === 'project' ? (seed) => must(seed, env, 'npm', ['install', '--save-dev', '--no-audit', '--no-fund', 'lawcheck@alpha']) : undefined;
    const start = chapter.empty ? join(root, 'start') : null;
    if (start !== null) mkdirSync(start);
    const work = start ?? makeChapter(root, options.chapter, env, { root: dirname(FILM), onMain, takeOf: (page) => options.takes[page] ?? fail(`--take ${page}=<folder> names the take the branch builds on`) }).work;
    if (chapter.lawcheck === 'project') must(work, env, 'npm', ['ci', '--no-audit', '--no-fund']);
    if (chapter.plugin && !chapter.commands.some((command) => command.startsWith('claude plugin install'))) {
      must(work, env, 'claude', ['plugin', 'marketplace', 'add', 'krzysztofdudek/Lawcheck']);
      must(work, env, 'claude', ['plugin', 'install', 'lawcheck@lawcheck-marketplace']);
    }
    const head = start === null ? must(work, env, 'git', ['rev-parse', 'HEAD']).trim() : null;
    mkdirSync(folder, { recursive: true });
    const commands = chapter.commands.map((command) => command.replace('{prompt}', chapter.prompt));
    const begin = Date.now();
    const session = await terminal(work, env, folder, commands);
    const repository = start === null ? work : join(start, 'shop');

    const transcripts = transcriptsOf(home);
    for (const [index, file] of transcripts.entries()) writeFileSync(join(folder, transcripts.length === 1 ? 'transcript.jsonl' : `transcript-${index + 1}.jsonl`), readFileSync(file));
    const changed = head === null ? must(repository, env, 'git', ['ls-files', '-z', '--others', '--exclude-standard']).split('\0').filter((path) => path !== '').sort() : changedSince(work, env, head);
    if (head !== null) writeFileSync(join(folder, 'change.diff'), diffSince(work, env, head));
    keepFiles(repository, folder, changed);
    const take = {
      id: options.id,
      page: options.chapter,
      ...(chapter.arm === undefined ? {} : { arm: chapter.arm }),
      recorded: new Date(begin).toISOString(),
      prompt: chapter.prompt,
      complete: session.complete,
      commands: session.marks,
      changed,
    };
    if (chapter.arm !== undefined) {
      const tests = run(work, env, 'npm', ['test'], { timeout: 120000 });
      const count = (name) => Number((new RegExp(`^. ${name} ([0-9]+)$`, 'm').exec(tests.out) ?? [])[1] ?? -1);
      const check = run(work, env, 'lawcheck', ['check', '--base', 'origin/main'], { timeout: 120000 });
      take.tests = { exit: tests.code, tests: count('tests'), pass: count('pass'), fail: count('fail') };
      take.check = { exit: check.code, first: check.out.split('\n')[0] };
      cpSync(join(work, '.lawcheck', 'law.yaml'), join(folder, 'law.yaml'));
    }
    take.candidate = { commit: options.commit, lawcheck: must(repository, env, 'lawcheck', ['--version']).trim() };
    take.versions = { claude_code: must(repository, env, 'claude', ['--version']).trim(), node: process.version, models: modelsOf(transcripts), effort: 'medium', plugin: pluginsOf(home) };
    writeFileSync(join(folder, 'take.json'), JSON.stringify(take, null, 2) + '\n');
    process.stdout.write(`${options.id}: ${session.complete ? 'recorded' : 'a command did not end in time'}, ${changed.length} changed files; ${session.marks.slice(1).map((mark) => `exit ${mark.exit}`).join(', ')}\n`);
  } finally {
    registry?.stop();
  }
}

const options = readOptions(process.argv.slice(2));
if (options.arm !== '') await recordArm(options);
else await recordChapter(options);

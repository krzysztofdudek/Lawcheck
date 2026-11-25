import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { atOnce, inTemp, lawcheck, lawcheckAt, ROOT } from './helpers.ts';
import { fakeWrites } from '../harness/tool.ts';
import { parseLaw } from '../../dist/law.js';
import { parseConfig } from '../../dist/config.js';
import { readArguments } from '../../dist/args.js';
import { parseArguments } from '../../dist/cli.js';
import { WHY } from '../../dist/output.js';
import { fitChangelog } from '../../dist/docs.js';
import { example } from '../harness/examples.ts';

const DOC_PAGES = readdirSync(join(ROOT, 'docs')).filter((name) => name.endsWith('.md')).length;

const LIST = [
  `lawcheck docs: ${DOC_PAGES} topics; lawcheck docs <topic> prints one`,
  '',
  'Start',
  '  index  Lawcheck',
  '  install  Install',
  '  quick-start  Quick start',
  '  concepts  Concepts',
  '  other-tools  Lawcheck and the tools you already use',
  '',
  'Guides',
  '  i-want-to  I want to',
  '  first-law  The first type and the first rule',
  '  types-for-a-project  Types for an existing project',
  '  forbid-a-use  Forbid one layer to use another',
  '  write-a-script-rule  Write a script rule',
  '  write-a-reviewer-rule  Write a reviewer rule',
  '  adopt-in-an-existing-repository  Bring a law into an existing repository',
  '  agent-setup  Let a coding agent write the first law',
  '  claude-code  Lawcheck in Claude Code',
  '  codex-cli  Lawcheck in Codex',
  '  copilot-cli  Lawcheck in GitHub Copilot CLI',
  '  cursor  Lawcheck in Cursor',
  '  other-agents  Other coding agents',
  '  ci  CI and git hooks',
  '  team  A law shared by a team',
  '  monorepo  A monorepo',
  '  false-alarm  A finding you believe is wrong',
  '  slow-check  A slow check',
  '',
  'Reference',
  '  commands  The commands',
  '  law  The law file',
  '  config  Settings',
  '  script-rules  Script rules',
  '  reviewer-rules  Reviewer rules',
  '  providers  Reviewers and keys',
  '  languages  Languages and uses',
  '  waivers  Waivers',
  '  change  What a check judges',
  '  json  JSON documents',
  '  plugin  The Claude Code plugin',
  '  files  Files Lawcheck reads and writes',
  '',
  'Troubleshooting',
  '  codes  Codes',
  '  questions  Questions',
  '',
  'Project',
  '  changelog  Changelog',
  '  support  Supported environments',
  '  upgrade  Upgrade Lawcheck',
];
const TOPICS = LIST.filter((line) => line.startsWith('  ')).map((line) => ({ id: line.split('  ')[1]!, title: line.split('  ')[2]! }));
const PARAGRAPH = example('change-paragraph');

const IDS = TOPICS.map((t) => t.id);
const terminal = (text: string): string => text.replace(/\[([^\]]+)\]\(([a-z-]+)\.md(?:#[^)]*)?\)/g, (link, label: string, id: string) => (IDS.includes(id) ? `${label} (lawcheck docs ${id})` : link));

function page(id: string): string {
  return readFileSync(new URL(`../../docs/${id}.md`, import.meta.url), 'utf8');
}

// What `lawcheck docs <id>` prints: the page with its links as commands, and the changelog cut as test 1414 holds.
function printed(id: string): string {
  return id === 'changelog' ? fitChangelog(terminal(page(id))) : terminal(page(id));
}

interface Fence {
  info: string;
  lines: string[];
}

function fences(text: string): Fence[] {
  const out: Fence[] = [];
  let open: Fence | null = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('```')) {
      if (open === null) open = { info: line.slice(3).trim(), lines: [] };
      else {
        out.push(open);
        open = null;
      }
    } else if (open !== null) open.lines.push(line);
  }
  assert.equal(open, null, 'a fence is left open');
  return out;
}

function words(line: string): string[] {
  const out: string[] = [];
  const pattern = /'([^']*)'|"([^"]*)"|(\S+)/g;
  for (let match = pattern.exec(line); match !== null; match = pattern.exec(line)) out.push(match[1] ?? match[2] ?? match[3]!);
  return out;
}

// The pages are independent runs of the tool outside git, so a few run at once.
const PAGES_AT_ONCE = 6;

test('test 128: the list of topics, its JSON, and one page, outside git', async () => {
  await inTemp(async (dir) => {
    // Every page is a start of node; with a shared cache of compiled modules the later starts skip compiling.
    fakeWrites(dir, ['compiled/']);
    const env = { NODE_COMPILE_CACHE: join(dir, 'compiled') };
    const [list, json] = await Promise.all([lawcheck(dir, ['docs'], env), lawcheck(dir, ['docs', '--json'], env)]);
    assert.equal(list.stdout, LIST.join('\n') + '\n');
    assert.equal(list.code, 0);
    assert.deepEqual(JSON.parse(json.stdout), { schema: 'lawcheck-docs/0', topics: TOPICS });
    assert.equal(json.code, 0);
    await atOnce(TOPICS, PAGES_AT_ONCE, ({ id }) => id, async ({ id }) => {
      const result = await lawcheck(dir, ['docs', id], env, [], { internal: id === 'codes' });
      assert.equal(result.stdout, printed(id), id);
      assert.equal(result.code, 0);
      if (id === 'law') assert.equal(result.stdout.split('\n')[0], '# The law file');
    });
  });
});

test('test 129: every page holds what section 7 asks, and its examples are real', async () => {
  assert.equal(TOPICS.length, DOC_PAGES);
  for (const { id, title } of TOPICS) {
    const text = page(id);
    assert.equal(text.split('\n')[0], `# ${title}`, id);
    if (id !== 'codes') assert.ok([...printed(id)].length <= 30000, `lawcheck docs ${id} prints ${[...printed(id)].length} characters${id === 'changelog' ? '; its first section is never cut, so that section alone must fit: rewrite it shorter and keep every fact' : ''}`);
    for (const fence of fences(text)) {
      if (fence.info === 'yaml' && fence.lines[0]?.startsWith('lawcheck:')) {
        const read = parseLaw(fence.lines.join('\n'));
        assert.deepEqual(read.problems, [], `${id}: ${fence.lines.join('\n')}`);
      }
      if (fence.info === 'yaml' && (id === 'config' || id === 'providers')) {
        const read = parseConfig(fence.lines.join('\n'));
        assert.ok('config' in read, `${id}: ${fence.lines.join('\n')}`);
      }
      for (const line of fence.lines.filter((l) => l.startsWith('$ lawcheck '))) {
        const argv = words(line.slice('$ lawcheck '.length));
        const read = readArguments(argv);
        assert.ok('arguments' in read, `${id}: ${line}`);
        if (argv[0] === 'check') assert.ok('options' in parseArguments(argv), `${id}: ${line}`);
      }
    }
  }
  const codes = page('codes');
  const rows = codes.split('\n').filter((line) => /^\| `[a-z-]+` \|/.test(line));
  const cells = rows.map((row) => row.split(' | ').map((cell) => cell.replace(/^\| /, '').replace(/ \|$/, '')));
  assert.deepEqual(cells.map((c) => c[0]!.slice(1, -1)).sort(), Object.keys(WHY).sort());
  assert.ok(cells.some((c) => c[0] === '`already-initialized`'));
  for (const c of cells) {
    assert.equal(c.length, 4, c.join(' | '));
    assert.ok(c[1] === 'finding' || c[1] === 'exit 2', c[0]);
    assert.equal(c[3], WHY[c[0]!.slice(1, -1)], c[0]);
  }
  assert.ok(page('change').includes(PARAGRAPH));
  for (const key of ['lawcheck', 'rules', 'types', 'why', 'status', 'context', 'about', 'paths', 'content', 'may_use']) assert.ok(page('law').includes(`\`${key}\``), key);
  for (const key of ['provider', 'model', 'timeout', 'temperature', 'max_chars', 'parallel', 'max_calls']) assert.ok(page('config').includes(`\`${key}\``), key);
  for (const language of ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'c', 'cpp', 'php', 'ruby']) {
    assert.ok(page('languages').includes(`\`${language}\``), language);
  }
  for (const schema of ['lawcheck-init/0', 'lawcheck-prime/0', 'lawcheck-explain/0', 'lawcheck-try/0', 'lawcheck-docs/0', 'lawcheck-doctor/0', 'lawcheck-check/0', 'lawcheck-error/1']) {
    assert.ok(page('json').includes(schema), schema);
  }
});

test('test 130: usage', async () => {
  await inTemp(async (dir) => {
    for (const args of [['docs', 'nope'], ['docs', 'codez'], ['docs', 'law', 'codes'], ['docs', '--all']]) {
      const result = await lawcheck(dir, args);
      assert.match(result.stdout, /^error\[usage\]/m, args.join(' '));
      assert.equal(result.code, 2);
      if (args[1] === 'codez') assert.match(result.stdout, /'codes'/);
    }
  });
});

test('test 416: an unknown topic is usage naming the nearest topic, in text and in JSON, and prints no page', async () => {
  await inTemp(async (dir) => {
    const text = await lawcheck(dir, ['docs', 'lw']);
    assert.equal(text.stdout, "lawcheck: ERROR  1 error\n\nerror[usage]  there is no topic 'lw' (did you mean 'law'?); lawcheck docs lists them\n  why:  the tool does only what its usage line says\n\nnext: run lawcheck docs as its usage line says: lawcheck docs --help\n");
    assert.equal(text.code, 2);
    const json = await lawcheck(dir, ['docs', 'nope', '--json']);
    const document = JSON.parse(json.stdout);
    assert.equal(document.schema, 'lawcheck-error/1');
    assert.deepEqual(document.errors.map((e: { code: string; message: string }) => [e.code, e.message]), [['usage', "there is no topic 'nope'; lawcheck docs lists them"]]);
    assert.equal(json.code, 2);
  });
});

test('test 417: lawcheck docs prints a link to another page as the command that prints it, and --json gives the page as written', async () => {
  await inTemp(async (dir) => {
    const copy = join(dir, 'lawcheck');
    for (const entry of ['package.json', 'dist', 'docs']) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    appendFileSync(join(copy, 'docs', 'law.md'), '\nSee [the codes](codes.md#law-invalid) and [the site](https://example.com/codes.md).\n');
    const cli = join(copy, 'dist', 'cli.js');
    const text = await lawcheckAt(cli, dir, ['docs', 'law']);
    assert.equal(text.stdout, `${terminal(page('law'))}\nSee the codes (lawcheck docs codes) and [the site](https://example.com/codes.md).\n`);
    assert.equal(text.code, 0);
    const json = await lawcheckAt(cli, dir, ['docs', 'law', '--json']);
    assert.equal(JSON.parse(json.stdout).text, `${page('law')}\nSee [the codes](codes.md#law-invalid) and [the site](https://example.com/codes.md).\n`);
  });
});

test('test 1414: lawcheck docs changelog prints a changelog over 30000 characters as Unreleased whole and the newest releases that fit, ends with the line that names the whole changelog and the Next line of the page, and --json gives the page whole', async () => {
  await inTemp(async (dir) => {
    const copy = join(dir, 'lawcheck');
    for (const entry of ['package.json', 'dist', 'docs']) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const entry = (letter: string, count: number): string => `- ${letter.repeat(99)}\n`.repeat(count);
    const head = '# Changelog\n\nLawcheck follows [Semantic Versioning](https://semver.org/).\n\n';
    const unreleased = `## [Unreleased]\n\n### Added\n\n${entry('u', 200)}- The codes are on [their page](codes.md).\n\n`;
    const three = `## [0.3.0] - 2026-01-03\n\n### Fixed\n\n${entry('c', 80)}\n`;
    const two = `## [0.2.0] - 2026-01-02\n\n### Fixed\n\n${entry('b', 80)}\n`;
    const one = `## [0.1.0] - 2026-01-01\n\nThe first release.\n\nNext: [Supported environments](support.md)\n`;
    const written = head + unreleased + three + two + one;
    writeFileSync(join(copy, 'docs', 'changelog.md'), written);
    const cli = join(copy, 'dist', 'cli.js');
    const text = await lawcheckAt(cli, dir, ['docs', 'changelog']);
    const whole = 'The older releases are not printed here. The whole changelog is in `docs/changelog.md` of the installed package and at https://docs.lawcheck.dev/changelog.html.\n\nNext: Supported environments (lawcheck docs support)\n';
    assert.equal(text.stdout, terminal(head + unreleased + three) + whole);
    assert.equal(text.code, 0);
    assert.ok([...written].length > 30000 && [...text.stdout].length <= 30000, `${[...written].length} written, ${[...text.stdout].length} printed`);
    assert.ok([...(head + unreleased + three + two)].length + [...whole].length > 30000, 'the release left out does not fit');
    const json = await lawcheckAt(cli, dir, ['docs', 'changelog', '--json']);
    assert.equal(JSON.parse(json.stdout).text, written);
    writeFileSync(join(copy, 'docs', 'changelog.md'), head + unreleased + one);
    const short = await lawcheckAt(cli, dir, ['docs', 'changelog']);
    assert.equal(short.stdout, terminal(head + unreleased + one));
  });
});

test('commands-slice §7: no page and no spec speaks of moving from another tool', () => {
  const texts = [...TOPICS.map(({ id }) => page(id)), ...['architecture', 'decisions', 'promises'].map((name) => readFileSync(new URL(`../../design/${name}.md`, import.meta.url), 'utf8'))];
  for (const text of texts) assert.doesNotMatch(text, /migrat|moving from|switch(ing)? from/i);
});

test('S5-16: a Lawcheck whose page or topic list is missing says so and sends the user to reinstall it, never ENOENT as an internal fault', async () => {
  await inTemp(async (dir) => {
    const copy = join(dir, 'lawcheck');
    for (const entry of ['package.json', 'dist']) cpSync(join(ROOT, entry), join(copy, entry), { recursive: true });
    symlinkSync(join(ROOT, 'node_modules'), join(copy, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
    const cli = join(copy, 'dist', 'cli.js');
    const noList = await lawcheckAt(cli, dir, ['docs'], {}, { internal: true });
    assert.equal(noList.code, 2);
    assert.equal(noList.stdout.split('\n')[2], 'error[internal]  topics.json is missing from this installation of Lawcheck');
    assert.ok(noList.stdout.endsWith('\nnext: reinstall Lawcheck, then run lawcheck docs again\n'), noList.stdout);
    mkdirSync(join(copy, 'docs'));
    cpSync(join(ROOT, 'docs', 'topics.json'), join(copy, 'docs', 'topics.json'));
    const noPage = await lawcheckAt(cli, dir, ['docs', 'law'], {}, { internal: true });
    assert.equal(noPage.code, 2);
    assert.equal(noPage.stdout.split('\n')[2], 'error[internal]  law.md is missing from this installation of Lawcheck');
    assert.ok(!noPage.stdout.includes('ENOENT'), noPage.stdout);
    const json = JSON.parse((await lawcheckAt(cli, dir, ['docs', 'law', '--json'], {}, { internal: true })).stdout);
    assert.deepEqual(json.next, { command: null, text: 'reinstall Lawcheck, then run lawcheck docs again' });
  });
});

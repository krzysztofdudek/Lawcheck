import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, readFileSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { inTemp, lawcheck, lawcheckAt, ROOT } from './helpers.ts';
import { parseLaw } from '../../dist/law.js';
import { parseConfig } from '../../dist/config.js';
import { readArguments } from '../../dist/args.js';
import { parseArguments } from '../../dist/cli.js';
import { WHY } from '../../dist/output.js';
import { example } from '../harness/examples.ts';

const LIST = [
  'lawcheck docs: 31 topics; lawcheck docs <topic> prints one',
  '',
  'Start',
  '  index  Lawcheck',
  '  install  Install',
  '  quick-start  Quick start',
  '  concepts  Concepts',
  '',
  'Guides',
  '  first-law  The first type and the first rule',
  '  types-for-a-project  Types for an existing project',
  '  forbid-a-use  Forbid one layer to use another',
  '  write-a-script-rule  Write a script rule',
  '  write-a-reviewer-rule  Write a reviewer rule',
  '  adopt-in-an-existing-repository  Bring a law into an existing repository',
  '  claude-code  Lawcheck in Claude Code',
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
  '',
  'Project',
  '  support  Supported environments',
];
const TOPICS = LIST.filter((line) => line.startsWith('  ')).map((line) => ({ id: line.split('  ')[1]!, title: line.split('  ')[2]! }));
const PARAGRAPH = example('change-paragraph');

function page(id: string): string {
  return readFileSync(new URL(`../../docs/${id}.md`, import.meta.url), 'utf8');
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

test('test 128: the list of topics, its JSON, and one page, outside git', async () => {
  await inTemp(async (dir) => {
    const list = await lawcheck(dir, ['docs']);
    assert.equal(list.stdout, LIST.join('\n') + '\n');
    assert.equal(list.code, 0);
    const json = await lawcheck(dir, ['docs', '--json']);
    assert.deepEqual(JSON.parse(json.stdout), { schema: 'lawcheck-docs/0', topics: TOPICS });
    assert.equal(json.code, 0);
    const law = await lawcheck(dir, ['docs', 'law']);
    assert.equal(law.stdout.split('\n')[0], '# The law file');
    assert.equal(law.stdout, page('law'));
    assert.equal(law.code, 0);
    const ids = TOPICS.map((t) => t.id);
    const terminal = (text: string): string => text.replace(/\[([^\]]+)\]\(([a-z-]+)\.md(?:#[^)]*)?\)/g, (link, label: string, id: string) => (ids.includes(id) ? `${label} (lawcheck docs ${id})` : link));
    for (const { id } of TOPICS) {
      const result = await lawcheck(dir, ['docs', id], {}, [], { internal: id === 'codes' });
      assert.equal(result.stdout, terminal(page(id)), id);
      assert.equal(result.code, 0);
    }
  });
});

test('test 129: every page holds what section 7 asks, and its examples are real', async () => {
  assert.equal(TOPICS.length, 31);
  for (const { id, title } of TOPICS) {
    const text = page(id);
    assert.equal(text.split('\n')[0], `# ${title}`, id);
    assert.ok([...text].length <= 30000, `${id} holds ${[...text].length} characters`);
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
    assert.equal(text.stdout, `${page('law')}\nSee the codes (lawcheck docs codes) and [the site](https://example.com/codes.md).\n`);
    assert.equal(text.code, 0);
    const json = await lawcheckAt(cli, dir, ['docs', 'law', '--json']);
    assert.equal(JSON.parse(json.stdout).text, `${page('law')}\nSee [the codes](codes.md#law-invalid) and [the site](https://example.com/codes.md).\n`);
  });
});

test('commands-slice §7: no page and no spec speaks of moving from another tool', () => {
  const texts = [...TOPICS.map(({ id }) => page(id)), ...['architecture', 'decisions', 'promises'].map((name) => readFileSync(new URL(`../../design/${name}.md`, import.meta.url), 'utf8'))];
  for (const text of texts) assert.doesNotMatch(text, /migrat|moving from|switch(ing)? from/i);
});

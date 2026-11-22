import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { inTemp, lawcheck } from './helpers.ts';
import { parseLaw } from '../../dist/law.js';
import { parseConfig } from '../../dist/config.js';
import { readArguments } from '../../dist/args.js';
import { parseArguments } from '../../dist/cli.js';
import { WHY } from '../../dist/output.js';

const spec = readFileSync(new URL('../../spec/commands-slice.md', import.meta.url), 'utf8').split('\n');
const LIST = [
  'lawcheck docs: 14 topics; lawcheck docs <topic> prints one',
  '',
  'first-law  The first type and the first rule',
  'law  The law file',
  'change  What a check judges',
  'commands  The commands',
  'script-rules  Script rules',
  'reviewer-rules  Reviewer rules',
  'waivers  Waivers',
  'config  Settings',
  'providers  Reviewers and keys',
  'languages  Languages and uses',
  'ci  CI and git hooks',
  'plugin  The Claude Code plugin',
  'json  JSON documents',
  'codes  Codes',
];
const TOPICS = LIST.slice(2).map((line) => ({ id: line.split('  ')[0]!, title: line.split('  ')[1]! }));
const PARAGRAPH = spec.find((line) => line.startsWith('> A plain check judges only'))!.slice(2);

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
    for (const { id } of TOPICS) {
      const result = await lawcheck(dir, ['docs', id]);
      assert.equal(result.stdout, page(id), id);
      assert.equal(result.code, 0);
    }
  });
});

test('test 129: every page holds what section 7 asks, and its examples are real', async () => {
  assert.equal(TOPICS.length, 14);
  for (const { id, title } of TOPICS) {
    const text = page(id);
    assert.equal(text.split('\n')[0], `# ${title}`, id);
    assert.ok([...text].length <= 8000, `${id} holds ${[...text].length} characters`);
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

test('commands-slice §7: no page and no spec speaks of moving from another tool', () => {
  const texts = [...TOPICS.map(({ id }) => page(id)), readFileSync(new URL('../../spec/commands-slice.md', import.meta.url), 'utf8')];
  for (const text of texts) assert.doesNotMatch(text, /migrat|moving from|switch(ing)? from/i);
});

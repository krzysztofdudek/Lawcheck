import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, read, setRule, withR, withSample, withU, write } from './helpers.ts';
import { example, exampleText } from '../harness/examples.ts';

const block = (id: string): string[] => example(id).split('\n');

const PRIME_S = exampleText('prime-s');
const FIRST_PART = PRIME_S.split('\n').slice(0, 19).join('\n') + '\n';

function firstPart(reviewers: boolean, mayUse: boolean): string {
  const lines = FIRST_PART.split('\n');
  if (mayUse) lines[0] = lines[0]!.replace('the file types and the rules each type keeps', 'the file types, the rules each type keeps, and which types may use which');
  if (reviewers) lines.splice(lines.indexOf('- A plain check judges only changed files. After you change the law or a rule file, run lawcheck check --full and tell the user how many findings it lists outside your change.'), 0, '- not-reviewed: fix every other finding first, then run lawcheck check --review');
  const at = lines.indexOf('- deleting a rule, or changing its status or its why') + 1;
  const extra = [...(mayUse ? ['- widening may_use', '- adding a pattern to ignored'] : []), ...(reviewers ? ['- lawcheck check --review --again, or --max-calls above reviewer.max_calls'] : [])];
  lines.splice(at, 0, ...extra);
  if (reviewers) lines[lines.length - 2] += '; a reviewer rule pays one call per file, so add --dry-run first';
  return lines.join('\n');
}

const FULL = firstPart(true, true);
const R_PART = block('prime-r-part');
const U_TYPES = block('prime-u-types');
const NO_LAW = 'Lawcheck is installed, and this directory has no law (.lawcheck/law.yaml here or above).\nStart one only when the user asks for a law here, and then follow lawcheck docs agent-setup.\n';
const SHORTENED = 'shortened to fit; lawcheck explain --type <id> shows a type in full, lawcheck explain --rule <id> a rule';
const TEST_17 = [
  'lawcheck: ERROR  1 error',
  '',
  ".lawcheck/law.yaml:8  error[law-invalid]  unknown key 'statuss' in rule 'no-todo' (did you mean 'status'?)",
  '  why:  a misspelled key changes the law without a word',
  '',
  'next: fix .lawcheck/law.yaml, then run lawcheck prime again',
  '',
].join('\n');

const points = (text: string) => [...text].length;

test('test 100: prime in S, its JSON, and from a subdirectory', async () => {
  assert.equal(points(FIRST_PART), 1455);
  assert.equal(points(FULL), 1751);
  assert.equal(FULL.split('\n').length, 24);
  await withSample(async (s) => {
    const run = await lawcheck(s, ['prime']);
    assert.equal(run.stdout, PRIME_S);
    assert.equal(run.code, 0);
    const json = await lawcheck(s, ['prime', '--json']);
    assert.deepEqual(JSON.parse(json.stdout), { schema: 'lawcheck-prime/0', text: PRIME_S, step: 1, characters: 1920 });
    assert.equal(json.code, 0);
    const below = await lawcheck(join(s, 'src/core'), ['prime']);
    assert.equal(below.stdout, PRIME_S);
    assert.equal(below.code, 0);
  });
});

test('test 101: prime in R and in U', async () => {
  await withR(async (r) => {
    const run = await lawcheck(r, ['prime']);
    assert.equal(run.stdout, firstPart(true, false) + '\n' + R_PART.join('\n') + '\n\nMore: lawcheck docs\n');
    assert.equal(run.code, 0);
  });
  await withU(async (u) => {
    const run = await lawcheck(u, ['prime']);
    const lines = (firstPart(false, true) + PRIME_S.slice(FIRST_PART.length)).split('\n');
    lines.splice(lines.indexOf('The law here: 4 types, 2 rules') + 1, 4, ...U_TYPES);
    assert.equal(run.stdout, lines.join('\n'));
    assert.equal(run.code, 0);
  });
});

test('R-151: prime says that git ignores .lawcheck/law.yaml when no commit can carry the law, and says nothing of a law git tracks or does not ignore', async () => {
  const said = 'Git ignores .lawcheck/law.yaml, so no commit carries the law and no other checkout has it; tell the user once, and git check-ignore -v .lawcheck/law.yaml shows the line that ignores it';
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.gitignore': '.lawcheck\n' });
    assert.equal((await lawcheck(repo, ['init'])).code, 0);
    const run = await lawcheck(repo, ['prime']);
    const lines = run.stdout.split('\n');
    assert.equal(lines[lines.indexOf('The law here: 0 types, 0 rules') + 1], said, run.stdout);
    assert.equal(run.code, 0);
    const json = await lawcheck(repo, ['prime', '--json']);
    assert.ok((JSON.parse(json.stdout) as { text: string }).text.includes(`\n${said}\n`), json.stdout);
    write(repo, '.gitignore', '');
    const seen = await lawcheck(repo, ['prime']);
    assert.ok(!seen.stdout.includes('Git ignores'), seen.stdout);
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'law');
    write(repo, '.gitignore', '.lawcheck\n');
    const tracked = await lawcheck(repo, ['prime']);
    assert.ok(!tracked.stdout.includes('Git ignores'), tracked.stdout);
  });
});

test('test 102: prime without a law', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir);
    const run = await lawcheck(repo, ['prime']);
    assert.equal(run.stdout, NO_LAW);
    assert.equal(run.code, 0);
  });
  await inTemp(async (dir) => {
    const run = await lawcheck(dir, ['prime']);
    assert.equal(run.stdout, NO_LAW);
    assert.equal(run.code, 0);
  });
});

test('test 103: a law that cannot be read', async () => {
  await withSample(
    async (s) => {
      const run = await lawcheck(s, ['prime']);
      assert.equal(run.stdout, FULL + '\n' + TEST_17);
      assert.equal(run.code, 2);
      const json = await lawcheck(s, ['prime', '--json']);
      assert.equal(JSON.parse(json.stdout).schema, 'lawcheck-error/1');
      assert.equal(json.code, 2);
    },
    { onMain: (s) => write(s, '.lawcheck/law.yaml', read(s, '.lawcheck/law.yaml').replace('    status: advisory', '    statuss: advisory')) },
  );
  await withSample(
    async (s) => {
      const run = await lawcheck(s, ['prime']);
      const after = run.stdout.slice(FULL.length + 1).split('\n');
      assert.ok(run.stdout.startsWith(FULL + '\n'));
      assert.deepEqual(after.slice(0, 2), ['lawcheck: ERROR  25 errors', '']);
      assert.equal(after.filter((line) => /^\.lawcheck\/law\.yaml:\d+ {2}error\[law-invalid\]/.test(line)).length, 20);
      assert.equal(after.filter((line) => line.startsWith('  why:  ')).length, 1);
      const more = after.indexOf('... and 5 more errors (lawcheck check lists all)');
      assert.equal(more, 23);
      assert.equal(after[more + 1], '');
      assert.match(after[more + 2]!, /^next: /);
      assert.equal(run.code, 2);
    },
    {
      onMain: (s) => {
        const extra = Array.from({ length: 25 }, (_, i) => `  x${String(i + 1).padStart(2, '0')}:\n    why: x\n    statuss: y\n`).join('');
        write(s, '.lawcheck/law.yaml', read(s, '.lawcheck/law.yaml').replace('rules:\n', `rules:\n${extra}`));
      },
    },
  );
  await withSample(
    async (s) => {
      const run = await lawcheck(s, ['prime']);
      assert.equal(run.stdout, PRIME_S);
      assert.equal(run.code, 0);
    },
    { onMain: (s) => setRule(s, 'no-todo', "throw new Error('broken at load');\n") },
  );
});

const pad = (n: number, width: number) => String(n).padStart(width, '0');
const A = 'a'.repeat(200);
const W = 'w'.repeat(200);

function lawFor(dir: string, types: string, rules: string[]): string {
  const repo = newRepository(dir);
  const law = ['lawcheck: 0.1.0', '', 'rules:', ...rules.map((id) => `  ${id}:\n    why: ${W}`), '', 'types:', types].join('\n') + '\n';
  write(repo, '.lawcheck/law.yaml', law);
  for (const id of rules) setRule(repo, id, 'export function check() { return []; }\n');
  return repo;
}

async function primed(repo: string): Promise<{ text: string; step: number; characters: number }> {
  const run = await lawcheck(repo, ['prime', '--json']);
  assert.equal(run.code, 0, run.stdout);
  return JSON.parse(run.stdout);
}

function lawPart(text: string): string[] {
  return text.slice(FIRST_PART.length + 1).split('\n');
}

function common(document: { text: string; step: number; characters: number }, step: number): string[] {
  assert.equal(document.step, step);
  assert.ok(document.characters <= 8000);
  assert.equal(document.characters, points(document.text));
  assert.ok(document.text.startsWith(FIRST_PART));
  const lines = document.text.split('\n');
  assert.equal(lines[lines.length - 2], SHORTENED);
  return lawPart(document.text);
}

function ruleLines(part: string[]): string[] {
  const at = part.indexOf('Rules');
  return part.slice(at + 1, part.indexOf('', at));
}

function typeLines(part: string[]): string[] {
  return part.slice(1, part.indexOf(''));
}

test('test 104: the budget takes the first step that fits', async () => {
  await inTemp(async (dir) => {
    const ids = Array.from({ length: 20 }, (_, i) => pad(i + 1, 2));
    const types = ids.map((n) => `  t${n}:\n    paths: ["src/t${n}/**"]\n    about: ${A}\n    rules: [r${n}]`).join('\n');
    const part = common(await primed(lawFor(dir, types, ids.map((n) => `r${n}`))), 2);
    assert.ok(ruleLines(part).every((line) => line.endsWith('…')));
    assert.ok(typeLines(part).every((line) => line.includes('…  rules: r')));
  });
  await inTemp(async (dir) => {
    const subs = Array.from({ length: 39 }, (_, i) => `      t${pad(i + 1, 2)}:\n        paths: ["src/t${pad(i + 1, 2)}/**"]\n        about: ${A}`).join('\n');
    const types = `  root:\n    paths: ["src/**"]\n    about: Root.\n    types:\n${subs}`;
    const part = common(await primed(lawFor(dir, types, Array.from({ length: 73 }, (_, i) => `r${pad(i + 1, 2)}`))), 3);
    assert.ok(ruleLines(part).every((line) => !line.includes('w')));
  });
  await inTemp(async (dir) => {
    const types = Array.from({ length: 40 }, (_, i) => {
      const n = pad(i + 1, 2);
      const sub = (x: string) => `      t${n}${x}:\n        paths: ["src/t${n}/${x}/**"]\n        about: ${A}`;
      return `  t${n}:\n    paths: ["src/t${n}/**"]\n    about: ${A}\n    types:\n${['a', 'b', 'c'].map(sub).join('\n')}`;
    }).join('\n');
    const part = common(await primed(lawFor(dir, types, Array.from({ length: 150 }, (_, i) => `r${pad(i + 1, 3)}`))), 4);
    const lines = typeLines(part).filter((line) => !line.startsWith('... '));
    assert.ok(lines.length > 0);
    assert.ok(lines.every((line) => line.includes('subtypes: 3') && !line.includes('rules:')));
  });
  await inTemp(async (dir) => {
    const ids = Array.from({ length: 300 }, (_, i) => pad(i + 1, 3));
    const types = ids.map((n) => `  t${n}:\n    paths: ["src/t${n}/**"]\n    about: ${A}`).join('\n');
    const part = common(await primed(lawFor(dir, types, ids.map((n) => `r${n}`))), 4);
    assert.equal(part[0], 'The law here: 300 types, 300 rules');
    assert.deepEqual(ruleLines(part), [ids.map((n) => `r${n}`).join(', ')]);
    assert.ok(part.every((line) => !line.includes('subtypes:') && !line.includes('rules:')));
    const more = part.findIndex((line) => /^\.\.\. and (1 more root type|\d+ more root types)$/.test(line));
    assert.ok(more > 0 && more < part.length - 3);
  });
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, mkdirSync, mkdtempSync, realpathSync, rmSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { belowPart, bytesOf, configErrors, findRoot, isDirectory, isPattern, listedFile, ruleKind, selectTargets, fromCwd, Internal, lawErrors, linked, loadConfig, loadLaw, loadRuleFiles, locate, lawsBelow, nearPart, noGit, notInitialized, onceReader, ruleFileErrors, ruleKinds, Stop, stopped, theChange, CI_VARIABLES, inCI, touchesLaw, typeAll, typingErrors } from '../../dist/setup.js';
import { hide, useKeys } from '../../dist/keys.js';
import { NoGit, GitFailed } from '../../dist/files.js';
import { FULL_NEXT, Unwritable, VerdictsUnreadable } from '../../dist/verdicts.js';
import { TextTooLarge } from '../../dist/limits.js';
import { GIT_ENV, git, inTemp, newRepository, write } from '../acceptance/helpers.ts';
import { platformSkip } from '../harness/tool.ts';
import { parseLaw } from '../../dist/law.js';
import { isBinary } from '../../dist/types.js';

test('commands-slice §2: a path typed from a directory below the root is made relative to the root, and one outside is usage', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-setup-')));
  try {
    mkdirSync(join(dir, 'src/core'), { recursive: true });
    assert.equal(fromCwd(dir, join(dir, 'src/core'), 'price.ts'), 'src/core/price.ts');
    assert.equal(fromCwd(dir, join(dir, 'src'), '..'), '.');
    assert.equal(fromCwd(dir, dir, 'src/'), 'src');
    for (const word of ['../x', '/etc/passwd']) {
      assert.throws(() => fromCwd(dir, dir, word), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'usage');
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('check-slice §2: locate stops with not-initialized without a law', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-setup-'));
  try {
    assert.throws(() => locate(dir), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'not-initialized');
    mkdirSync(join(dir, '.lawcheck'));
    writeFileSync(join(dir, '.lawcheck/law.yaml'), 'lawcheck: 0.1.0\n');
    assert.equal(locate(dir), realpathSync(dir));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('commands-slice §8: the law and the rule files are what a change of the law touches', () => {
  assert.ok(touchesLaw('.lawcheck/law.yaml'));
  assert.ok(touchesLaw('.lawcheck/rules/no-todo.mjs'));
  assert.ok(touchesLaw('.lawcheck/rules/lib/shared.mjs'));
  assert.ok(touchesLaw('.lawcheck/config.yaml'));
  assert.ok(!touchesLaw('.lawcheck/verdicts'));
  assert.ok(!touchesLaw('src/.lawcheck/law.yaml'));
});

test('check-slice §2: the nearest id within two edits', () => {
  assert.equal(nearPart('no-tod', ['no-todo', 'no-console']), " (did you mean 'no-todo'?)");
  assert.equal(nearPart('zzz', ['no-todo']), '');
});

const RULE_LAW = `lawcheck: 0.1.0
rules:
  scr:
    why: x
    context: ["docs/a.md"]
    companion: .lawcheck/rules/lib/c.mjs
  both:
    why: x
  none:
    why: x
  blank:
    why: x
  bin:
    why: x
  gone:
    why: x
    context: ["docs/missing.md", "docs/bad.md", "docs/binary.md", "docs/ok.md", "docs/bad.md"]
    companion: .lawcheck/rules/lib/c.mjs
  c1:
    why: x
    companion: other/c.mjs
  c2:
    why: x
    companion: .lawcheck/rules/lib/c.js
  c3:
    why: x
    companion: .lawcheck/rules/lib/missing.mjs
  c4:
    why: x
    companion: .lawcheck/rules/lib/b.mjs
  c5:
    why: x
    companion: .lawcheck/rules/lib/bad.mjs
  c6:
    why: x
    companion: .lawcheck/rules/lib/ok.mjs
    context: ["docs/ok.md"]
types:
  t:
    paths: ["src/**"]
`;

test('R-43: the files of the rules are sorted into scripts and reviewer rules, and each fault of a rule has its code, place and words', () => {
  const { law } = parseLaw(RULE_LAW);
  const files = ['.lawcheck/rules/scr.mjs', '.lawcheck/rules/both.mjs', '.lawcheck/rules/both.md', '.lawcheck/rules/blank.md', '.lawcheck/rules/bin.md', '.lawcheck/rules/gone.md', '.lawcheck/rules/c1.md', '.lawcheck/rules/c2.md', '.lawcheck/rules/c3.md', '.lawcheck/rules/c4.md', '.lawcheck/rules/c5.md', '.lawcheck/rules/c6.md', '.lawcheck/rules/lib/c.mjs', '.lawcheck/rules/lib/b.mjs', '.lawcheck/rules/lib/bad.mjs', '.lawcheck/rules/lib/ok.mjs', '.lawcheck/rules/stray.mjs', '.lawcheck/rules/notes.txt', 'docs/a.md', 'docs/bad.md', 'docs/binary.md', 'docs/ok.md', 'src/a.ts'];
  const asked: string[] = [];
  const kinds = ruleKinds(law!, files, (path) => {
    asked.push(path);
    if (path.endsWith('bad.md') || path.endsWith('bad.mjs')) throw Object.assign(new Error('denied'), { code: 'EACCES' });
    if (path === '.lawcheck/rules/bin.md' || path === 'docs/binary.md' || path.endsWith('lib/b.mjs')) return Buffer.from([0x61, 0, 0x62]);
    if (path === '.lawcheck/rules/blank.md') return Buffer.from(' \n\t\n');
    return Buffer.from(`text ${path}\n`);
  });
  assert.deepEqual(kinds.errors, [
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 5,
    "message": "the script rule 'scr' takes no 'context'; only a reviewer rule does"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 6,
    "message": "the script rule 'scr' takes no 'companion'; only a reviewer rule does"
  },
  {
    "code": "rule-file-without-entry",
    "file": ".lawcheck/rules/both.md",
    "line": null,
    "message": "the rule 'both' already has its script .lawcheck/rules/both.mjs",
    "next": "keep one of .lawcheck/rules/both.mjs and .lawcheck/rules/both.md, then run lawcheck check"
  },
  {
    "code": "rule-missing-file",
    "file": ".lawcheck/law.yaml",
    "line": 9,
    "message": "the rule 'none' has neither .lawcheck/rules/none.mjs nor .lawcheck/rules/none.md"
  },
  {
    "code": "rule-missing-file",
    "file": ".lawcheck/law.yaml",
    "line": 11,
    "message": "the file .lawcheck/rules/blank.md of the rule 'blank' holds only whitespace"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 13,
    "message": "the file .lawcheck/rules/bin.md of the rule 'bin' is binary"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 17,
    "message": "'context' of rule 'gone' names 'docs/missing.md', which is no file git lists here"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 17,
    "message": "'context' of rule 'gone' names 'docs/binary.md', which is binary"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 21,
    "message": "'companion' of rule 'c1' names 'other/c.mjs', which is no .mjs file in .lawcheck/rules/lib/"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 24,
    "message": "'companion' of rule 'c2' names '.lawcheck/rules/lib/c.js', which is no .mjs file in .lawcheck/rules/lib/"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 27,
    "message": "'companion' of rule 'c3' names '.lawcheck/rules/lib/missing.mjs', which is no file git lists here"
  },
  {
    "code": "law-invalid",
    "file": ".lawcheck/law.yaml",
    "line": 30,
    "message": "'companion' of rule 'c4' names '.lawcheck/rules/lib/b.mjs', which is binary"
  },
  {
    "code": "file-unreadable",
    "file": ".lawcheck/rules/lib/bad.mjs",
    "line": null,
    "message": "the file cannot be read (EACCES)"
  },
  {
    "code": "rule-file-without-entry",
    "file": ".lawcheck/rules/stray.mjs",
    "line": null,
    "message": "the file is no rule of the law and lies outside .lawcheck/rules/lib/"
  },
  {
    "code": "rule-file-without-entry",
    "file": ".lawcheck/rules/notes.txt",
    "line": null,
    "message": "the file is no rule of the law and lies outside .lawcheck/rules/lib/"
  }
]);
  assert.deepEqual(kinds.unreadable, [
  {
    "code": "file-unreadable",
    "file": "docs/bad.md",
    "line": null,
    "message": "the file cannot be read (EACCES)"
  }
]);
  assert.deepEqual([...kinds.scripts], ['scr']);
  assert.deepEqual(Object.fromEntries(kinds.reviewers), {
  "blank": {
    "text": " \n\t\n",
    "context": [],
    "companion": null
  },
  "gone": {
    "text": "text .lawcheck/rules/gone.md\n",
    "context": [
      {
        "path": "docs/ok.md",
        "text": "text docs/ok.md\n"
      }
    ],
    "companion": {
      "path": ".lawcheck/rules/lib/c.mjs",
      "text": "text .lawcheck/rules/lib/c.mjs\n"
    }
  },
  "c1": {
    "text": "text .lawcheck/rules/c1.md\n",
    "context": [],
    "companion": null
  },
  "c2": {
    "text": "text .lawcheck/rules/c2.md\n",
    "context": [],
    "companion": null
  },
  "c3": {
    "text": "text .lawcheck/rules/c3.md\n",
    "context": [],
    "companion": null
  },
  "c4": {
    "text": "text .lawcheck/rules/c4.md\n",
    "context": [],
    "companion": null
  },
  "c5": {
    "text": "text .lawcheck/rules/c5.md\n",
    "context": [],
    "companion": null
  },
  "c6": {
    "text": "text .lawcheck/rules/c6.md\n",
    "context": [
      {
        "path": "docs/ok.md",
        "text": "text docs/ok.md\n"
      }
    ],
    "companion": {
      "path": ".lawcheck/rules/lib/ok.mjs",
      "text": "text .lawcheck/rules/lib/ok.mjs\n"
    }
  }
});
  assert.ok(!asked.includes('.lawcheck/rules/scr.mjs') && !asked.includes('.lawcheck/rules/both.md') && !asked.includes('docs/a.md'));
});

test('R-43: typing the files leaves out what Lawcheck writes, names what could not be read first, and what overlaps only when all could be read', () => {
  const law = parseLaw('lawcheck: 0.1.0\n\ntypes:\n  a:\n    paths: ["**"]\n').law!;
  const overlapping = parseLaw('lawcheck: 0.1.0\n\ntypes:\n  a:\n    paths: ["**"]\n  b:\n    paths: ["src/**"]\n').law!;
  const denied = (code: string) => Object.assign(new Error(code), { code });
  const reads: string[] = [];
  const read = (path: string) => {
    reads.push(path);
    if (path === 'src/bad.ts') throw denied('EACCES');
    return Buffer.from('x\n');
  };
  const files = ['.lawcheck/verdicts', '.lawcheck/.gitattributes', 'src/a.ts', 'src/bad.ts', 'src/z.ts'];
  const extra = [
    { code: 'file-unreadable', file: 'src/bad.ts', line: null, message: 'the extra one of the same file' },
    { code: 'file-unreadable', file: 'src/other.ts', line: null, message: 'the extra one of another file' },
  ];
  const plain = typingErrors('/nowhere', law, files, read);
  assert.deepEqual(reads, ['src/a.ts', 'src/bad.ts', 'src/z.ts']);
  assert.deepEqual(plain.typed.map((f) => f.path), ['src/a.ts', 'src/z.ts']);
  assert.deepEqual(plain.errors, [{ code: 'file-unreadable', file: 'src/bad.ts', line: null, message: 'the file cannot be read (EACCES)' }]);
  const withExtra = typingErrors('/nowhere', law, files, read, extra);
  assert.deepEqual(withExtra.errors.map((e) => [e.file, e.message]), [['src/bad.ts', 'the file cannot be read (EACCES)'], ['src/other.ts', 'the extra one of another file']]);
  const onlyExtra = typingErrors('/nowhere', law, ['src/a.ts'], () => Buffer.from('x\n'), extra);
  assert.deepEqual(onlyExtra.errors, extra);
  assert.deepEqual(onlyExtra.typed.map((f) => f.path), ['src/a.ts']);
  const none = typingErrors('/nowhere', law, ['src/a.ts'], () => Buffer.from('x\n'));
  assert.deepEqual(none.errors, []);
  const overlap = typingErrors('/nowhere', overlapping, ['src/a.ts', 'lib/b.ts'], () => Buffer.from('x\n'));
  assert.deepEqual(overlap.errors.map((e) => [e.code, e.file]), [['type-overlap', 'src/a.ts']]);
  const both = typingErrors('/nowhere', overlapping, ['src/a.ts', 'src/bad.ts'], read);
  assert.deepEqual(both.errors.map((e) => [e.code, e.file]), [['file-unreadable', 'src/bad.ts']]);
  assert.deepEqual(typeAll('/nowhere', law, ['src/a.ts', '.lawcheck/verdicts'], () => Buffer.from('x\n')).map((f) => f.path), ['src/a.ts']);
  assert.throws(() => typeAll('/nowhere', law, ['src/bad.ts'], read), (error: unknown) => error instanceof Stop && error.errors.length === 1 && error.errors[0]!.file === 'src/bad.ts');
  assert.equal(new Stop([]).message, 'stopped');
  assert.equal(new Stop([{ code: 'usage', file: null, line: null, message: 'm' }]).message, 'm');
  assert.throws(() => typeAll('/nowhere', law, ['src/bad.ts'], read, extra), (error: unknown) => error instanceof Stop && error.errors.length === 2 && error.message === 'the file cannot be read (EACCES)');
});

test('R-43: stopped turns each failure of a step into the errors it reports, and lets any other one through', async () => {
  const item = { code: 'usage', file: null, line: null, message: 'm' };
  assert.equal(await stopped(() => 5), 5);
  assert.equal(await stopped(async () => 6), 6);
  assert.deepEqual(await stopped(() => { throw new Stop([item]); }), { errors: [item] });
  assert.deepEqual(await stopped(() => { throw new Stop([item], 3); }), { errors: [item], calls: 3 });
  assert.deepEqual(await stopped(() => { throw new Unwritable('p', 'EACCES'); }), { errors: [{ code: 'file-unwritable', file: 'p', line: null, message: 'cannot be written (EACCES)' }] });
  assert.deepEqual(await stopped(() => { throw new Unwritable('p', 'EACCES', 'make room'); }), { errors: [{ code: 'file-unwritable', file: 'p', line: null, message: 'cannot be written (EACCES)', next: 'make room' }] });
  assert.deepEqual(await stopped(() => { throw new VerdictsUnreadable('EACCES'); }), { errors: [{ code: 'file-unreadable', file: '.lawcheck/verdicts', line: null, message: 'the file cannot be read (EACCES)' }] });
  assert.deepEqual(await stopped(() => { throw new VerdictsUnreadable('it holds more than 16 MiB'); }), {
    errors: [{ code: 'file-unreadable', file: '.lawcheck/verdicts', line: null, message: 'the file cannot be read (it holds more than 16 MiB)', next: FULL_NEXT }],
  });
  assert.deepEqual(await stopped(() => { throw new NoGit('git cannot be started'); }), { errors: [{ code: 'no-git', file: null, line: null, message: 'git cannot be started' }] });
  await assert.rejects(stopped(() => { throw new GitFailed('git status failed'); }), (error: unknown) => error instanceof Internal && error.message === 'git status failed');
  const own = new RangeError('mine');
  await assert.rejects(stopped(async () => { throw own; }), (error: unknown) => error === own);
});

test('R-43: no law is named with the laws below it, as many as three and then a count', async () => {
  assert.equal(belowPart(['a']), '; the laws below it are in a');
  assert.equal(belowPart(['a', 'b', 'c']), '; the laws below it are in a, b, c');
  assert.equal(belowPart(['a', 'b', 'c', 'd']), '; the laws below it are in a, b, c, and 1 more');
  assert.equal(belowPart(['a', 'b', 'c', 'd', 'e', 'f']), '; the laws below it are in a, b, c, and 3 more');
  assert.deepEqual(notInitialized(), { code: 'not-initialized', file: null, line: null, message: 'no .lawcheck/law.yaml in this directory or any above it' });
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { '.lawcheck/law.yaml': 'lawcheck: 0.1.0\n', 'pkg/b/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n', 'pkg/a/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n', 'src/x.ts': 'x\n' });
    assert.deepEqual(lawsBelow(repo), ['pkg/a', 'pkg/b']);
    assert.deepEqual(notInitialized(join(repo, 'src')), { code: 'not-initialized', file: null, line: null, message: 'no .lawcheck/law.yaml in this directory or any above it' });
    const bare = newRepository(join(dir, 'bare'), { 'one/.lawcheck/law.yaml': 'lawcheck: 0.1.0\n' });
    assert.deepEqual(notInitialized(bare), {
      code: 'not-initialized',
      file: null,
      line: null,
      message: 'no .lawcheck/law.yaml in this directory or any above it; the laws below it are in one',
      next: 'cd one, where a law is, then run lawcheck check',
    });
    assert.deepEqual(lawsBelow(join(dir, 'not-a-repository')), []);
  });
});

test('R-43: a path from the root of the law names a file, and the root itself, and nothing outside it', () => {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-setup-')));
  try {
    mkdirSync(join(dir, 'src'));
    const usage = (word: string, message: string) => assert.throws(() => fromCwd(dir, join(dir, 'src'), word), (error: unknown) => error instanceof Stop && error.errors.length === 1 && error.errors[0]!.code === 'usage' && error.errors[0]!.message === message);
    usage('', 'an empty path names no file');
    usage('../..', "the path '../..' lies outside the root of the law");
    usage('../../x', "the path '../../x' lies outside the root of the law");
    assert.throws(() => fromCwd(dir, dir, '..'), (error: unknown) => error instanceof Stop && error.errors[0]!.message === "the path '..' lies outside the root of the law");
    assert.equal(fromCwd(dir, dir, '..hidden/x'), '..hidden/x');
    assert.equal(fromCwd(dir, join(dir, 'src'), '.'), 'src');
    assert.equal(fromCwd(dir, dir, '.'), '.');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('R-43: the root of the law is the nearest folder above that holds something at the place of the law file, so a folder there is a law that cannot be read, not no law', async () => {
  await inTemp(async (dir) => {
    const root = join(dir, 'root');
    write(root, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    mkdirSync(join(root, 'a/b/c'), { recursive: true });
    assert.equal(locate(join(root, 'a/b/c')), realpathSync(root));
    mkdirSync(join(root, 'a/.lawcheck/law.yaml'), { recursive: true });
    assert.equal(locate(join(root, 'a')), realpathSync(join(root, 'a')));
    assert.equal(locate(join(root, 'a/b/c')), realpathSync(join(root, 'a')));
    assert.equal(locate(root), realpathSync(root));
    assert.throws(() => locate(join(dir, 'other')), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'not-initialized');
  });
});

test('R-43: a git that cannot see the work tree is no-git, with the repair git itself asks for when there is one', () => {
  assert.deepEqual(noGit('/x', 'git does not see a work tree here: fatal: not a git repository (or any of the parent directories): .git'), {
    code: 'no-git',
    file: null,
    line: null,
    message: 'git does not see a work tree here: fatal: not a git repository (or any of the parent directories): .git',
  });
  assert.deepEqual(noGit('/x', "git does not see a work tree here: fatal: detected dubious ownership in repository at '/x'"), {
    code: 'no-git',
    file: null,
    line: null,
    message: "git does not see a work tree here: fatal: detected dubious ownership in repository at '/x'",
    next: 'let git trust the repository: git config --global --add safe.directory /x, then run lawcheck check',
    command: 'git config --global --add safe.directory /x',
  });
});

test('R-43: a file read twice is counted once, a binary one stays binary, a failure stays the same failure, and a run reads at most 128 MiB', async () => {
  await inTemp(async (dir) => {
    const MiB = 1024 * 1024;
    const line = `${'x'.repeat(99)}\n`;
    const full = Buffer.concat([Buffer.from(line.repeat(Math.floor((16 * MiB) / 100))), Buffer.alloc((16 * MiB) % 100, 0x79)]);
    assert.equal(full.length, 16 * MiB);
    for (let i = 0; i < 8; i++) write(dir, `f${i}.txt`, full);
    write(dir, 'one.txt', 'x\n');
    write(dir, 'bin.dat', Buffer.from([1, 0, 2]));
    const read = onceReader(dir);
    assert.equal(read('f0.txt').length, 16 * MiB);
    assert.equal(read('f0.txt').length, 16 * MiB);
    assert.equal(isBinary(read('bin.dat')), true);
    assert.equal(isBinary(read('bin.dat')), true);
    for (let i = 1; i < 8; i++) assert.equal(read(`f${i}.txt`).length, 16 * MiB);
    assert.equal(read('f7.txt').length, 16 * MiB);
    let failure: unknown;
    try {
      read('one.txt');
    } catch (error) {
      failure = error;
    }
    assert.ok(failure instanceof TextTooLarge);
    assert.equal(failure.path, 'one.txt');
    assert.equal(failure.bytes, 128 * MiB + 2);
    assert.throws(() => read('one.txt'), (error: unknown) => error === failure);
    assert.throws(() => read('missing.txt'), (error: unknown) => (error as { code?: string }).code === 'ENOENT');
    assert.equal(read('f3.txt').length, 16 * MiB);
  });
});

const LAW_LINES = (count: number) => `lawcheck: 0.1.0\nrules:\n${Array.from({ length: count }, (_, i) => `  r${i}:\n    why: x\n`).join('')}`;

test('R-43: the law that cannot be read, is too large or does not parse is law-invalid or file-too-large, with its line', async () => {
  await inTemp(async (dir) => {
    const root = join(dir, 'root');
    mkdirSync(root);
    const first = lawErrors(root);
    assert.deepEqual(first, { errors: [{ code: 'law-invalid', file: '.lawcheck/law.yaml', line: 1, message: 'the law cannot be read (ENOENT)' }] });
    write(root, '.lawcheck/law.yaml', `lawcheck: 0.1.0\n#${'x'.repeat(1024 * 1024)}\n`);
    assert.deepEqual(lawErrors(root), {
      errors: [{
        code: 'file-too-large',
        file: '.lawcheck/law.yaml',
        line: 1,
        message: 'the law holds 1,048,594 bytes, more than the 1 MiB a law may hold',
        next: 'make .lawcheck/law.yaml hold less than its limits (1 MiB, 10,000 rules and 1,000 types), then run lawcheck check',
      }],
    });
    const exact = `lawcheck: 0.1.0\n#${'x'.repeat(1024 * 1024 - 18)}\n`;
    assert.equal(Buffer.byteLength(exact), 1024 * 1024);
    write(root, '.lawcheck/law.yaml', exact);
    assert.ok('law' in lawErrors(root));
    write(root, '.lawcheck/law.yaml', LAW_LINES(10_001));
    const many = lawErrors(root) as { errors: { code: string; file: string; line: number; message: string; next: string }[] };
    assert.equal(many.errors.length, 1);
    assert.deepEqual([many.errors[0]!.code, many.errors[0]!.file, many.errors[0]!.line, many.errors[0]!.message], ['file-too-large', '.lawcheck/law.yaml', 2, 'the law holds 10,001 rules, more than the 10,000 a law may hold']);
    assert.equal(many.errors[0]!.next, 'make .lawcheck/law.yaml hold less than its limits (1 MiB, 10,000 rules and 1,000 types), then run lawcheck check');
    write(root, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\nbogus: 1\n');
    assert.deepEqual(lawErrors(root), { errors: [{ code: 'law-invalid', file: '.lawcheck/law.yaml', line: 2, message: "unknown key 'bogus' at the top of the law" }] });
    assert.throws(() => loadLaw(root), (error: unknown) => error instanceof Stop && error.errors[0]!.line === 2);
    write(root, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    const ok = lawErrors(root);
    assert.ok('law' in ok && ok.law.types.length === 0);
    assert.equal(loadLaw(root).types.length, 0);
    assert.equal(linked(root, '.lawcheck/law.yaml'), false);
    assert.equal(linked(root, '.lawcheck/missing.yaml'), false);
  });
});

test('R-43: a law that is a link to another file is law-invalid, and its message shows none of the text of that file', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const root = join(dir, 'root');
    mkdirSync(join(root, '.lawcheck'), { recursive: true });
    write(dir, 'elsewhere.yaml', 'lawcheck: 0.1.0\nbogus: 1\n');
    symlinkSync(join(dir, 'elsewhere.yaml'), join(root, '.lawcheck/law.yaml'));
    assert.equal(linked(root, '.lawcheck/law.yaml'), true);
    assert.deepEqual(lawErrors(root), {
      errors: [{ code: 'law-invalid', file: '.lawcheck/law.yaml', line: null, message: '.lawcheck/law.yaml is read through a symbolic link and is not valid; the message of a linked file shows none of its text' }],
    });
  });
});

test('R-43: the config that is too large or does not parse is an error of its own, and a reviewer in it is made so its keys are hidden', async () => {
  await inTemp(async (dir) => {
    const root = join(dir, 'root');
    write(root, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    assert.ok('config' in configErrors(root));
    write(root, '.lawcheck/config.yaml', `#${'x'.repeat(1024 * 1024)}\n`);
    assert.deepEqual(configErrors(root), {
      errors: [{ code: 'file-too-large', file: '.lawcheck/config.yaml', line: null, message: 'the file holds 1,048,578 bytes, more than the 1 MiB the config may hold', next: 'make .lawcheck/config.yaml smaller than 1 MiB, then run lawcheck check' }],
    });
    write(root, '.lawcheck/config.yaml', 'bogus: 1\n');
    assert.deepEqual(configErrors(root), { errors: [{ code: 'config-invalid', file: '.lawcheck/config.yaml', line: 1, message: "unknown key 'bogus' at the top of the config" }] });
    assert.throws(() => loadConfig(root), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'config-invalid');
    write(root, '.lawcheck/config.yaml', 'runner: npx\n');
    assert.equal(loadConfig(root).provider, null);
    useKeys({ OPENAI_API_KEY: 'sk-config-key-123456' });
    assert.equal(hide('see sk-config-key-123456'), 'see sk-config-key-123456');
    write(root, '.lawcheck/config.yaml', 'reviewer:\n  provider: openai\n  model: m\n');
    assert.ok('config' in configErrors(root));
    assert.equal(hide('see sk-config-key-123456'), 'see [key]');
    useKeys({});
  });
});

test('R-43: a config that is a link to another file is config-invalid, and its message shows none of the text of that file', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const root = join(dir, 'root');
    write(root, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    write(dir, 'elsewhere.yaml', 'bogus: 1\n');
    symlinkSync(join(dir, 'elsewhere.yaml'), join(root, '.lawcheck/config.yaml'));
    assert.deepEqual(configErrors(root), {
      errors: [{ code: 'config-invalid', file: '.lawcheck/config.yaml', line: null, message: '.lawcheck/config.yaml is read through a symbolic link and is not valid; the message of a linked file shows none of its text' }],
    });
  });
});

test('R-43: the rule files of a repository are the files git lists, and a rule file that cannot be read is named, with the errors of the law first', async () => {
  const law = (extra: string) => `lawcheck: 0.1.0\nrules:\n  r1:\n    why: x\n${extra}types:\n  t:\n    paths: ["src/**"]\n`;
  await inTemp(async (dir) => {
    const good = newRepository(join(dir, 'good'), { '.lawcheck/law.yaml': law(''), '.lawcheck/rules/r1.mjs': 'export function check() { return []; }\n', 'src/a.ts': 'x\n' });
    const loaded = ruleFileErrors(good, loadLaw(good));
    assert.deepEqual(loaded.errors, []);
    assert.deepEqual([...loaded.kinds.scripts], ['r1']);
    assert.ok(loaded.files.includes('src/a.ts') && loaded.listed.has('src/a.ts'));
    assert.equal(loadRuleFiles(good, loadLaw(good)).files.length, loaded.files.length);
    const missing = newRepository(join(dir, 'missing'), { '.lawcheck/law.yaml': law(''), 'src/a.ts': 'x\n' });
    const absent = ruleFileErrors(missing, loadLaw(missing));
    assert.deepEqual(absent.errors.map((e) => e.code), ['rule-missing-file']);
    assert.throws(() => loadRuleFiles(missing, loadLaw(missing)), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'rule-missing-file');
    assert.throws(() => loadRuleFiles(missing, loadLaw(missing), false), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'rule-missing-file');
    if (platformSkip('an unreadable file') !== null) return;
    const unreadable = newRepository(join(dir, 'unreadable'), { '.lawcheck/law.yaml': law('    context: ["docs/x.md"]\n'), '.lawcheck/rules/r1.md': 'Check.\n', 'src/a.ts': 'x\n', 'docs/x.md': 'x\n' });
    const denied = join(unreadable, 'docs/x.md');
    chmodSync(denied, 0o000);
    try {
      const blocked = ruleFileErrors(unreadable, loadLaw(unreadable));
      assert.deepEqual(blocked.kinds.errors, []);
      assert.deepEqual(blocked.errors.map((e) => [e.code, e.file, e.message]), [['file-unreadable', 'docs/x.md', 'the file cannot be read (EACCES)']]);
      assert.throws(() => loadRuleFiles(unreadable, loadLaw(unreadable)), (error: unknown) => error instanceof Stop && error.errors[0]!.file === 'docs/x.md');
      assert.equal(loadRuleFiles(unreadable, loadLaw(unreadable), false).kinds.unreadable.length, 1);
      const both = newRepository(join(dir, 'both'), { '.lawcheck/law.yaml': law('    context: ["docs/x.md", "docs/none.md"]\n'), '.lawcheck/rules/r1.md': 'Check.\n', 'src/a.ts': 'x\n', 'docs/x.md': 'x\n' });
      chmodSync(join(both, 'docs/x.md'), 0o000);
      assert.deepEqual(ruleFileErrors(both, loadLaw(both)).errors.map((e) => e.code), ['law-invalid']);
      assert.throws(() => loadRuleFiles(both, loadLaw(both), false), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'law-invalid');
      chmodSync(join(both, 'docs/x.md'), 0o644);
    } finally {
      chmodSync(denied, 0o644);
    }
  });
});

test('R-43: the CI services Lawcheck knows are the ones that set a variable, and CI itself says no with any word of no', () => {
  assert.deepEqual(CI_VARIABLES, ['GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION', 'APPVEYOR', 'DRONE', 'CODEBUILD_BUILD_ID', 'BUILD_ID', 'WOODPECKER']);
  assert.equal(inCI({}), false);
  for (const name of CI_VARIABLES) {
    assert.equal(inCI({ [name]: '1' }), true, name);
    assert.equal(inCI({ [name]: 'true' }), true, name);
    for (const off of ['', '0', 'false', 'no', 'off', ' FALSE ', '\tOff\n']) assert.equal(inCI({ [name]: off }), false, `${name}=${JSON.stringify(off)}`);
  }
  for (const on of ['1', 'true', 'yes', 'on', 'anything', ' x ']) assert.equal(inCI({ CI: on }), true, `CI=${on}`);
  for (const off of ['', '0', 'false', 'no', 'off', ' FALSE ', '\tOff\n', ' off']) assert.equal(inCI({ CI: off }), false, `CI=${JSON.stringify(off)}`);
  assert.equal(inCI({ CI: 'false', GITHUB_ACTIONS: 'true' }), false);
  assert.equal(inCI({ CI: '1', GITHUB_ACTIONS: 'false' }), true);
  assert.equal(inCI({ GITHUB_ACTIONS: 'false', JENKINS_URL: 'http://j' }), true);
});

test('R-43: the base of a change comes from --base, then LAWCHECK_BASE, then the variable of the CI service, then origin/HEAD, and each says where it came from', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'a.ts': 'a\n' });
    const sha = git(repo, 'rev-parse', 'HEAD').trim();
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repo, 'update-ref', 'refs/remotes/origin/dev', 'HEAD');
    write(repo, 'b.ts', 'b\n');
    const files = ['README.md', 'a.ts', 'b.ts'];
    const change = (option: string | null, env: NodeJS.ProcessEnv, full = false) => {
      const { base, from, changed } = theChange(repo, files, option, env, full);
      return { base, from, changed: [...changed] };
    };
    assert.deepEqual(change('main', {}), { base: 'main', from: '--base', changed: ['b.ts'] });
    assert.deepEqual(change('main', { LAWCHECK_BASE: 'origin/dev', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'dev' }), { base: 'main', from: '--base', changed: ['b.ts'] });
    assert.deepEqual(change(null, { LAWCHECK_BASE: 'origin/dev', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' }), { base: 'origin/dev', from: 'LAWCHECK_BASE', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' }), { base: 'origin/main', from: 'GITHUB_BASE_REF', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'refs/heads/dev' }), { base: 'origin/dev', from: 'GITHUB_BASE_REF', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: ' dev ' }), { base: 'origin/dev', from: 'GITHUB_BASE_REF', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITLAB_CI: 'true', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: 'dev', CI_COMMIT_BEFORE_SHA: sha }), { base: 'origin/dev', from: 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITLAB_CI: 'true', CI_COMMIT_BEFORE_SHA: sha }), { base: sha, from: 'CI_COMMIT_BEFORE_SHA', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITLAB_CI: 'true', CI_MERGE_REQUEST_TARGET_BRANCH_NAME: '', CI_COMMIT_BEFORE_SHA: sha }), { base: sha, from: 'CI_COMMIT_BEFORE_SHA', changed: ['b.ts'] });
    assert.deepEqual(change(null, { TF_BUILD: 'True', SYSTEM_PULLREQUEST_TARGETBRANCH: 'refs/heads/main' }), { base: 'origin/main', from: 'SYSTEM_PULLREQUEST_TARGETBRANCH', changed: ['b.ts'] });
    assert.deepEqual(change(null, { LAWCHECK_BASE: '', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'dev' }), { base: 'origin/dev', from: 'GITHUB_BASE_REF', changed: ['b.ts'] });
    for (const skipped of [
      { GITHUB_ACTIONS: 'false', GITHUB_BASE_REF: 'dev' },
      { GITHUB_ACTIONS: ' false', GITHUB_BASE_REF: 'dev' },
      { GITHUB_ACTIONS: '', GITHUB_BASE_REF: 'dev' },
      { CI: 'false', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'dev' },
      { CI: ' off ', GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'dev' },
      { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: '' },
      { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: '  ' },
      { GITLAB_CI: 'true', CI_COMMIT_BEFORE_SHA: '0000000000000000000000000000000000000000' },
      { GITLAB_CI: 'true', CI_COMMIT_BEFORE_SHA: '0' },
      { GITHUB_ACTIONS: 'true', GITLAB_CI: 'true', GITLAB_BASE: 'dev' },
      { GITLAB_CI: 'true', GITHUB_BASE_REF: 'dev' },
      { TF_BUILD: 'true', GITHUB_BASE_REF: 'dev' },
    ]) {
      assert.deepEqual(change(null, skipped, true), { base: null, from: null, changed: files }, JSON.stringify(skipped));
    }
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/dev');
    assert.deepEqual(change(null, {}), { base: 'origin/dev', from: 'origin/HEAD', changed: ['b.ts'] });
    assert.deepEqual(change(null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'main' }), { base: 'origin/main', from: 'GITHUB_BASE_REF', changed: ['b.ts'] });
    assert.deepEqual(change('main', {}), { base: 'main', from: '--base', changed: ['b.ts'] });
  });
});

test('R-43: with no base at all, a plain check counts every file, and in a CI job it refuses to, unless it was asked for every file', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { 'a.ts': 'a\n' });
    const files = ['README.md', 'a.ts'];
    const plain = theChange(repo, files, null, {});
    assert.deepEqual([plain.base, plain.from, [...plain.changed]], [null, null, files]);
    const full = theChange(repo, files, null, { CI: 'true' }, true);
    assert.deepEqual([full.base, full.from, [...full.changed]], [null, null, files]);
    const off = theChange(repo, files, null, { CI: 'false', GITHUB_ACTIONS: 'true' });
    assert.deepEqual([off.base, off.from], [null, null]);
    for (const env of [{ CI: 'true' }, { GITLAB_CI: '1' }]) {
      assert.throws(() => theChange(repo, files, null, env), (error: unknown) => {
        assert.ok(error instanceof Stop);
        assert.deepEqual(error.errors, [{
          code: 'base-unreachable',
          file: null,
          line: null,
          message: 'no base in this CI job: no --base, no LAWCHECK_BASE, no variable of the CI service for a pull request or push, and no origin/HEAD, and a check of the change without one would count every file as changed',
          next: 'pass --base origin/<the branch the change goes into> or set LAWCHECK_BASE, with the history fetched (fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines); or judge every file with lawcheck check --full',
        }]);
        return true;
      });
    }
  });
});

const FETCH_ALL = '(fetch-depth: 0 in actions/checkout, GIT_DEPTH: 0 in GitLab CI, fetchDepth: 0 in Azure Pipelines)';

test('R-43: a base that cannot be reached is base-unreachable, with what is wrong with it, where it came from and the fetch that would fix it', async () => {
  await inTemp(async (dir) => {
    const unreachable = (root: string, option: string | null, env: NodeJS.ProcessEnv = {}) => {
      try {
        theChange(root, ['a.ts'], option, env);
      } catch (error) {
        assert.ok(error instanceof Stop);
        return error.errors;
      }
      assert.fail(`the base ${option} was reachable`);
    };
    const one = (message: string, next?: string, command?: string) => [{ code: 'base-unreachable', file: null, line: null, message, ...(next === undefined ? {} : { next }), ...(command === undefined ? {} : { command }) }];
    const empty = join(dir, 'empty');
    execFileSync('git', ['init', '-q', '-b', 'main', empty], { env: GIT_ENV });
    assert.deepEqual(unreachable(empty, 'x'), one("the repository has no commit yet, so the base 'x' cannot be reached"));
    const repo = newRepository(join(dir, 'r'), { 'a.ts': 'a\n' });
    const zeros = "is git's commit of zeros, which a push of a new branch names as the commit before it";
    const fromZeros = 'pass --base with the branch the new one was made from, such as origin/main, then run lawcheck check';
    assert.deepEqual(unreachable(repo, '0'.repeat(40)), one(`the base '${'0'.repeat(40)}' ${zeros}`, fromZeros));
    assert.deepEqual(unreachable(repo, '0'.repeat(64)), one(`the base '${'0'.repeat(64)}' ${zeros}`, fromZeros));
    assert.deepEqual(unreachable(repo, '0'.repeat(41)), one(`the base '${'0'.repeat(41)}' names no commit here`));
    assert.deepEqual(unreachable(repo, 'origin/'), one("the base 'origin/' names no commit here: the branch name after the last / is empty, as when the variable that should hold it is empty", 'pass --base with a branch or a commit that exists here'));
    assert.deepEqual(unreachable(repo, 'nope'), one("the base 'nope' names no commit here"));
    assert.deepEqual(unreachable(repo, null, { LAWCHECK_BASE: 'nope' }), one("the base 'nope' names no commit here"));
    git(repo, 'remote', 'add', 'origin', 'https://example.invalid/x.git');
    assert.deepEqual(unreachable(repo, 'origin/feature'), one("the base 'origin/feature' names no commit here"));
    git(repo, 'config', '--replace-all', 'remote.origin.fetch', '+refs/heads/main:refs/remotes/origin/main');
    assert.deepEqual(
      unreachable(repo, 'origin/feature'),
      one("the base 'origin/feature' names no commit here; this clone did not fetch that branch", `fetch the branch: git fetch origin +refs/heads/feature:refs/remotes/origin/feature ${FETCH_ALL}, then run lawcheck check`, 'git fetch origin +refs/heads/feature:refs/remotes/origin/feature'),
    );
    assert.deepEqual(unreachable(repo, 'origin/fe ature'), one("the base 'origin/fe ature' names no commit here"));
    assert.deepEqual(unreachable(repo, 'originx/feature'), one("the base 'originx/feature' names no commit here"));
    assert.deepEqual(unreachable(repo, 'feature-branch'), one("the base 'feature-branch' names no commit here"));
    assert.deepEqual(
      unreachable(repo, 'origin/x'),
      one("the base 'origin/x' names no commit here; this clone did not fetch that branch", `fetch the branch: git fetch origin +refs/heads/x:refs/remotes/origin/x ${FETCH_ALL}, then run lawcheck check`, 'git fetch origin +refs/heads/x:refs/remotes/origin/x'),
    );
    git(repo, 'update-ref', 'refs/remotes/origin/main', 'HEAD');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/gone');
    assert.deepEqual(
      unreachable(repo, null),
      one("the base 'origin/gone', which origin/HEAD names, names no commit here; this clone did not fetch that branch", `fetch the branch: git fetch origin +refs/heads/gone:refs/remotes/origin/gone ${FETCH_ALL}, then run lawcheck check`, 'git fetch origin +refs/heads/gone:refs/remotes/origin/gone'),
    );
    assert.deepEqual(
      unreachable(repo, null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'gone2' }),
      one("the base 'origin/gone2', which GITHUB_BASE_REF names, names no commit here; this clone did not fetch that branch", `fetch the branch: git fetch origin +refs/heads/gone2:refs/remotes/origin/gone2 ${FETCH_ALL}, then run lawcheck check`, 'git fetch origin +refs/heads/gone2:refs/remotes/origin/gone2'),
    );
    assert.deepEqual(unreachable(repo, null, { GITLAB_CI: 'true', CI_COMMIT_BEFORE_SHA: 'abcdef1' }), one("the base 'abcdef1', which CI_COMMIT_BEFORE_SHA names, names no commit here"));
    git(repo, 'config', '--add', 'remote.origin.fetch', '+refs/heads/*:refs/remotes/origin/*');
    assert.deepEqual(
      unreachable(repo, null),
      one("the base 'origin/gone', which origin/HEAD names, names no commit here", 'pass --base with a branch or a commit that exists here, or point origin/HEAD at one with git remote set-head origin --auto', 'git remote set-head origin --auto'),
    );
    git(repo, 'symbolic-ref', '--delete', 'refs/remotes/origin/HEAD');
    git(repo, 'checkout', '-q', '--orphan', 'orph');
    write(repo, 'o.txt', 'o\n');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'o');
    git(repo, 'checkout', '-q', 'main');
    assert.deepEqual(unreachable(repo, 'orph'), one("the base 'orph' shares no history with HEAD"));
    git(repo, 'update-ref', 'refs/remotes/origin/orph', 'orph');
    git(repo, 'symbolic-ref', 'refs/remotes/origin/HEAD', 'refs/remotes/origin/orph');
    assert.deepEqual(
      unreachable(repo, null),
      one("the base 'origin/orph', which origin/HEAD names, shares no history with HEAD", 'pass --base with a branch or a commit that exists here, or point origin/HEAD at one with git remote set-head origin --auto', 'git remote set-head origin --auto'),
    );
    assert.deepEqual(unreachable(repo, null, { GITHUB_ACTIONS: 'true', GITHUB_BASE_REF: 'orph' }), one("the base 'origin/orph', which GITHUB_BASE_REF names, shares no history with HEAD"));
  });
});

test('R-43: in a shallow clone an unreachable base is named as such, with the fetch of the whole history', async () => {
  await inTemp(async (dir) => {
    const source = newRepository(join(dir, 'source'), { 'a.ts': 'a\n' });
    write(source, 'b.ts', 'b\n');
    git(source, 'add', '-A');
    git(source, 'commit', '-q', '-m', 'b');
    const clone = join(dir, 'clone');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${source}`, clone], { env: GIT_ENV });
    const unreachable = (option: string) => {
      try {
        theChange(clone, ['a.ts'], option, {});
      } catch (error) {
        assert.ok(error instanceof Stop);
        return error.errors;
      }
      return assert.fail(`the base ${option} was reachable`);
    };
    const one = (message: string, next?: string, command?: string) => [{ code: 'base-unreachable', file: null, line: null, message, ...(next === undefined ? {} : { next }), ...(command === undefined ? {} : { command }) }];
    assert.deepEqual(
      unreachable('origin/feature'),
      one("the base 'origin/feature' names no commit here, and this clone is shallow", `fetch the history: git fetch --unshallow origin +refs/heads/feature:refs/remotes/origin/feature ${FETCH_ALL}, then run lawcheck check`, 'git fetch --unshallow origin +refs/heads/feature:refs/remotes/origin/feature'),
    );
    assert.deepEqual(unreachable('feature'), one("the base 'feature' names no commit here, and this clone is shallow", `fetch the history: git fetch --unshallow ${FETCH_ALL}, then run lawcheck check`, 'git fetch --unshallow'));
    assert.deepEqual(unreachable('origin/'), one("the base 'origin/' names no commit here: the branch name after the last / is empty, as when the variable that should hold it is empty", 'pass --base with a branch or a commit that exists here'));
    git(clone, 'checkout', '-q', '--orphan', 'orph');
    write(clone, 'o.txt', 'o\n');
    git(clone, 'add', '-A');
    git(clone, 'commit', '-q', '-m', 'o');
    git(clone, 'checkout', '-q', 'main');
    assert.deepEqual(unreachable('orph'), one("the base 'orph' shares no history with HEAD in this clone, which is shallow", `fetch the history: git fetch --unshallow ${FETCH_ALL}, then run lawcheck check`, 'git fetch --unshallow'));
  });
});

test('R-43: the faults of the rule files come in the order of the rules and of their context', () => {
  const { law } = parseLaw('lawcheck: 0.1.0\nrules:\n  p1:\n    why: x\n    context: ["docs/a.md", "docs/b.md"]\n  p2:\n    why: x\n    context: ["docs/c.md", "docs/d.md"]\ntypes:\n  t:\n    paths: ["src/**"]\n');
  const files = ['.lawcheck/rules/p1.md', '.lawcheck/rules/p2.md', 'docs/a.md', 'docs/b.md', 'docs/c.md', 'docs/d.md'];
  const denied = Object.assign(new Error('denied'), { code: 'EACCES' });
  const both = ruleKinds(law!, files, (path) => {
    if (path.startsWith('.lawcheck/rules/') || path === 'docs/a.md' || path === 'docs/c.md') throw denied;
    return Buffer.from(`text ${path}\n`);
  });
  assert.deepEqual(both.errors.map((e) => e.file), ['.lawcheck/rules/p1.md', '.lawcheck/rules/p2.md']);
  assert.deepEqual(both.unreadable.map((e) => e.file), ['docs/a.md', 'docs/c.md']);
  const read = ruleKinds(law!, files, (path) => Buffer.from(`text ${path}\n`));
  assert.deepEqual(read.errors, []);
  assert.deepEqual(read.reviewers.get('p1')!.context.map((c) => c.path), ['docs/a.md', 'docs/b.md']);
  assert.deepEqual(read.reviewers.get('p2')!.context.map((c) => c.path), ['docs/c.md', 'docs/d.md']);
  const mixed = ruleKinds(law!, files, (path) => {
    if (path === 'docs/b.md' || path === 'docs/c.md' || path === 'docs/d.md') throw denied;
    return Buffer.from(`text ${path}\n`);
  });
  assert.deepEqual(mixed.unreadable.map((e) => e.file), ['docs/b.md', 'docs/c.md', 'docs/d.md']);
  assert.deepEqual(mixed.reviewers.get('p1')!.context.map((c) => c.path), ['docs/a.md']);
});

test('R-43: a law file that this user may not look at is still the law of that folder, so the root is not taken from a folder above it', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await inTemp(async (dir) => {
    const top = join(dir, 'top');
    write(top, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    const inner = join(top, 'inner');
    write(inner, '.lawcheck/law.yaml', 'lawcheck: 0.1.0\n');
    chmodSync(join(inner, '.lawcheck'), 0o000);
    try {
      assert.throws(() => statSync(join(inner, '.lawcheck/law.yaml')), (error: unknown) => (error as NodeJS.ErrnoException).code === 'EACCES');
      assert.equal(findRoot(inner), realpathSync(inner));
      assert.equal(findRoot(top), realpathSync(top));
    } finally {
      chmodSync(join(inner, '.lawcheck'), 0o755);
    }
  });
});

test('R-43: the words of a target are told apart as a pattern, a listed file and a folder, and a rule is a script or a reviewer', async () => {
  assert.equal(isPattern('src/*.ts'), true);
  assert.equal(isPattern('src/a?.ts'), true);
  assert.equal(isPattern('src/{a,b}.ts'), true);
  assert.equal(isPattern('src/a.ts'), false);
  assert.equal(isPattern('src/[a].ts'), false);
  const kinds = ruleKinds(parseLaw('lawcheck: 0.1.0\nrules:\n  s:\n    why: x\n  r:\n    why: x\ntypes:\n  t:\n    paths: ["src/**"]\n').law!, ['.lawcheck/rules/s.mjs', '.lawcheck/rules/r.md'], () => Buffer.from('text\n'));
  assert.equal(ruleKind(kinds, 's'), 'script');
  assert.equal(ruleKind(kinds, 'r'), 'reviewer');
  assert.equal(ruleKind(kinds, 'unknown'), 'reviewer');
  await inTemp(async (dir) => {
    write(dir, 'src/a.ts', 'a\n');
    assert.equal(isDirectory(join(dir, 'src')), true);
    assert.equal(isDirectory(join(dir, 'src/a.ts')), false);
    assert.equal(isDirectory(join(dir, 'missing')), false);
    assert.equal(listedFile(dir, dir, 'src/a.ts', ['src/a.ts']), true);
    assert.equal(listedFile(dir, dir, 'src/b.ts', ['src/a.ts']), false);
    assert.equal(listedFile(dir, join(dir, 'src'), 'a.ts', ['src/a.ts']), true);
    assert.equal(listedFile(dir, dir, '../outside', ['src/a.ts']), false);
    assert.deepEqual([...bytesOf(() => Buffer.from('ab'), 'x')], [97, 98]);
    assert.throws(() => bytesOf(() => { throw Object.assign(new Error('x'), { code: 'EISDIR' }); }, 'src'), (error: unknown) => error instanceof Stop && error.errors[0]!.file === 'src' && error.errors[0]!.message === 'the file cannot be read (EISDIR)');
  });
});

test('R-43: the targets of a command pick the files they name, as a pattern, a file or a folder, in the order of the paths, and say what is wrong with one that picks none', async () => {
  await inTemp(async (dir) => {
    const repo = join(dir, 'repo');
    const files = ['README.md', 'docs/guide.md', 'docs/z.bin', 'docsx/n.md', 'src/a.ts', 'src/b.ts', 'src/core/c.ts', 'src/core/d.bin', 'src/{odd}.ts'];
    for (const path of [...files, 'sub/inner.ts']) write(repo, path, 'x\n');
    mkdirSync(join(repo, 'empty'));
    mkdirSync(join(repo, 'sub/.git'), { recursive: true });
    mkdirSync(join(repo, 'mod'));
    const binary = (path: string) => path.endsWith('.bin');
    const chosen = (targets: string[], cwd = repo, lenient = false, listed = new Set<string>()) => selectTargets(repo, cwd, targets, files, binary, lenient, listed);
    const usage = (targets: string[], message: string, cwd = repo) => assert.throws(() => chosen(targets, cwd), (error: unknown) => error instanceof Stop && error.errors.length === 1 && error.errors[0]!.code === 'usage' && error.errors[0]!.message === message, `${targets}`);
    assert.deepEqual(chosen([]), []);
    assert.deepEqual(chosen(['src/b.ts', 'src/a.ts', 'src/a.ts']), ['src/a.ts', 'src/b.ts']);
    assert.deepEqual(chosen(['src/*.ts']), ['src/a.ts', 'src/b.ts', 'src/{odd}.ts']);
    assert.deepEqual(chosen(['src/{odd}.ts']), ['src/{odd}.ts']);
    assert.deepEqual(chosen(['README.md', '**/c.ts']), ['README.md', 'src/core/c.ts']);
    assert.deepEqual(chosen(['*.ts'], join(repo, 'src')), ['src/a.ts', 'src/b.ts', 'src/{odd}.ts']);
    assert.deepEqual(chosen(['docs']), ['docs/guide.md']);
    assert.deepEqual(chosen(['src/core/', 'docs']), ['docs/guide.md', 'src/core/c.ts']);
    assert.deepEqual(chosen(['.']).filter((path) => path.startsWith('docs/') || path === 'README.md'), ['README.md', 'docs/guide.md']);
    assert.equal(chosen(['.']).includes('docs/z.bin'), false);
    assert.deepEqual(chosen(['..'], join(repo, 'src/core')), chosen(['src']));
    assert.deepEqual(chosen(['../core'], join(repo, 'src/core')), ['src/core/c.ts']);
    assert.deepEqual(chosen(['docs/guide.md', 'nothing*', 'docs/z.bin', 'empty', 'mod', 'sub/inner.ts', 'src/zzz.ts'], repo, true), ['docs/guide.md']);
    assert.throws(() => selectTargets(repo, repo, ['*.nothing'], files, binary), (error: unknown) => error instanceof Stop && error.errors[0]!.message === "the target '*.nothing' matches no file");
    usage(['*.nothing'], "the target '*.nothing' matches no file");
    usage(['a//b*'], "the pattern 'a//b*' holds an empty segment");
    usage(['src/***'], "the pattern 'src/***' holds ** beside other characters in one segment");
    usage(['docs/z.bin'], "the target 'docs/z.bin' selects no file: it is binary");
    usage(['empty'], "the target 'empty' matches no file");
    usage(['src/core/*.bin'], "the target 'src/core/*.bin' matches no file");
    usage(['**/*.bin'], "the target '**/*.bin' matches no file");
    usage(['src/zzz.ts'], "the target 'src/zzz.ts' selects no file: git ignores it or it does not exist");
    usage(['sub/inner.ts'], "the target 'sub/inner.ts' selects no file: it lies in sub, a repository of its own, which Lawcheck does not look into");
    assert.throws(() => chosen(['mod/x.ts'], repo, false, new Set(['mod'])), (error: unknown) => error instanceof Stop && error.errors[0]!.message === "the target 'mod/x.ts' selects no file: it lies in mod, a submodule, which Lawcheck does not look into");
    usage(['../x'], "the path '../x' lies outside the root of the law");
    assert.throws(() => chosen(['src/*.ts', '../x*']), (error: unknown) => error instanceof Stop && error.errors[0]!.code === 'usage');
    usage(['docs/*.md', 'zzz*'], "the target 'zzz*' matches no file");
  });
});

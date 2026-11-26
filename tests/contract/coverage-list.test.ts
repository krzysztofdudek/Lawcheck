import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, posix, win32 } from 'node:path';
import { paint, render, scriptLength, segments, sourceOf, spans, unreachedLines } from '../coverage/list.ts';
import { ROOT } from '../harness/sets.ts';

test('test 1360: the coverage list, the innermost range that holds a character says whether it ran, and what one process ran stays run', () => {
  const ran = new Uint8Array(10);
  const script = { url: 'file:///x/dist/a.js', functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 1 }, { startOffset: 2, endOffset: 6, count: 0 }] }, { ranges: [{ startOffset: 3, endOffset: 5, count: 2 }] }] };
  assert.equal(scriptLength(script), 10);
  paint(script, 10, ran);
  assert.deepEqual([...ran], [1, 1, 0, 1, 1, 0, 1, 1, 1, 1]);
  paint({ url: script.url, functions: [{ ranges: [{ startOffset: 0, endOffset: 10, count: 0 }, { startOffset: 5, endOffset: 6, count: 1 }] }] }, 10, ran);
  assert.deepEqual([...ran], [1, 1, 0, 1, 1, 1, 1, 1, 1, 1]);
});

test('test 1360: the coverage list, a source line is unreached only when nothing built from it ran, and a comment or a line the build drops is no code', () => {
  // Three built lines from source lines 1, 3 and 4 of source 0, and one from line 1 of source 1; AAAA is no move, AACA one source line on, ACAA one source on.
  const built = 'aa;bb\ncc\ndd\nee';
  const all = segments('AAAA,GAAA;AAEA;AACA;ACHA', built);
  assert.deepEqual(all, [{ offset: 0, source: 0, line: 0 }, { offset: 3, source: 0, line: 0 }, { offset: 6, source: 0, line: 2 }, { offset: 9, source: 0, line: 3 }, { offset: 12, source: 1, line: 0 }]);
  const ran = new Uint8Array(built.length);
  ran[3] = 1;
  ran[12] = 1;
  assert.deepEqual(unreachedLines(all, 0, ran), { code: 3, unreached: [3, 4] });
  assert.deepEqual(unreachedLines(all, 0, ran, (line) => line === 4), { code: 2, unreached: [3] });
  assert.deepEqual(unreachedLines(all, 1, ran), { code: 1, unreached: [] });
  assert.throws(() => segments('A!AA', built), /no base64 digit/);
});

test('test 1360: the coverage list, the file names its lines as spans with the first line of each, the files with most first, and says when the tests were red', () => {
  assert.deepEqual(spans([2, 3, 4, 7, 9, 10]), [[2, 4], [7, 7], [9, 10]]);
  const text = render(
    [
      { file: 'src/a.ts', code: 3, loaded: true, unreached: [2], text: ['one', '  if (`x`) two();', 'three'] },
      { file: 'src/b.ts', code: 4, loaded: false, unreached: [1, 2, 4], text: ['import x;', 'y', '', 'z'] },
      { file: 'src/c.ts', code: 2, loaded: true, unreached: [], text: ['a', 'b'] },
    ],
    { ran: 'node tests/run.ts commit', red: true, processes: 7, system: 'linux', unmeasured: { 'src/a.ts': 'Not all of it is counted.' } },
  );
  assert.equal(text, [
    '# The lines of src/ that no test reached',
    '',
    'In 2 of 3 files, 4 of 9 lines of code ran in no process of `node tests/run.ts commit` (7 processes wrote what they ran). This is a list to read, with no threshold: a line here is either dead, or a place where a fault would turn no test red.',
    '',
    'A line counts as reached when any part of it ran, so a branch on one line with its condition does not show. A process that is killed writes nothing, so a line that runs only in a process a test kills is listed. The run was on linux, so a line that only another system runs is listed too.',
    '',
    'The tests of this run ended red, so the list may hold lines that a passing run reaches.',
    '',
    '## src/b.ts: 3 of 4',
    '',
    'No process loaded this file.',
    '',
    '- 1 to 2: `import x;`',
    '- 4: `z`',
    '',
    '## src/a.ts: 1 of 3',
    '',
    'Not all of it is counted.',
    '',
    "- 2: `if ('x') two();`",
    '',
    '## Every line reached',
    '',
    'src/c.ts',
    '',
  ].join('\n'));
});

test('test 1360: the coverage list, the source a map names is the file of src/ wherever the build with maps lies, on another drive of Windows too, and a source outside src/ is none', () => {
  const linux = '/home/runner/work/Lawcheck/Lawcheck/';
  assert.equal(sourceOf('/tmp/lawcheck-coverage-x/maps/providers/index.js', '../../../../home/runner/work/Lawcheck/Lawcheck/src/providers/index.ts', linux, posix), 'src/providers/index.ts');
  assert.equal(sourceOf('/tmp/lawcheck-coverage-x/maps/glob.js', '../../../home/runner/work/Lawcheck/Lawcheck/tests/glob.ts', linux, posix), null);
  const windows = 'D:\\a\\Lawcheck\\Lawcheck\\';
  assert.equal(sourceOf('D:\\a\\_temp\\lawcheck-coverage-x\\maps\\glob.js', '../../../Lawcheck/Lawcheck/src/glob.ts', windows, win32), 'src/glob.ts');
  // The temporary folder of a Windows runner is on C: and the checkout on D:, and with no relative path between drives the compiler names the source by a file URL.
  const temp = 'C:\\Users\\RUNNER~1\\AppData\\Local\\Temp\\lawcheck-coverage-x\\maps\\providers\\index.js';
  assert.equal(sourceOf(temp, 'file:///D:/a/Lawcheck/Lawcheck/src/providers/index.ts', windows, win32), 'src/providers/index.ts');
  assert.equal(sourceOf(temp, 'file:///d:/a/Lawcheck/Lawcheck/src/providers/index.ts', windows, win32), 'src/providers/index.ts');
  assert.equal(sourceOf(temp, 'file:///D:/a/Lawcheck/Lawcheck/tests/glob.ts', windows, win32), null);
});

test('test 1360: the coverage list, a run of a few tests reaches the lines they run, in the build and in the copies of it that tests run, and names the files no process loaded', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-coverage-test-'));
  try {
    const out = join(dir, 'list.md');
    const env = { ...process.env };
    delete env.NODE_TEST_CONTEXT;
    const run = spawnSync(process.execPath, [join(ROOT, 'tests', 'coverage', 'run.ts'), '--out', out, 'loop', 'R-40', 'test 1093'], { cwd: ROOT, env, encoding: 'utf8' });
    assert.equal(run.status, 0, run.stdout + run.stderr);
    const text = readFileSync(out, 'utf8');
    const section = (file: string): string => text.split('\n## ').find((part) => part.startsWith(`${file}: `)) ?? '';
    const counts = (file: string): number[] => (/^\S+: (\d+) of (\d+)\n/.exec(section(file)) ?? []).slice(1).map(Number);
    const [globLeft, globCode] = counts('src/glob.ts');
    assert.ok(globCode! > 100 && globLeft! < globCode! / 4, section('src/glob.ts').slice(0, 300));
    // Test 1093 runs the guard from a copy of the build in a temporary folder, and the guard ends by itself.
    const [guardLeft, guardCode] = counts('src/guard.ts');
    assert.ok(guardCode! > 50 && guardLeft! < guardCode!, section('src/guard.ts').slice(0, 300));
    assert.ok(!section('src/guard.ts').includes('No process loaded this file.'));
    assert.ok(section('src/explain.ts').includes('\nNo process loaded this file.\n'), section('src/explain.ts').slice(0, 300));
    assert.ok(section('src/runner.ts').includes('This file runs in the rule runner'), section('src/runner.ts').slice(0, 300));
    assert.match(run.stdout, /^In \d+ of \d+ files, \d+ of \d+ lines of code ran in no process of `node tests\/run\.ts loop R-40 test 1093` \(\d+ processes wrote what they ran\)\./);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

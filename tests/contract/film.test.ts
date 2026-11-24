import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_ENV } from '../acceptance/helpers.ts';
import { ROOT, startProgram, testFolder } from '../harness/tool.ts';
import { judge } from '../../film/accept.mjs';
import { fingerprint } from '../../film/pilot.mjs';
import { trimRecord, trimTranscript } from '../../film/trim.mjs';
import { decodeTerminal, privateProblems, readingProblems, stalenessProblems, truthProblems, versionProblems } from '../../film/check.mjs';
import { vttOf } from '../../film/build.mjs';
import { readEdit, wrap, words } from '../../film/edit.mjs';

const clone = <T>(value: T): T => JSON.parse(JSON.stringify(value)) as T;

function copyOfFilm(): { dir: string; remove(): void } {
  const folder = testFolder('lawcheck-film-');
  for (const path of ['film/edit.json', 'film/pilot.json', 'film/takes', 'film/fixture', 'README.md', 'docs']) cpSync(join(ROOT, path), join(folder.dir, path), { recursive: true });
  return folder;
}

test('test 820: every string the film puts on screen comes from its take, its run of Lawcheck or its page, the takes are the records film/pilot.json counts, every screen stands long enough to be read, and no take holds a private string', () => {
  const edit = readEdit(ROOT);
  const truth = truthProblems(ROOT, edit);
  assert.deepEqual(truth.problems, []);
  assert.ok(truth.strings >= 30, `${truth.strings} strings`);
  assert.deepEqual(readingProblems(edit), []);
  assert.deepEqual(privateProblems(ROOT), []);
  assert.equal(judge(join(ROOT, 'film', 'takes', edit.takes.without)).accepted, true);
  assert.equal(judge(join(ROOT, 'film', 'takes', edit.takes.with)).accepted, true);
});

test('test 820: node film/check.mjs runs this build of Lawcheck on the files of the takes and finds the output the film shows', async () => {
  const run = await startProgram(join(ROOT, 'film', 'check.mjs'), [], ROOT, GIT_ENV).ended;
  assert.equal(run.code, 0, run.stdout);
  assert.ok(run.stdout.includes(`staleness: ${Object.keys(readEdit(ROOT).runs).length} runs of this build print what the film shows\n`), run.stdout);
  assert.ok(run.stdout.endsWith('film/check.mjs: PASS\n'), run.stdout);
});

test('test 820: control, a changed word, a wrong line, a color the terminal did not print, a count that is not the pilot\'s, a changed record and an output the run does not hold are each caught', () => {
  const folder = copyOfFilm();
  try {
    const edit = readEdit(folder.dir);
    assert.deepEqual(truthProblems(folder.dir, edit).problems, []);
    const broken = clone(edit);
    const [l1, l2, l3] = broken.loop;
    l1.screens[0].blocks[0].lines[0].text = '+import { formatMoney } from "../core/format.ts";';
    l1.screens[0].blocks[1].lines[1].color = 'green';
    l2.screens[0].blocks[0].lines[0].from.line = 8;
    l3.screens[0].blocks[0].lines[2].text = 'src/core/price.ts:2  error[forbidden-use]';
    assert.deepEqual(truthProblems(folder.dir, broken).problems, [
      'l1, screen 1: "+import { formatMoney } from \\"../core/format.ts\\";" is not in film/takes/a09/change.diff',
      'l1, screen 1: "ℹ pass 10" is shown green, and film/takes/a09/terminal.jsonl printed it blue',
      'l2, screen 1: "  core:" is not line 8 of film/takes/b04/law.yaml',
      'l3, screen 1: "src/core/price.ts:2  error[forbidden-use]" is not in film/takes/a09-check/output.txt',
    ]);
    const now = clone(edit);
    now.loop[3].screens[0].blocks[0].lines[0].now = 'b04-prime';
    assert.deepEqual(truthProblems(folder.dir, now).problems.map((problem) => problem.split(':')[0]), ['l4, screen 1']);
    writeFileSync(join(folder.dir, 'film/takes/a09/files/src/core/price.ts'), 'export {};\n');
    assert.deepEqual(truthProblems(folder.dir, edit).problems.slice(0, 2), [
      'film/takes/a09 is not the record that film/pilot.json counts: its hash differs',
      'the take a09 is refused by film/accept.mjs: no file of src/core imports from src/api',
    ]);
  } finally {
    folder.remove();
  }
});

test('test 820: control, a run whose output or exit changed is named with its first changed line, and a run with no record asks for --write', () => {
  const folder = copyOfFilm();
  try {
    const edit = readEdit(folder.dir);
    const output = (id: string) => readFileSync(join(folder.dir, 'film', 'takes', id, 'output.txt'), 'utf8');
    const exit = (id: string) => (JSON.parse(readFileSync(join(folder.dir, 'film', 'takes', id, 'run.json'), 'utf8')) as { exit: number }).exit;
    const same = (id: string) => ({ exit: exit(id), output: output(id), error: '' });
    assert.deepEqual(stalenessProblems(folder.dir, edit, same), []);
    const changed = (id: string) => (id === 'a09-check' ? { exit: 1, output: output(id).replace('  why:', '  because:'), error: '' } : same(id));
    assert.deepEqual(stalenessProblems(folder.dir, edit, changed), [
      'the film shows output this build no longer prints: run a09-check (lawcheck check) exits 1, the film\'s record 1; line 4 was "  why:  a type\'s may_use names every type its files may use" and is now "  because:  a type\'s may_use names every type its files may use". node film/check.mjs --write records the new output, and film/README.md says what follows',
    ]);
    const passing = (id: string) => (id === 'b04-check' ? { ...same(id), exit: 1 } : same(id));
    assert.deepEqual(stalenessProblems(folder.dir, edit, passing), ['the film shows output this build no longer prints: run b04-check (lawcheck check --base origin/main) exits 1, the film\'s record 0. node film/check.mjs --write records the new output, and film/README.md says what follows']);
    const more = clone(edit);
    more.runs['b04-explain'] = { law: 'film/fixture/law/law.yaml', args: ['explain', 'src/core/price.ts'] };
    assert.deepEqual(stalenessProblems(folder.dir, more, (id: string) => (id === 'b04-explain' ? { exit: 0, output: '', error: '' } : same(id))), ['run b04-explain has no recorded output in film/takes/b04-explain; node film/check.mjs --write records it']);
  } finally {
    folder.remove();
  }
});

test('test 820: control, a screen too short for its new words, a screen with too many words, a loop past 30 seconds and a chapter shorter than 40 seconds are each caught, and a long line wraps at a gap of its columns', () => {
  const edit = readEdit(ROOT);
  const short = clone(edit);
  short.loop[0].end = 5;
  short.loop[1].start = 5;
  assert.deepEqual(readingProblems(short), ['l1-1: 19 new words need 7.33 s on screen, and it stands 5.00 s']);
  const long = clone(edit);
  long.loop[4].end = 31;
  assert.deepEqual(readingProblems(long), ['the loop lasts 31 s, outside 15 to 30 s']);
  const crowded = clone(edit);
  const lines = crowded.loop[2].screens[0].blocks[0].lines;
  for (let i = 0; i < 3; i++) lines.push({ text: '  why:  a type\'s may_use names every type its files may use', from: { run: 'a09-check' } });
  assert.ok(readingProblems(crowded).some((problem) => /^l3-1: \d+ words on screen at once, over 45$/.test(problem)), readingProblems(crowded).join('\n'));
  const brief = clone(edit);
  brief.chapters = [{ page: 'quick-start', take: 'x', record: 'x', timeline: [{ id: 'x1', start: 0, end: 30, screens: [{ at: 0, blocks: [] }] }] }];
  assert.deepEqual(readingProblems(brief), ['the chapter quick-start lasts 30 s, outside 40 to 60 s']);
  assert.deepEqual(words('src/core/price.ts:1  error[forbidden-use]'), ['src', 'core', 'price', 'ts', '1', 'error', 'forbidden', 'use']);
  assert.deepEqual(words('$ ℹ pass 10 couldn\'t'), ['pass', '10', 'couldn\'t']);
  assert.deepEqual(wrap('src/core/price.ts:1  error[forbidden-use]  core may not use api (src/api/format.ts); its may_use is [core]', 48), ['src/core/price.ts:1  error[forbidden-use]', 'core may not use api (src/api/format.ts); its', 'may_use is [core]']);
  assert.deepEqual(wrap('lawcheck: FAIL  1 error in 2 changed files (against origin/main)', 48), ['lawcheck: FAIL  1 error in 2 changed files', '(against origin/main)']);
  assert.deepEqual(wrap(`$ ${'x'.repeat(50)}`, 48), [`$ ${'x'.repeat(46)}`, 'xxxx']);
});

test('test 820: control, a home folder, a key, an e-mail address and each name of the recording machine in a take are caught, and the terminal decoder keeps the colors and drops what a spinner overwrote', () => {
  const folder = copyOfFilm();
  try {
    mkdirSync(join(folder.dir, 'film/takes/x'));
    writeFileSync(join(folder.dir, 'film/takes/x/notes.txt'), 'cwd /home/someone/shop and /home/dev/runs/x/home/.claude\nkey sk-ant-api03-abcdefgh\nmail someone@example.org and dev@example.com\n');
    writeFileSync(join(folder.dir, 'film/takes/x/host.txt'), 'Linux 7.2.12-OrbStack-1\nhttps://box.example-tail.ts.net:443/\non the tailnet\n~/ClientBox/x and /mnt/mac/Users\n/home/me/repos\nthe host shop-name-7\n');
    assert.deepEqual(privateProblems(folder.dir, ['shop-name-7']), [
      'film/takes/x/host.txt holds a home folder other than /home/dev: /home/me',
      'film/takes/x/host.txt holds the name of the virtual machine that recorded it: OrbStack',
      'film/takes/x/host.txt holds a host name of a tailnet: box.example-tail.ts.net',
      'film/takes/x/host.txt holds the word tailnet: tailnet',
      'film/takes/x/host.txt holds the name of the folder shared with the owner\'s computer: ClientBox',
      'film/takes/x/host.txt holds a path of the owner\'s computer: /mnt/mac',
      'film/takes/x/host.txt holds a name listed in LAWCHECK_FILM_PRIVATE: shop-name-7',
      'film/takes/x/notes.txt holds a home folder other than /home/dev: /home/someone',
      'film/takes/x/notes.txt holds an Anthropic key: sk-ant-api03-abcdefgh',
      'film/takes/x/notes.txt holds an e-mail address: someone@example.org',
    ]);
  } finally {
    folder.remove();
  }
  const lines = decodeTerminal(`${JSON.stringify({ columns: 88 })}\n${JSON.stringify([0.1, '\u001b[34mℹ pass 10\u001b[39m\r\n⠙\rshop $ \u001b]0;title\u0007ok\r\n'])}\n`);
  assert.deepEqual(lines.map((line) => line.text), ['ℹ pass 10', 'shop $ ok', '']);
  assert.deepEqual([...new Set(lines[0]!.colors)], ['blue']);
  assert.deepEqual([...new Set(lines[1]!.colors)], [null]);
});

test('test 820: control, each reason film/accept.mjs refuses a take for is caught on its own: an import of src/api into src/core, no text from the plugin at the start, no sentence on the law and the import, a waiver, a changed law, a failing check, failing tests, an unfinished turn, and a file outside src and tests', () => {
  const folder = copyOfFilm();
  try {
    let copies = 0;
    const take = (id: string, change: (dir: string) => void): string[] => {
      const dir = join(folder.dir, `${id}-copy-${++copies}`);
      cpSync(join(folder.dir, 'film', 'takes', id), dir, { recursive: true });
      change(dir);
      return judge(dir).reasons;
    };
    const transcript = (dir: string) => join(dir, 'transcript.jsonl');
    const json = (dir: string, edit: (value: { changed: string[]; complete: boolean; tests: { exit: number; fail: number }; check: { exit: number } }) => void) => {
      const value = JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8'));
      edit(value);
      writeFileSync(join(dir, 'take.json'), JSON.stringify(value));
    };
    assert.deepEqual(take('b04', () => {}), []);
    assert.deepEqual(take('b04', (dir) => writeFileSync(join(dir, 'files/src/core/rate.ts'), 'import { formatMoney } from "../api/format.ts";\n')), ['a file of src/core imports from src/api: src/core/rate.ts:1']);
    assert.deepEqual(take('b04', (dir) => writeFileSync(transcript(dir), readFileSync(transcript(dir), 'utf8').split('\n').filter((line) => !line.includes('"hook_additional_context"')).join('\n'))), ['the transcript holds no text that the plugin gave the agent when the session started']);
    assert.deepEqual(take('b04', (dir) => appendFileSync(transcript(dir), `${JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'Done. The tests pass.' }] } })}\n`)), ['the last message of the agent holds no sentence that names the law and the import']);
    assert.deepEqual(take('b04', (dir) => appendFileSync(join(dir, 'files/src/core/money.ts'), '// lawcheck-waive core-uses -- a test\n')), ['a waiver was added: src/core/money.ts']);
    assert.deepEqual(take('b04', (dir) => json(dir, (value) => value.changed.push('.lawcheck/law.yaml'))), ['the law changed']);
    assert.deepEqual(take('b04', (dir) => json(dir, (value) => (value.check.exit = 1))), ['the last lawcheck check does not exit 0']);
    assert.deepEqual(take('a09', () => {}), []);
    assert.deepEqual(take('a09', (dir) => json(dir, (value) => (value.tests.fail = 1))), ['the tests fail']);
    assert.deepEqual(take('a09', (dir) => json(dir, (value) => (value.tests.exit = 1))), ['the tests fail']);
    assert.deepEqual(take('a09', (dir) => json(dir, (value) => (value.complete = false))), ['the turn did not end in time']);
    assert.deepEqual(take('a09', (dir) => json(dir, (value) => value.changed.push('package.json'))), ['a file outside src/ and tests/ changed: package.json']);
  } finally {
    folder.remove();
  }
});

test('test 820: control, a version, a version after @ and the name of a model on a screen, in a caption or in a subtitle are each caught, and a chapter\'s subtitles become one cue per segment', () => {
  const edit = readEdit(ROOT);
  assert.deepEqual(versionProblems(edit), []);
  const other = clone(edit);
  other.loop[0].caption = 'Claude Code 2.1.330, Sonnet at medium';
  other.loop[1].subtitle = 'The law of lawcheck 0.1.0.';
  other.loop[4].screens[0].blocks[0].lines[0].text = 'uses: actions/checkout@v4';
  assert.deepEqual(versionProblems(other), [
    'l1-1: "Claude Code 2.1.330, Sonnet at medium" shows a number with a point, as a version has: 2.1',
    'l1-1: "Claude Code 2.1.330, Sonnet at medium" shows the name of a model: Sonnet',
    'l2-1: "The law of lawcheck 0.1.0." shows a number with a point, as a version has: 0.1',
    'l5-1: "uses: actions/checkout@v4" shows a version after @: @v4',
    'l5-1: "uses: actions/checkout@v4" shows a version as v and a number: v4',
  ]);
  assert.equal(vttOf([{ start: 0, end: 4.5, subtitle: 'One.' }, { start: 4.5, end: 6 }, { start: 6, end: 61.25, subtitle: 'Two.' }]), 'WEBVTT\n\n00:00:00.000 --> 00:00:04.500\nOne.\n\n00:00:06.000 --> 00:01:01.250\nTwo.\n');
});

test('test 820: a transcript keeps the session and turns every other line into its kind and SHA-256, the same twice over, and a record hashes the same full and trimmed', () => {
  const folder = testFolder('lawcheck-film-');
  try {
    const lines = [
      { type: 'user', message: { content: 'Add a discount.' } },
      { type: 'attachment', attachment: { type: 'environment', snapshot: { osVersion: 'Linux 7-orbstack' } } },
      { type: 'attachment', attachment: { type: 'hook_additional_context', content: ['Lawcheck checks this repository'] } },
      { type: 'api-request-shape', system: 'You are an agent' },
      { type: 'assistant', message: { content: [{ type: 'text', text: 'Done.' }] } },
      { type: 'system', subtype: 'stop_hook_summary' },
    ].map((line) => JSON.stringify(line));
    const trimmed = trimTranscript(`${lines.join('\n')}\n`).split('\n');
    assert.deepEqual([trimmed[0], trimmed[2], trimmed[4], trimmed[5], trimmed[6]], [lines[0], lines[2], lines[4], lines[5], '']);
    assert.deepEqual(JSON.parse(trimmed[1]!), { trimmed: 'attachment/environment', sha256: createHash('sha256').update(lines[1]!).digest('hex') });
    assert.deepEqual(JSON.parse(trimmed[3]!), { trimmed: 'api-request-shape', sha256: createHash('sha256').update(lines[3]!).digest('hex') });
    assert.equal(trimTranscript(trimmed.join('\n')), trimmed.join('\n'));
    const full = join(folder.dir, 'full');
    mkdirSync(join(full, 'files'), { recursive: true });
    writeFileSync(join(full, 'take.json'), '{}');
    writeFileSync(join(full, 'transcript.jsonl'), `${lines.join('\n')}\n`);
    writeFileSync(join(full, 'files', 'transcript.jsonl'), 'a file of the session is kept whole\n');
    trimRecord(full, join(folder.dir, 'trimmed'));
    assert.equal(fingerprint(join(folder.dir, 'trimmed')), fingerprint(full));
    assert.equal(readFileSync(join(folder.dir, 'trimmed', 'files', 'transcript.jsonl'), 'utf8'), 'a file of the session is kept whole\n');
    assert.ok(!readFileSync(join(folder.dir, 'trimmed', 'transcript.jsonl'), 'utf8').includes('orbstack'));
  } finally {
    folder.remove();
  }
});

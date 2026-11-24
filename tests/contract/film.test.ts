import { test } from 'node:test';
import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { appendFileSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { GIT_ENV } from '../acceptance/helpers.ts';
import { ROOT, startProgram, testFolder } from '../harness/tool.ts';
import { judge, judgeChapter } from '../../film/accept.mjs';
import { fingerprint } from '../../film/pilot.mjs';
import { trimRecord, trimTranscript } from '../../film/trim.mjs';
import { decodeTerminal, narrationProblems, privateProblems, privateSummary, privateWords, readingProblems, stalenessProblems, truthProblems, versionProblems } from '../../film/check.mjs';
import { build, vttOf } from '../../film/build.mjs';
import { readEdit, wrap, words } from '../../film/edit.mjs';
import { joinWav, voiceKey, voiceProblems, wavSeconds } from '../../film/voice.mjs';

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
  const run = await startProgram(join(ROOT, 'film', 'check.mjs'), [], ROOT, { ...GIT_ENV, LAWCHECK_FILM_PRIVATE: ' , ' }).ended;
  assert.equal(run.code, 0, run.stdout);
  assert.ok(run.stdout.includes('private: no file of film/takes holds a home folder, a key, a token, an e-mail address, orbstack, a ts.net host, the word tailnet, clientbox or /mnt/mac; LAWCHECK_FILM_PRIVATE is empty, so the names only the recording machine knows were not looked for\n'), run.stdout);
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
    assert.deepEqual(privateWords(' shop-name-7 ,, other '), ['shop-name-7', 'other']);
    assert.ok(privateSummary([]).endsWith('; LAWCHECK_FILM_PRIVATE is empty, so the names only the recording machine knows were not looked for'));
    assert.ok(privateSummary(['shop-name-7']).endsWith(' or a name listed in LAWCHECK_FILM_PRIVATE'));
    assert.doesNotMatch(privateSummary(['shop-name-7']), /shop-name-7|not looked for/);
    assert.deepEqual(privateProblems(folder.dir, ['shop-name-7']), [
      'film/takes/x/host.txt holds a home folder other than /home/dev: /home/me',
      'film/takes/x/host.txt holds the word orbstack: OrbStack',
      'film/takes/x/host.txt holds a host name under ts.net: box.example-tail.ts.net',
      'film/takes/x/host.txt holds the word tailnet: tailnet',
      'film/takes/x/host.txt holds the word clientbox: ClientBox',
      'film/takes/x/host.txt holds a path under /mnt/mac: /mnt/mac',
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

test('test 820: control, each chapter\'s take is accepted, and a take is refused for a file of the first chapter that is not its page\'s block, a check of the first chapter that does not fail, a rule that reads no syntax tree, a changed file of src, a review with no recorded pass, settings that name a key, a workflow that is not the page\'s, and a network that was on', () => {
  const folder = copyOfFilm();
  try {
    let copies = 0;
    const take = (id: string, change: (dir: string) => void): string[] => {
      const dir = join(folder.dir, `${id}-copy-${++copies}`);
      cpSync(join(folder.dir, 'film', 'takes', id), dir, { recursive: true });
      change(dir);
      return judgeChapter(dir).reasons;
    };
    const json = (dir: string, edit: (value: { changed: string[]; commands: { command: string; exit: number }[]; offline: { network: string } }) => void) => {
      const value = JSON.parse(readFileSync(join(dir, 'take.json'), 'utf8'));
      edit(value);
      writeFileSync(join(dir, 'take.json'), JSON.stringify(value));
    };
    const edit = readEdit(folder.dir);
    const takeOf = (page: string) => edit.chapters.find((chapter: { page: string }) => chapter.page === page).take;
    for (const chapter of edit.chapters) assert.deepEqual(take(chapter.take, () => {}), [], chapter.page);
    assert.deepEqual(take(takeOf('quick-start'), (dir) => appendFileSync(join(dir, 'files/.lawcheck/law.yaml'), '    rules: [no-fetch]\n')), ['.lawcheck/law.yaml is not the block of docs/quick-start.md']);
    assert.deepEqual(take(takeOf('quick-start'), (dir) => json(dir, (value) => value.commands.filter((mark) => mark.command === 'lawcheck check').forEach((mark) => (mark.exit = 0)))), ['lawcheck check does not fail with one forbidden-use at src/core/receipt.ts:1']);
    assert.deepEqual(take(takeOf('write-a-script-rule'), (dir) => writeFileSync(join(dir, 'files/.lawcheck/rules/no-fetch.mjs'), 'export function check() {\n  return [];\n}\n')), ['the rule does not ask for the syntax tree']);
    assert.deepEqual(take(takeOf('write-a-script-rule'), (dir) => json(dir, (value) => value.changed.push('src/core/cart.ts'))), ['the session changed src/core/cart.ts']);
    assert.deepEqual(take(takeOf('write-a-reviewer-rule'), (dir) => json(dir, (value) => (value.changed = value.changed.filter((path) => path !== '.lawcheck/verdicts')))), ['no pass was written to .lawcheck/verdicts']);
    assert.deepEqual(take(takeOf('write-a-reviewer-rule'), (dir) => writeFileSync(join(dir, 'files/.lawcheck/config.yaml'), 'reviewer:\n  provider: anthropic\n')), ['the session changed .lawcheck/config.yaml', 'the settings do not name claude-code alone, with no key']);
    assert.deepEqual(take(takeOf('ci'), (dir) => appendFileSync(join(dir, 'files/.github/workflows/lawcheck.yml'), '# changed\n')), ['.github/workflows/lawcheck.yml is not the block ci-workflow of docs/ci.md']);
    assert.deepEqual(take(takeOf('ci'), (dir) => json(dir, (value) => (value.offline.network = 'on'))), ['the network was on']);
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

test('test 1058: every narrated sentence of a chapter ends as a spoken sentence, spells its numbers and cites what its frame or its page shows, and the version scan reads the narration', () => {
  const edit = readEdit(ROOT);
  const narration = narrationProblems(ROOT, edit);
  assert.deepEqual(narration.problems, []);
  assert.ok(narration.sentences >= 60, `${narration.sentences} sentences`);
  assert.deepEqual(versionProblems(edit), []);
  const other = clone(edit);
  const quick = other.chapters[0].timeline;
  const ci = other.chapters[4].timeline;
  quick[0].narration[0].text = 'Lawcheck installs with one npm command';
  quick[0].narration[1].text = 'It adds 4 packages.';
  quick[1].narration[0].shows = ['git init farm'];
  quick[2].narration[1] = { text: 'The law is one file. It is empty.', shows: ['.lawcheck/law.yaml'] };
  quick[3].narration[0].shows = [];
  delete quick[4].narration;
  ci[0].narration[0].shows = ['A CI job runs every night.'];
  ci[0].narration[1].page = 'cee-eye';
  ci[1].narration[0].text = 'Claude Code 2.1.330 on Sonnet writes the workflow.';
  delete other.voice;
  assert.deepEqual(narrationProblems(ROOT, other).problems, [
    'q1, narrated sentence 1: "Lawcheck installs with one npm command" does not end with . ! ? or …',
    'q1, narrated sentence 2: "It adds 4 packages." has a digit; a number is spoken in words',
    'q2, narrated sentence 1: "Git starts a new repository named shop." cites "git init farm", which is not on its frame',
    'q3, narrated sentence 2: "The law is one file. It is empty." holds more than one sentence',
    'q4, narrated sentence 1: "The law gets one type, core." names nothing on its frame or its page that it follows',
    'q5: the chapter quick-start narrates nothing over this frame',
    'c1, narrated sentence 1: "A CI job can run lawcheck check on each pull request." cites "A CI job runs every night.", which is not in docs/ci.md',
    'c1, narrated sentence 2: "A git hook can run it on each commit or push." cites the page docs/cee-eye.md, which does not exist',
    'c2, narrated sentence 1: "Claude Code 2.1.330 on Sonnet writes the workflow." has a digit; a number is spoken in words',
    'the edit names no voice for the narration',
  ]);
  assert.deepEqual(versionProblems(other), [
    'c2, narration: "Claude Code 2.1.330 on Sonnet writes the workflow." says a number with a point, as a version has: 2.1',
    'c2, narration: "Claude Code 2.1.330 on Sonnet writes the workflow." says the name of a model: Sonnet',
  ]);
});

test('test 1090: a narrated sentence that cites only its own caption or subtitle names a tie to a docs page, a recorded output or a take, and each tie is read against its source', () => {
  const edit = readEdit(ROOT);
  assert.deepEqual(narrationProblems(ROOT, edit).problems, []);
  const lines = (from: typeof edit) => from.chapters.flatMap((chapter: { timeline: { id: string; narration?: { text: string; ties?: unknown[] }[] }[] }) => chapter.timeline.flatMap((segment) => (segment.narration ?? []).map((line) => ({ segment, line }))));
  assert.equal(lines(edit).filter(({ line }) => line.ties !== undefined).length, 15);
  const other = clone(edit);
  const at = (text: string) => lines(other).find(({ line }) => line.text === text)!.line as { text: string; ties?: Record<string, unknown>[] };
  delete at('Lawcheck installs with one npm command.').ties;
  at('Lawcheck init writes an empty law.').ties![0]!.text = 'created .lawcheck/other.yaml';
  at('Forbid one layer to use another.').ties![0]!.from = { repo: 'film/edit.json' };
  at('Write a script rule.').ties![0]!.from = { repo: 'docs/missing.md' };
  at('Claude Code gets a prompt for a script rule.').ties = [{ text: 'Add a script rule no-fetch' }];
  at('The agent writes the rule.').ties![0]!.from = { take: 'sr01', file: 'change.diff', run: 'sr-try' };
  at('The agent writes the workflow.').ties = [];
  at('Write a reviewer rule.').ties![0]!.from = { run: 'sr-try' };
  assert.deepEqual(narrationProblems(ROOT, other).problems, [
    'q1, narrated sentence 1: "Lawcheck installs with one npm command." cites only its caption or subtitle, and names no tie to a docs page, a recorded output or a command that backs it',
    'q3, narrated sentence 1, tie 1: "created .lawcheck/other.yaml" is not in docs/quick-start.md',
    'f1, narrated sentence 1, tie 1: film/edit.json holds the caption and the subtitle themselves, so it ties nothing',
    's1, narrated sentence 1, tie 1: docs/missing.md does not exist',
    's2, narrated sentence 1, tie 1: a tie holds a text and a from that names a repo file, a run, or a take with a file',
    's3, narrated sentence 1, tie 1: a tie holds a text and a from that names a repo file, a run, or a take with a file',
    'r1, narrated sentence 1, tie 1: "# Write a reviewer rule" is not in film/takes/sr-try/output.txt',
    'c2, narrated sentence 1: "The agent writes the workflow." cites only its caption or subtitle, and names no tie to a docs page, a recorded output or a command that backs it',
  ]);
});

test('test 1091: a narrated sentence, a caption or a subtitle that names a version, a pre-release or a model in words is refused, as one that names it in digits is', () => {
  const edit = readEdit(ROOT);
  assert.deepEqual(versionProblems(edit), []);
  const other = clone(edit);
  const quick = other.chapters[0].timeline;
  const said = ['The release is zero point one.', 'It is alpha five of the tool.', 'Sonnet five writes the rule.', 'Claude five writes the rule.', 'It needs version two.', 'The tag reads one dot two dot three.', 'Lawcheck is at twenty-one point four.'];
  said.forEach((text, index) => {
    quick[index]!.narration = [{ text, shows: ['x'] }];
  });
  quick[0]!.caption = 'Zero point one';
  quick[1]!.subtitle = 'Alpha five installs it.';
  assert.deepEqual(versionProblems(other), [
    'q1-1: "Zero point one" shows a number with a point, said in words: Zero point one',
    'q2-1: "Alpha five installs it." shows a pre-release said in words: Alpha five',
    'q1, narration: "The release is zero point one." says a number with a point, said in words: zero point one',
    'q2, narration: "It is alpha five of the tool." says a pre-release said in words: alpha five',
    'q3, narration: "Sonnet five writes the rule." says the name of a model: Sonnet',
    'q4, narration: "Claude five writes the rule." says a model named with its number in words: Claude five',
    'q5, narration: "It needs version two." says a version said in words: version two',
    'q6, narration: "The tag reads one dot two dot three." says a number with a point, said in words: one dot two',
    'q7, narration: "Lawcheck is at twenty-one point four." says a number with a point, said in words: twenty-one point four',
  ]);
  const plain = clone(edit);
  plain.chapters[0].timeline[0].narration = [{ text: 'One point of failure is left.', shows: ['x'] }, { text: 'Claude Code reads the tag at alpha.', shows: ['x'] }];
  assert.deepEqual(versionProblems(plain), []);
});

function silence(seconds: number): Buffer {
  const rate = 8000;
  const data = Buffer.alloc(Math.round(seconds * rate) * 2);
  const head = Buffer.alloc(44);
  head.write('RIFF', 0);
  head.writeUInt32LE(36 + data.length, 4);
  head.write('WAVEfmt ', 8);
  head.writeUInt32LE(16, 16);
  head.writeUInt16LE(1, 20);
  head.writeUInt16LE(1, 22);
  head.writeUInt32LE(rate, 24);
  head.writeUInt32LE(rate * 2, 28);
  head.writeUInt16LE(2, 32);
  head.writeUInt16LE(16, 34);
  head.write('data', 36);
  head.writeUInt32LE(data.length, 40);
  return Buffer.concat([head, data]);
}

test('test 1059: a chapter\'s build mixes the voice of each narrated frame from its start, its sentences joined by one pause, and a voice spoken from other words, a missing voice and a voice longer than its frame are each refused', () => {
  const folder = testFolder('lawcheck-film-');
  try {
    const edit = readEdit(ROOT);
    const voice = join(folder.dir, 'voice');
    const segments: Record<string, { key: string }> = {};
    for (const chapter of edit.chapters) {
      mkdirSync(join(voice, chapter.page), { recursive: true });
      for (const segment of chapter.timeline) {
        writeFileSync(join(voice, chapter.page, `${segment.id}.wav`), silence(1));
        segments[`${chapter.page}/${segment.id}`] = { key: voiceKey(edit, segment) };
      }
    }
    writeFileSync(join(voice, 'voice.json'), JSON.stringify({ segments }));
    assert.equal(wavSeconds(silence(2.5)), 2.5);
    assert.equal(wavSeconds(joinWav([silence(1), silence(0.5), silence(0.25)], 0.5)), 2.75);
    assert.deepEqual(voiceProblems(edit, voice), []);
    build(join(folder.dir, 'dist'), ROOT, voice);
    const index = readFileSync(join(folder.dir, 'dist', 'quick-start', 'index.html'), 'utf8');
    assert.ok(index.includes('<audio id="voice-q1" class="clip" src="assets/voice/q1.wav" data-start="0.4" data-duration="1.00" data-track-index="4" data-volume="1"></audio>'), index);
    assert.ok(index.includes('<audio id="voice-q2" class="clip" src="assets/voice/q2.wav" data-start="7.5" data-duration="1.00" data-track-index="4" data-volume="1"></audio>'), index);
    assert.equal(readFileSync(join(folder.dir, 'dist', 'quick-start', 'assets', 'voice', 'q1.wav')).length, silence(1).length);
    assert.ok(!readFileSync(join(folder.dir, 'dist', 'loop', 'index.html'), 'utf8').includes('<audio'));
    segments['quick-start/q2'] = { key: voiceKey({ ...edit, voice: { ...edit.voice, speed: 2 } }, edit.chapters[0].timeline[1]) };
    writeFileSync(join(voice, 'voice.json'), JSON.stringify({ segments }));
    writeFileSync(join(voice, 'quick-start', 'q7.wav'), silence(4));
    rmSync(join(voice, 'quick-start', 'q3.wav'));
    const problems = [
      'the voice of quick-start q2 was spoken from other words or settings; node film/voice.mjs speaks it again',
      'the narration of quick-start q3 has no voice; node film/voice.mjs speaks it',
      'the voice of quick-start q7 lasts 4.00 s, and its frame leaves it 3.10 s',
    ];
    assert.deepEqual(voiceProblems(edit, voice), problems);
    assert.throws(() => build(join(folder.dir, 'dist'), ROOT, voice), { message: problems.join('\n') });
  } finally {
    folder.remove();
  }
});

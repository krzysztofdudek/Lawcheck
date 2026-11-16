import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PLATFORM_PROMISES, promiseOf, testIds } from '../harness/promises.ts';
import { groupDirs, nightly, perPushFiles, perPushTests, PLATFORM_BEHAVIOURS, PLATFORM_TESTS, ROOT, setFiles } from '../harness/sets.ts';
import type { PlatformTest } from '../harness/sets.ts';
import { PLATFORM_SKIPS } from '../harness/skips.ts';

type Other = 'win32' | 'darwin';
const OTHERS: Other[] = ['win32', 'darwin'];
const NAMED: Record<Other, RegExp> = { win32: /\bWindows\b/, darwin: /\bmacOS\b/ };

// What a check can hold an entry to: behaviours named from PLATFORM_BEHAVIOURS that hold on its systems, every system covered, and a reason that names each system. Whether the test exercises them is its reviewer's to judge.
function behaviourProblems(key: string, systems: readonly string[], behaviours: readonly string[], reason?: string): string[] {
  const problems: string[] = [];
  const catalogue = PLATFORM_BEHAVIOURS as Record<string, { systems: readonly string[] }>;
  if (behaviours.length === 0) problems.push(`${key}: names no behaviour of PLATFORM_BEHAVIOURS`);
  if (new Set(behaviours).size !== behaviours.length) problems.push(`${key}: names a behaviour twice`);
  for (const b of behaviours) {
    if (catalogue[b] === undefined) problems.push(`${key}: ${b} is no behaviour of PLATFORM_BEHAVIOURS`);
    else if (!catalogue[b]!.systems.some((system) => systems.includes(system))) problems.push(`${key}: ${b} holds on ${catalogue[b]!.systems.join(' and ')}, none of its systems`);
  }
  for (const system of systems) if (!behaviours.some((b) => catalogue[b]?.systems.includes(system))) problems.push(`${key}: no behaviour it names holds on ${system}`);
  if (reason !== undefined) {
    if (reason.trim().length < 20) problems.push(`${key}: reason ${JSON.stringify(reason)}`);
    for (const system of systems) if (!NAMED[system as Other].test(reason)) problems.push(`${key}: the reason does not name ${system}`);
  }
  return problems;
}

interface Declared {
  file: string;
  name: string;
  matches: (name: string) => boolean;
}

function literalEnd(text: string, at: number): number {
  const quote = text[at]!;
  let i = at + 1;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '\\') i += 2;
    else if (c === quote) return i;
    else if (quote === '`' && c === '$' && text[i + 1] === '{') i = braceEnd(text, i + 1) + 1;
    else i++;
  }
  throw new Error(`an unclosed string at ${at}`);
}

function braceEnd(text: string, at: number): number {
  let depth = 0;
  for (let i = at; i < text.length; i++) {
    const c = text[i]!;
    if (c === "'" || c === '"' || c === '`') i = literalEnd(text, i);
    else if (c === '{') depth++;
    else if (c === '}' && --depth === 0) return i;
  }
  throw new Error(`an unclosed brace at ${at}`);
}

const evaluate = (literal: string): string => new Function(`return ${literal};`)() as string;
const escape = (text: string) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// The top-level tests of a file as written: a statement that starts with test( and a string. A name built from a template is matched by its fixed parts.
function declaredTests(file: string): Declared[] {
  const text = readFileSync(join(ROOT, file), 'utf8');
  const out: Declared[] = [];
  for (const m of text.matchAll(/^[ \t]*test\(\s*(?=['"`])/gm)) {
    const start = m.index + m[0].length;
    const literal = text.slice(start, literalEnd(text, start) + 1);
    if (!literal.startsWith('`') || !literal.includes('${')) {
      const name = evaluate(literal);
      out.push({ file, name, matches: (other) => other === name });
      continue;
    }
    const parts: string[] = [];
    let i = 1;
    let chunk = '';
    while (i < literal.length - 1) {
      if (literal[i] === '\\') {
        chunk += literal.slice(i, i + 2);
        i += 2;
      } else if (literal[i] === '$' && literal[i + 1] === '{') {
        parts.push(evaluate(`\`${chunk}\``));
        chunk = '';
        i = braceEnd(literal, i + 1) + 1;
      } else chunk += literal[i++];
    }
    parts.push(evaluate(`\`${chunk}\``));
    const pattern = new RegExp(`^${parts.map(escape).join('.*?')}$`, 's');
    out.push({ file, name: parts.join('…'), matches: (other) => pattern.test(other) });
  }
  return out;
}

const commitFiles = setFiles('commit', groupDirs('commit', null)!);
const tests = commitFiles.flatMap(declaredTests);
const entriesOf = (file: string, matches: (name: string) => boolean) => PLATFORM_TESTS.filter((entry) => entry.file === file && matches(entry.test));
const wholeSkip = (entry: { file: string; test: string }, system: string) => PLATFORM_SKIPS.some((skip) => skip.file === entry.file && skip.test === entry.test && skip.part === 'the whole test' && skip.platform === system);

test('the scan finds the top-level tests of a file, a name built from a template included, and nothing inside a string', () => {
  const frame = declaredTests('tests/security/frame.test.ts');
  assert.ok(frame.some((t) => t.matches('I-frame-1: the attack file cr.ts stays inside its <file> block')));
  assert.ok(!frame.some((t) => t.matches('I-frame-1: the attack file cr.ts stays outside its <file> block')));
  assert.ok(declaredTests('tests/unit/programs.test.ts').some((t) => t.name === 'a program is found on PATH, and on Windows by the endings of PATHEXT'));
  assert.ok(!declaredTests('tests/contract/harness.test.ts').some((t) => t.name === ''));
  assert.ok(tests.length > 500, `${tests.length} tests`);
});

test('every entry of PLATFORM_TESTS names one top-level test of the commit set, once, for Windows or macOS', () => {
  const seen = new Set<string>();
  for (const entry of PLATFORM_TESTS) {
    const key = `${entry.file} > ${entry.test}`;
    assert.ok(commitFiles.includes(entry.file), `${key}: no test file of the commit set`);
    assert.equal(tests.filter((t) => t.file === entry.file && t.matches(entry.test)).length, 1, `${key}: names no test, or more than one`);
    assert.ok(!seen.has(key), `${key}: listed twice`);
    seen.add(key);
    assert.ok(entry.systems.length > 0 && entry.systems.every((system) => OTHERS.includes(system)) && new Set(entry.systems).size === entry.systems.length, `${key}: systems ${JSON.stringify(entry.systems)}`);
  }
});

test('every entry of PLATFORM_TESTS names behaviours of PLATFORM_BEHAVIOURS that hold on each of its systems, and a reason that names each system', () => {
  assert.deepEqual(PLATFORM_TESTS.flatMap((entry) => behaviourProblems(`${entry.file} > ${entry.test}`, entry.systems, entry.behaviours, entry.reason)), []);
});

test('an entry whose reason names no platform behaviour, names one outside the list, or one that does not hold on its system is refused (control)', () => {
  assert.deepEqual(behaviourProblems('t', ['win32'], [], 'this test matters for the process on Windows'), ['t: names no behaviour of PLATFORM_BEHAVIOURS', 't: no behaviour it names holds on win32']);
  assert.deepEqual(behaviourProblems('t', ['win32'], ['crlf-everywhere'], 'CRLF line endings split into lines, the endings of Windows'), ['t: crlf-everywhere is no behaviour of PLATFORM_BEHAVIOURS', 't: no behaviour it names holds on win32']);
  assert.deepEqual(behaviourProblems('t', ['win32', 'darwin'], ['cmd-shims'], 'a fake claude is a .cmd shim on Windows and macOS'), ['t: no behaviour it names holds on darwin']);
  assert.deepEqual(behaviourProblems('t', ['win32'], ['real-paths'], 'realpath of a temporary folder on Windows'), ['t: real-paths holds on darwin, none of its systems', 't: no behaviour it names holds on win32']);
  assert.deepEqual(behaviourProblems('t', ['win32'], ['line-ends'], 'CRLF line ends that a checkout writes'), ['t: the reason does not name win32']);
});

test('every behaviour of PLATFORM_BEHAVIOURS holds on Windows or macOS, says what differs there, and is named by an entry', () => {
  const named = new Set([...PLATFORM_TESTS.flatMap((entry) => entry.behaviours), ...Object.values(PLATFORM_PROMISES).flatMap((p) => p.behaviours)]);
  for (const [name, { systems, behaviour }] of Object.entries(PLATFORM_BEHAVIOURS)) {
    assert.ok(systems.length > 0 && systems.every((system) => OTHERS.includes(system)), name);
    assert.ok(behaviour.length >= 20, name);
    assert.ok(named.has(name as keyof typeof PLATFORM_BEHAVIOURS), `${name}: no entry names it`);
  }
});

test('no entry runs a test per push on a system where its whole body is skipped', () => {
  for (const entry of PLATFORM_TESTS) for (const system of entry.systems) assert.ok(!wholeSkip(entry, system), `${entry.file} > ${entry.test}: skipped whole on ${system}`);
});

test('a test with a part skipped on Windows or macOS runs there per push, and one skipped whole on Linux runs per push where it is not skipped', () => {
  const missing: string[] = [];
  for (const skip of PLATFORM_SKIPS) {
    if (skip.file === 'tests/harness' || nightly(skip.file)) continue;
    const declared = (system: Other) => entriesOf(skip.file, (name) => name === skip.test).some((entry: PlatformTest) => entry.systems.includes(system));
    if ((skip.platform === 'win32' || skip.platform === 'darwin') && skip.part !== 'the whole test' && !declared(skip.platform)) missing.push(`${skip.file} > ${skip.test} on ${skip.platform}`);
    if (skip.platform === 'linux' && skip.part === 'the whole test') for (const system of OTHERS) if (!wholeSkip(skip, system) && !declared(system)) missing.push(`${skip.file} > ${skip.test} on ${system}`);
  }
  assert.deepEqual(missing, []);
});

test('every id of PLATFORM_PROMISES is a promise the spec map resolves, naming behaviours of PLATFORM_BEHAVIOURS that hold on each of its systems', () => {
  assert.ok(Object.keys(PLATFORM_PROMISES).length > 0);
  for (const [id, { systems, behaviours, behaviour }] of Object.entries(PLATFORM_PROMISES)) {
    assert.notEqual(promiseOf(id), null, `${id}: the spec map resolves no promise`);
    assert.ok(systems.length > 0 && systems.every((system) => OTHERS.includes(system)), `${id}: systems ${JSON.stringify(systems)}`);
    assert.deepEqual(behaviourProblems(id, systems, behaviours, behaviour), []);
  }
});

test('no test that carries a promise of PLATFORM_PROMISES is Linux only on a system the promise names', () => {
  const missing: string[] = [];
  for (const t of tests) {
    for (const id of testIds(t.name)) {
      const promise = PLATFORM_PROMISES[id];
      if (promise === undefined) continue;
      const entries = entriesOf(t.file, t.matches);
      for (const system of promise.systems) {
        if (PLATFORM_SKIPS.some((skip) => skip.file === t.file && t.matches(skip.test) && skip.part === 'the whole test' && skip.platform === system)) continue;
        if (entries.length === 0 || entries.some((entry) => !entry.systems.includes(system))) missing.push(`${t.file} > ${t.name}: ${id} on ${system}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('per push, Linux runs the whole commit set, and Windows and macOS the declared tests of the files that hold them', () => {
  assert.deepEqual(perPushFiles('linux'), commitFiles);
  assert.equal(perPushTests('linux', commitFiles), null);
  for (const system of OTHERS) {
    const files = perPushFiles(system);
    const declared = PLATFORM_TESTS.filter((entry) => entry.systems.includes(system));
    assert.deepEqual(files, [...new Set(declared.map((entry) => entry.file))].sort());
    assert.deepEqual(perPushTests(system, files), declared.map((entry) => entry.test));
    const one = files[0]!;
    assert.deepEqual(perPushTests(system, [one]), declared.filter((entry) => entry.file === one).map((entry) => entry.test));
    assert.ok(files.length > 0 && files.length < commitFiles.length, `${system}: ${files.length} of ${commitFiles.length} files`);
  }
});

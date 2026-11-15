import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import { test } from 'node:test';
import fc from 'fast-check';
import { stringify } from 'yaml';
import { readConfig } from '../../dist/config.js';
import { parseLaw } from '../../dist/law.js';
import { lawcheck, makeSample, temp, write } from '../acceptance/helpers.ts';
import { PURE_CALL_BUDGET_MS } from './numbers.ts';
import { pure, tool, within } from './support.ts';
import type { Speed } from './support.ts';

const word = fc.constantFrom('a', 'b', 'source', 'library', 'no-console', 'no-todo', 'paths', 'rules', 'types', 'why', 'about', 'status', 'content', 'may_use', 'waivers', 'context', 'lawcheck', 'Bad Id', '~', 'true', '12', '');
const scalar = fc.oneof(word, fc.string({ maxLength: 6 }), fc.integer(), fc.boolean(), fc.constant(null), fc.constantFrom('0.1.0', 'src/**', '!src/**', 'src/{a,b}/*.ts', '**/*a*a*b', 'a\nb', '\u0000', '^#!', '(', 'enforced', 'advisory'));
const value: fc.Arbitrary<unknown> = fc.letrec((tie) => ({
  node: fc.oneof({ depthSize: 'small', withCrossShrink: true }, scalar, fc.array(tie('node'), { maxLength: 3 }), fc.dictionary(word, tie('node'), { maxKeys: 4 })),
})).node;

// A law close to a valid one, with one part replaced by any value, so the generator reaches accepted laws and every key's refusal.
const nearValid = fc.tuple(fc.constantFrom('rules', 'types', 'why', 'paths', 'type-rules', 'status', 'waivers', 'may_use', 'none'), value).map(([part, v]) => {
  const law: Record<string, any> = {
    lawcheck: '0.1.0',
    rules: { 'no-console': { why: 'Only the command layer writes to the terminal.' } },
    types: { source: { paths: ['src/**/*.ts'], rules: ['no-console'], types: { library: { paths: ['src/core/**'] } } } },
  };
  if (part === 'rules') law.rules = v;
  if (part === 'types') law.types = v;
  if (part === 'why') law.rules['no-console'].why = v;
  if (part === 'status') law.rules['no-console'].status = v;
  if (part === 'paths') law.types.source.paths = v;
  if (part === 'type-rules') law.types.source.rules = v;
  if (part === 'waivers') law.types.source.waivers = v;
  if (part === 'may_use') law.types.source.may_use = v;
  return law;
});
const yamlText = fc.oneof(
  { weight: 3, arbitrary: nearValid.map((law) => stringify(law)) },
  { weight: 1, arbitrary: value.map((v) => stringify(v)) },
  { weight: 1, arbitrary: fc.tuple(fc.integer({ min: 100, max: 20_000 }), fc.constantFrom('[', '{', '- ', 'a: ')).map(([n, unit]) => (unit === 'a: ' ? `lawcheck: 0.1.0\ntypes: ${'{a: '.repeat(n)}` : unit.repeat(n))) },
  { weight: 1, arbitrary: fc.string({ unit: fc.constantFrom('a', ':', ' ', '\n', '-', '[', ']', '{', '}', '"', "'", '#', '&a', '*a', '!!', '\t', '﻿', '\u0000', '%'), maxLength: 60 }) },
);

function lineCount(text: string): number {
  return text.split('\n').length;
}

export function lawProperties(speed: Speed): void {
  test('I-law-1: any text as law.yaml is a law or law-invalid at a line of the file', () => {
    pure(
      speed,
      yamlText,
      { classes: { 'an accepted law': (t) => parseLaw(t).law !== null, 'a refused law': (t) => parseLaw(t).law === null, 'nested 100 deep or more': (t) => t.length >= 100 && /^(\[|\{|- |lawcheck: 0\.1\.0\ntypes: \{)/.test(t) }, least: { 'an accepted law': 0.05, 'nested 100 deep or more': 0.05 } },
      (t) => {
        const { law, problems } = within(PURE_CALL_BUDGET_MS, 'parseLaw', () => parseLaw(t));
        if (law === null) {
          assert.ok(problems.length > 0);
          for (const p of problems) {
            assert.ok(Number.isInteger(p.line) && p.line >= 1 && p.line <= lineCount(t), `line ${p.line} of ${lineCount(t)}: ${p.message}`);
            assert.ok(typeof p.message === 'string' && p.message !== '', p.message);
          }
        } else assert.deepEqual(problems, []);
      },
    );
  });

  test('I-law-1: an accepted law is printed back by explain, type by type', async () => {
    await tool(
      speed,
      nearValid.map((law) => stringify(law)).filter((t) => parseLaw(t).law !== null),
      { classes: { 'a law with subtypes': (t) => parseLaw(t).law!.types.some((type: { types: unknown[] }) => type.types.length > 0) }, least: { 'a law with subtypes': 0.05 } },
      async (t) => {
        const dir = temp();
        try {
          const s = makeSample(dir.dir);
          write(s, '.lawcheck/law.yaml', t);
          rmSync(`${s}/.lawcheck/rules/no-todo.mjs`);
          for (const id of parseLaw(t).law!.rules.keys()) if (id !== 'no-console') write(s, `.lawcheck/rules/${id}.mjs`, 'export function check() { return []; }\n');
          const law = parseLaw(t).law!;
          for (const [id, type] of law.byId as Map<string, { paths: string[] }>) {
            const run = await lawcheck(s, ['explain', '--type', id, '--json']);
            if (run.code === 2) {
              const errors = JSON.parse(run.stdout).errors as { code: string }[];
              assert.ok(errors.every((e) => ['rule-missing-file', 'rule-file-without-entry', 'type-overlap', 'file-unreadable'].includes(e.code)), run.stdout);
              continue;
            }
            assert.equal(run.code, 0, run.stdout);
            const document = JSON.parse(run.stdout);
            assert.deepEqual([document.id, document.paths], [id, type.paths]);
          }
        } finally {
          dir.remove();
        }
      },
    );
  });

  test('I-law-1: any text as config.yaml is a config or config-invalid at a line of the file', () => {
    const config = fc.oneof(yamlText, fc.dictionary(fc.constantFrom('reviewer', 'runner', 'provider', 'model', 'max_calls', 'timeout'), value).map((v) => stringify(v)));
    pure(speed, config, { classes: { 'a refused config': (t) => configOutcome(t) === 'refused' } }, (t) => {
      const outcome = within(PURE_CALL_BUDGET_MS, 'readConfig', () => configOutcome(t));
      assert.ok(outcome === 'refused' || outcome === 'accepted');
    });
  });
}

function configOutcome(text: string): 'accepted' | 'refused' {
  const dir = temp();
  try {
    write(dir.dir, '.lawcheck/config.yaml', text);
    const read = readConfig(dir.dir);
    if ('problems' in read) {
      for (const p of read.problems) assert.ok(Number.isInteger(p.line) && p.line >= 1 && p.line <= lineCount(text), `line ${p.line}: ${p.message}`);
      return 'refused';
    }
    return 'accepted';
  } finally {
    dir.remove();
  }
}

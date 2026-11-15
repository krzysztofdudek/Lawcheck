import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';
import fc from 'fast-check';
import { stringify } from 'yaml';
import { readConfig } from '../../dist/config.js';
import { parseLaw } from '../../dist/law.js';
import { lawcheck, makeSample, temp, write } from '../acceptance/helpers.ts';
import { LAW_PARSE_BUDGET_MS, PURE_CALL_BUDGET_MS } from '../numbers.ts';
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
  { weight: 1, arbitrary: fc.string({ unit: fc.constantFrom('a', ':', ' ', '\n', '-', '[', ']', '{', '}', '"', "'", '#', '&a', '*a', '!!', '\t', '\ufeff', '\u0000', '%'), maxLength: 60 }) },
);

function lineCount(text: string): number {
  return text.split('\n').length;
}

// Each property by its name, for tests/properties/law.test.ts and law.nightly.test.ts to register with its name written out.
export function lawProperties(speed: Speed): Record<string, () => unknown> {
  const out: Record<string, () => unknown> = {};
  const test = (name: string, body: () => unknown) => {
    out[name] = body;
  };
  test('I-law-1: any text as law.yaml is a law or law-invalid at a line of the file', () => {
    pure(
      speed,
      yamlText,
      { classes: { 'an accepted law': (t) => parseLaw(t).law !== null, 'a refused law': (t) => parseLaw(t).law === null, 'nested 100 deep or more': (t) => t.length >= 100 && /^(\[|\{|- |lawcheck: 0\.1\.0\ntypes: \{)/.test(t) }, least: { 'an accepted law': 0.05, 'nested 100 deep or more': 0.05 } },
      (t) => {
        const { law, problems } = within(LAW_PARSE_BUDGET_MS, 'parseLaw', () => parseLaw(t));
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

  test('I-law-1: an accepted law is printed back by explain, every type and every rule whole', async () => {
    const accepted = nearValid.filter((law) => parseLaw(stringify(law)).law !== null);
    await tool(
      speed,
      accepted,
      { classes: { 'a law with subtypes': (law) => Object.values(law.types ?? {}).some((type: any) => type?.types && Object.keys(type.types).length > 0), 'a law with waivers or may_use set': (law) => Object.values(law.types ?? {}).some((type: any) => type?.waivers !== undefined || type?.may_use !== undefined) }, least: { 'a law with subtypes': 0.05, 'a law with waivers or may_use set': 0.05 } },
      async (law) => {
        const dir = temp();
        try {
          const s = makeSample(dir.dir);
          write(s, '.lawcheck/law.yaml', stringify(law));
          rmSync(`${s}/.lawcheck/rules/no-todo.mjs`);
          for (const id of Object.keys(law.rules ?? {})) if (id !== 'no-console') write(s, `.lawcheck/rules/${id}.mjs`, 'export function check() { return []; }\n');
          const walk = (types: Record<string, any>, chain: string[], waivers: boolean, mayUse: { list: string[]; from: string } | null): void[] =>
            Object.entries(types ?? {}).flatMap(([id, type]) => {
              const own = type.waivers ?? waivers;
              const list = type.may_use === undefined ? mayUse : { list: [...new Set<string>(type.may_use)], from: id };
              expected.push({ id, chain: [...chain, id], about: type.about ?? null, paths: type.paths, content: type.content ?? null, subtypes: Object.keys(type.types ?? {}), waivers: own, may_use: list === null ? null : { types: list.list, from: list.from === id ? null : list.from }, rules: [...new Set<string>(type.rules ?? [])] });
              return walk(type.types, [...chain, id], own, list);
            });
          const expected: any[] = [];
          walk(law.types, [], true, null);
          for (const want of expected) {
            const run = await lawcheck(s, ['explain', '--type', want.id, '--json']);
            if (run.code === 2) {
              const errors = JSON.parse(run.stdout).errors as { code: string }[];
              assert.ok(errors.every((e) => e.code === 'type-overlap'), run.stdout);
              continue;
            }
            assert.equal(run.code, 0, run.stdout);
            const got = JSON.parse(run.stdout);
            const ownRules = got.rules.filter((r: { from: string }) => r.from === want.id).map((r: { id: string }) => r.id);
            assert.deepEqual(
              { id: got.id, chain: got.chain, about: got.about, paths: got.paths, content: got.content, subtypes: got.subtypes, waivers: got.waivers, may_use: got.may_use, rules: ownRules },
              want,
            );
          }
          for (const [id, rule] of Object.entries(law.rules ?? {}) as [string, any][]) {
            const run = await lawcheck(s, ['explain', '--rule', id, '--json']);
            if (run.code === 2) continue;
            const got = JSON.parse(run.stdout);
            assert.deepEqual({ why: got.why, status: got.status }, { why: rule.why, status: rule.status ?? 'enforced' });
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
  return out;
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

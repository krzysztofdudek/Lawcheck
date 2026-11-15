import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { compileList, compilePattern, patternProblem } from '../../dist/glob.js';
import { PURE_CALL_BUDGET_MS } from '../numbers.ts';
import { pure, within } from './support.ts';
import type { Speed } from './support.ts';

// The matcher of spec/check-slice.md, section 2, written as the backtracking regular expression it reads as; right on small input, slow on adversarial input.
function reference(pattern: string): RegExp {
  const special = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/']);
  const segment = (text: string) => {
    let out = '';
    let open = false;
    for (const ch of text) {
      if (ch === '*') out += '[^/]*';
      else if (ch === '?') out += '[^/]';
      else if (ch === '{') {
        out += '(?:';
        open = true;
      } else if (ch === '}') {
        out += ')';
        open = false;
      } else if (ch === ',' && open) out += '|';
      else out += special.has(ch) ? '\\' + ch : ch;
    }
    return out;
  };
  const segments = pattern.split('/');
  let source = '^';
  segments.forEach((part, index) => {
    const last = index === segments.length - 1;
    if (part === '**') source += last ? '[\\s\\S]+' : '(?:[^/]+/)*';
    else source += segment(part) + (last ? '' : '/');
  });
  return new RegExp(source + '$', 'u');
}

const letter = fc.constantFrom('a', 'b', '.', 'ż');
const token = fc.oneof(
  { weight: 4, arbitrary: letter },
  { weight: 3, arbitrary: fc.constant('*') },
  { weight: 1, arbitrary: fc.constant('?') },
  { weight: 1, arbitrary: fc.array(fc.array(fc.oneof(letter, fc.constant('*')), { minLength: 1, maxLength: 3 }).map((a) => a.join('')), { minLength: 1, maxLength: 3 }).map((alts) => `{${alts.join(',')}}`) },
);
const segment = fc.oneof({ weight: 5, arbitrary: fc.array(token, { minLength: 1, maxLength: 6 }).map((t) => t.join('')) }, { weight: 1, arbitrary: fc.constant('**') });
const pattern = fc.array(segment, { minLength: 1, maxLength: 4 }).map((s) => s.join('/')).filter((p) => patternProblem(p) === null);
const name = fc.array(fc.array(fc.constantFrom('a', 'b', '.', 'ż', 'x'), { minLength: 1, maxLength: 8 }).map((c) => c.join('')), { minLength: 1, maxLength: 5 }).map((s) => s.join('/'));
const stars = (p: string) => p.split('/').some((s) => s !== '**' && (s.match(/\*/g)?.length ?? 0) >= 2);

export function globProperties(speed: Speed): void {
  test('I-glob-1, S1-1: a pattern matches as the reference matcher does, on small input', () => {
    const pair = fc.tuple(pattern, name, fc.boolean()).map(([p, n, near]) => {
      if (!near) return { p, n };
      const made = p.replace(/\*\*/g, 'a/b').replace(/\*/g, 'ab').replace(/\?/g, 'x').replace(/\{([^,}]*)[^}]*\}/g, '$1');
      return { p, n: made };
    });
    pure(
      speed,
      pair,
      {
        classes: {
          'several * in one segment': ({ p }) => stars(p),
          '** as a segment': ({ p }) => p.split('/').includes('**'),
          braces: ({ p }) => p.includes('{'),
          'a match': ({ p, n }) => reference(p).test(n),
          'no match': ({ p, n }) => !reference(p).test(n),
        },
      },
      ({ p, n }) => assert.equal(compilePattern(p).test(n), reference(p).test(n), `${p} against ${n}`),
    );
  });

  test('I-glob-1, S1-1: a list with exclusions matches as the reference does', () => {
    const list = fc.array(fc.tuple(fc.boolean(), pattern), { minLength: 1, maxLength: 4 }).map((items) => items.map(([not, p]) => (not ? `!${p}` : p)));
    pure(
      speed,
      fc.tuple(list, name),
      { classes: { 'an exclusion': ([l]) => l.some((p) => p.startsWith('!')), 'a plain pattern': ([l]) => l.some((p) => !p.startsWith('!')) } },
      ([l, n]) => {
        const plain = l.filter((p) => !p.startsWith('!')).map(reference);
        const out = l.filter((p) => p.startsWith('!')).map((p) => reference(p.slice(1)));
        assert.equal(compileList(l)(n), plain.some((re) => re.test(n)) && !out.some((re) => re.test(n)));
      },
    );
  });

  test('I-glob-1, S1-1: any text is a pattern that compiles or one with a named problem', () => {
    const text = fc.string({ unit: fc.constantFrom('a', '/', '*', '**', '{', '}', ',', '!', '.', '..', '?', '\\', '\n', '\u0000', 'ż'), maxLength: 30 });
    pure(
      speed,
      fc.tuple(text, name),
      { classes: { 'a problem': ([t]) => patternProblem(t) !== null, 'no problem': ([t]) => patternProblem(t) === null }, least: { 'no problem': 0.02 } },
      ([t, n]) => {
        const problem = patternProblem(t);
        if (problem !== null) {
          assert.equal(typeof problem, 'string');
          assert.notEqual(problem, '');
          return;
        }
        const body = t.startsWith('!') ? t.slice(1) : t;
        within(PURE_CALL_BUDGET_MS, `matching ${JSON.stringify(t)}`, () => compilePattern(body).test(n));
      },
    );
  });

  test('I-glob-1, S1-1: a match costs time linear in the name, for any pattern and a name of up to 4,096 bytes', () => {
    const many = fc.array(fc.constantFrom('*a', '*b', '*', '?', 'a'), { minLength: 4, maxLength: 24 }).map((t) => `src/**/${t.join('')}*b.ts`);
    const long = fc.tuple(fc.integer({ min: 1, max: 4096 }), fc.constantFrom('a', 'ab', 'aż')).map(([n, unit]) => `src/x/${unit.repeat(n).slice(0, n)}.ts`);
    pure(
      speed,
      fc.tuple(many, long),
      { classes: { 'several * in one segment': ([p]) => stars(p), 'a name over 1,000 characters': ([, n]) => n.length > 1000 } },
      ([p, n]) => {
        within(PURE_CALL_BUDGET_MS, `matching ${p} against a name of ${n.length} characters`, () => compilePattern(p).test(n));
      },
    );
  });
}

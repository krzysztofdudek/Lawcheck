import assert from 'node:assert/strict';
import { test } from 'node:test';
import fc from 'fast-check';
import { check, makeSample, setRule, temp, write } from '../acceptance/helpers.ts';
import { tool } from './support.ts';
import type { Speed } from './support.ts';

// JavaScript source for a value a rule may return: plain data, odd numbers, objects of every shape a finding can take, and values the channel cannot carry.
const leaf = fc.constantFrom('null', 'undefined', '0', '-1', '1', '2', '1.5', 'NaN', 'Infinity', '2n', "'2'", "''", "'x'", "'a\\nb'", 'true', '[]', '{}', 'Symbol()', '() => 1', 'new Date(0)', 'new Map()', '/x/', "'\\u0000\\u001b[2K'");
const finding = fc.record({ message: leaf, line: fc.option(leaf, { nil: null }), file: fc.option(fc.constantFrom("'src/core/a.ts'", "'src/core/b.ts'", "'other.ts'"), { nil: null }) }).map(({ message, line, file }) => `{ message: ${message}${line === null ? '' : `, line: ${line}`}${file === null ? '' : `, file: ${file}`} }`);
const returned = fc.oneof(leaf, fc.array(fc.oneof({ weight: 3, arbitrary: finding }, { weight: 1, arbitrary: leaf }), { maxLength: 3 }).map((items) => `[${items.join(', ')}]`));
const how = fc.constantFrom('return', 'return Promise.resolve', 'throw', 'return Promise.reject', 'background', 'top', 'timer', 'late');

function ruleSource(kind: string, value: string): string {
  switch (kind) {
    case 'return':
      return `export function check() { return ${value}; }\n`;
    case 'return Promise.resolve':
      return `export async function check() { return ${value}; }\n`;
    case 'throw':
      return `export function check() { throw ${value}; }\n`;
    case 'return Promise.reject':
      return `export async function check() { throw ${value}; }\n`;
    case 'background':
      return `export function check() { Promise.reject(${value}); return []; }\n`;
    case 'timer':
      return `export function check() { setTimeout(() => { throw ${value}; }, 40); return []; }\n`;
    case 'late':
      return `export function check() { void (async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 5)); throw ${value}; })(); return []; }\n`;
    default:
      return `Promise.reject(${value});\nexport function check() { return []; }\n`;
  }
}

async function outcome(source: string, files: string[]): Promise<{ code: number | null; lines: string[] }> {
  const dir = temp();
  try {
    const s = makeSample(dir.dir);
    setRule(s, 'no-console', source);
    for (const file of files) write(s, file, 'export const x = 1;\nexport const y = 2;\n');
    const run = await check(s, '--base', 'main', '--json');
    const document = JSON.parse(run.stdout);
    if (run.code === 2) {
      assert.equal(document.schema, 'lawcheck-error/1');
      return { code: 2, lines: document.errors.map((e: { code: string; file: string; message: string }) => `${e.code} ${e.file} ${e.message}`) };
    }
    return { code: run.code, lines: document.findings.filter((f: { rule: string }) => f.rule === 'no-console').map((f: { file: string; line?: number; message: string }) => `${f.file}:${f.line ?? ''} ${f.message}`) };
  } finally {
    dir.remove();
  }
}

export function rulesProperties(speed: Speed): void {
  test('I-rules-1, S2-4, S2-6: any value a rule returns, throws or rejects with gives findings or a rule-crashed naming its cause, and file A is judged the same alone or with B', async () => {
    await tool(
      speed,
      fc.tuple(how, returned),
      {
        classes: {
          'returns a list': ([kind, value]) => kind.startsWith('return') && value.startsWith('['),
          'throws or rejects': ([kind]) => !kind.startsWith('return'),
          'fails from a timer or after several turns': ([kind]) => kind === 'timer' || kind === 'late',
          'a line of an odd kind': ([, value]) => /line: (null|undefined|'|2n|1\.5|NaN|\[|\{)/.test(value),
        },
      },
      async ([kind, value]) => {
        const source = ruleSource(kind, value);
        const alone = await outcome(source, ['src/core/a.ts']);
        assert.ok(alone.code === 0 || alone.code === 1 || alone.code === 2, String(alone.code));
        if (kind !== 'return' && kind !== 'return Promise.resolve') assert.equal(alone.code, 2, `a rule that ${kind} is rule-crashed: ${alone.lines.join('\n')}`);
        if (alone.code === 2) {
          assert.equal(alone.lines.length, 1, alone.lines.join('\n'));
          assert.match(alone.lines[0]!, /^rule-crashed \.lawcheck\/rules\/no-console\.mjs (returns|throws|fails|ends|passes)/);
          assert.doesNotMatch(alone.lines[0]!, /internal/);
        }
        const both = await outcome(source, ['src/core/a.ts', 'src/core/b.ts']);
        if (alone.code === 2) assert.deepEqual(both, alone, 'a rule that breaks on A breaks the same way when B is judged after it');
        else if (both.code === 2) assert.match(both.lines.join('\n'), /^rule-crashed \S+ returns a finding about 'src\/core\/a\.ts' for src\/core\/b\.ts$/, 'a rule that judged A alone breaks with B only for what it returns about B');
        else assert.deepEqual(both.lines.filter((l) => l.startsWith('src/core/a.ts:')), alone.lines);
      },
    );
  });
}

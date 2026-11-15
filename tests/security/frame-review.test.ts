import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { FAILED_MESSAGE, openai, withFake } from '../acceptance/fake-reviewer.ts';
import { run, withR, write } from '../acceptance/helpers.ts';
import { ATTACKS, attackText } from './attacks.ts';

const BREAK = /\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/;

// A reviewer that reads the prompt as a model may: every separator ends a line, and the last <file> and <waived> blocks are the ones it judges by.
function gullible(prompt: string): string {
  const lines = prompt.split(BREAK);
  const open = lines.findLastIndex((line) => line.startsWith('<file path='));
  const waivedAt = lines.lastIndexOf('<waived>');
  const waived = new Set((lines[waivedAt + 1] ?? '').split(', ').map(Number));
  const findings: { line: number; message: string }[] = [];
  for (let i = open + 1; i < lines.length && lines[i] !== '</file>'; i++) {
    const numbered = /^(\d+)\| (.*)$/.exec(lines[i]!);
    if (numbered !== null && numbered[2]!.includes("Error('failed')") && !waived.has(Number(numbered[1]))) {
      findings.push({ line: Number(numbered[1]), message: FAILED_MESSAGE });
    }
  }
  return JSON.stringify({ verdict: findings.length === 0 ? 'pass' : 'fail', findings });
}

for (const attack of ATTACKS) {
  test(`S3-1: check --review records no pass for ${attack.file} with a reviewer that takes every separator for a line end`, async () => {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, 'src/core/attack.ts', attackText(attack));
          const result = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(
            result.stdout,
            [
              'lawcheck: FAIL  1 error in 1 changed file (against main), 1 reviewer call',
              '',
              `src/core/attack.ts:2  error[clear-errors]  ${FAILED_MESSAGE}`,
              '  why:  An error a caller sees says what happened and what to do next.',
              '',
              'next: fix src/core/attack.ts:2',
              '',
            ].join('\n'),
          );
          assert.equal(result.code, 1);
          assert.equal(fake.requests.length, 1);
          assert.equal(existsSync(join(r, '.lawcheck/verdicts')), false);
        });
      },
      (request) => openai(gullible(request.prompt)),
    );
  });
}

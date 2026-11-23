import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { CLI, GIT_ENV, inTemp, lawcheck, newRepository, read, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "5. Measure the uses between types"': SCENARIO,
  'block 2 under "5. Measure the uses between types"': SCENARIO,
  'block 1 under "6. Write the lists that hold today"': SCENARIO,
  'block 1 under "8. Write the rules"': SCENARIO,
  'block 2 under "8. Write the rules"': SCENARIO,
  'block 3 under "8. Write the rules"': SCENARIO,
  'block 1 under "Measure a law that is not in force"': SCENARIO,
  'block 2 under "Measure a law that is not in force"': SCENARIO,
  'block 1 under "Prove each restriction bites"': SCENARIO,
  'block 2 under "Prove each restriction bites"': SCENARIO,
};

export const FILES: Record<string, string> = {
  'src/api/orders.ts': "import { price } from '../core/price';\nimport { find } from '../db/orders';\n\nexport const order = price + find;\n",
  'src/api/refunds.ts': "import { price } from '../core/price';\n\nexport const refund = -price;\n",
  'src/core/price.ts': '// A price never goes to console.log: the handlers print it.\nexport const price = 100;\n',
  'src/core/report.ts': "import { order } from '../api/orders';\n\nexport const report = order;\nconsole.log(report);\n",
  'src/db/orders.ts': "import { price } from '../core/price';\n\nexport const find = price;\n",
};

const PROBE = "import { order } from '../api/orders';\n\nexport const probe = order;\n";

const withoutLists = (law: string): string => law.replace(/\n +may_use: \[[^\]]*\]/g, '');

function measure(page: Page, dir: string, repo: string, keep: string): { code: number | null; stdout: string; stderr: string } {
  const bin = join(dir, 'bin');
  mkdirSync(bin, { recursive: true });
  write(bin, 'lawcheck', `#!/bin/sh\nexec "${process.execPath}" "${CLI}" "$@"\n`);
  chmodSync(join(bin, 'lawcheck'), 0o755);
  const line = page.text('block 2 under "Measure a law that is not in force"');
  assert.ok(line.startsWith('$ ') && !line.includes('\n'), 'the measurement is one shell command');
  // A script file outside the repository, as the scenario of docs/ci.md runs its job: the line is a pipeline of the shell, not one start of Lawcheck.
  write(dir, 'measure.sh', line.slice(2) + '\n');
  const run = spawnSync('sh', [join(dir, 'measure.sh')], { cwd: repo, env: { ...GIT_ENV, KEEP: keep, PATH: `${bin}${process.platform === 'win32' ? ';' : ':'}${process.env.PATH}` }, encoding: 'utf8' });
  return { code: run.status, stdout: run.stdout, stderr: run.stderr };
}

export async function scenario(page: Page): Promise<void> {
  const candidate = page.text('block 1 under "5. Measure the uses between types"') + '\n';
  const law = page.text('block 1 under "6. Write the lists that hold today"') + '\n';
  assert.equal(withoutLists(candidate), withoutLists(law), 'step 6 changes only the may_use lists of the candidate');
  for (const [, id, list] of law.matchAll(/\n  ([a-z-]+):\n(?:    .*\n)*?    may_use: \[([^\]]*)\]/g)) assert.equal(list!.split(', ')[0], id, `the list of ${id} names the type itself first`);
  await inTemp(async (dir) => {
    const repo = newRepository(dir, FILES);
    assert.equal((await lawcheck(repo, ['init'])).code, 0);
    const described = withoutLists(candidate);
    write(repo, '.lawcheck/law.yaml', described);
    const keep = join(dir, 'keep');
    write(keep, 'uses.mjs', page.text('block 1 under "Measure a law that is not in force"') + '\n');
    write(keep, 'candidate.yaml', candidate);
    const measured = measure(page, dir, repo, keep);
    assert.deepEqual([measured.code, measured.stdout, measured.stderr], [0, page.text('block 2 under "5. Measure the uses between types"') + '\n', '']);
    assert.equal(read(repo, '.lawcheck/law.yaml'), described, 'the measurement puts the law back');

    write(keep, 'candidate.yaml', 'lawcheck: 0.1.0\n\ntypes:\n  api:\n    paths: ["src/api/**"]\n    may_use: [nothing]\n');
    const broken = measure(page, dir, repo, keep);
    assert.equal(broken.code, 0, 'cmp passes after the law comes back');
    assert.match(broken.stdout, /^law-invalid  \.lawcheck\/law\.yaml:/m);
    assert.equal(read(repo, '.lawcheck/law.yaml'), described, 'a candidate that is no law leaves the law as it was');

    write(repo, '.lawcheck/law.yaml', law);
    const full = await lawcheck(repo, ['check', '--full', '--base', 'HEAD', '--json']);
    const findings = (JSON.parse(full.stdout) as { findings: { code: string }[] }).findings;
    assert.deepEqual([full.code, findings.filter((f) => f.code === 'forbidden-use')], [0, []], 'the lists of step 6 hold today');

    const tried = /^\$ lawcheck try ([a-z-]+) '([^']+)'$/.exec(page.text('block 2 under "8. Write the rules"'));
    assert.ok(tried, 'the rule is tried on a quoted pattern');
    write(repo, `.lawcheck/rules/${tried[1]}.mjs`, page.text('block 1 under "8. Write the rules"') + '\n');
    write(repo, '.lawcheck/law.yaml', law.replace('\ntypes:\n', `\nrules:\n  ${tried[1]}:\n    why: Only the handlers write to the terminal.\n\ntypes:\n`));
    assert.match(read(repo, 'src/core/price.ts'), /^\/\/ .*console\.log/, 'the comment names the call the rule looks for');
    const counted = await lawcheck(repo, ['try', tried[1]!, tried[2]!]);
    assert.deepEqual([counted.code, counted.stdout], [1, page.text('block 3 under "8. Write the rules"') + '\n'], 'the rule reads the tree: the call is a finding and the comment is not');
    write(repo, '.lawcheck/law.yaml', law);
    rmSync(join(repo, `.lawcheck/rules/${tried[1]}.mjs`));

    const probe = /^\$ lawcheck (check (\S+))$/.exec(page.text('block 1 under "Prove each restriction bites"'));
    assert.ok(probe, 'the probe is checked by its path');
    write(repo, probe[2]!, PROBE);
    const bitten = await lawcheck(repo, probe[1]!.split(' '));
    assert.deepEqual([bitten.code, bitten.stdout], [1, page.text('block 2 under "Prove each restriction bites"') + '\n']);
  });
}

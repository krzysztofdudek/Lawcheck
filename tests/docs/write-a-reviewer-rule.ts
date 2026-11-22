import assert from 'node:assert/strict';
import { parseConfig } from '../../dist/config.js';
import { defaultAnswer, ollama, withFake } from '../acceptance/fake-reviewer.ts';
import { git, inTemp, lawcheck, newRepository, write } from '../acceptance/helpers.ts';
import { SCENARIO } from '../contract/docs-blocks.ts';
import type { Claims, Page } from '../contract/docs-blocks.ts';

export const claims: Claims = {
  'block 1 under "Write a reviewer rule"': SCENARIO,
  'block 1 under "1. Write the rule file"': SCENARIO,
  'block 1 under "2. Put the rule in the law"': SCENARIO,
  'block 1 under "3. Choose a reviewer"': SCENARIO,
  'block 1 under "4. Check that the reviewer answers"': SCENARIO,
  'block 2 under "4. Check that the reviewer answers"': SCENARIO,
  'block 1 under "5. See what the change needs"': SCENARIO,
  'block 2 under "5. See what the change needs"': SCENARIO,
  'block 1 under "6. See the cost of a try"': SCENARIO,
  'block 2 under "6. See the cost of a try"': SCENARIO,
  'block 1 under "7. Try the rule on the file"': SCENARIO,
  'block 2 under "7. Try the rule on the file"': SCENARIO,
  'block 1 under "8. Ask the same question twice"': SCENARIO,
  'block 2 under "8. Ask the same question twice"': SCENARIO,
  'block 1 under "9. Fix the file"': SCENARIO,
  'block 1 under "10. Review the change"': SCENARIO,
  'block 2 under "10. Review the change"': SCENARIO,
  'block 1 under "11. Commit the verdicts"': SCENARIO,
  'block 1 under "12. Check as CI does"': SCENARIO,
  'block 2 under "12. Check as CI does"': SCENARIO,
};

export function words(line: string): string[] {
  return [...line.matchAll(/'([^']*)'|"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3]!);
}

export function gitCommands(repo: string, block: string): void {
  for (const argv of commands(block)) {
    assert.equal(argv[0], 'git', block);
    git(repo, ...argv.slice(1));
  }
}

export function commands(block: string): string[][] {
  const lines = block.split('\n').filter((line) => line !== '');
  assert.ok(lines.every((line) => line.startsWith('$ ')), `a command block holds commands alone:\n${block}`);
  return lines.map((line) => words(line.slice(2)));
}

export async function walk(page: Page, repo: string, heading: string, code: number, env: NodeJS.ProcessEnv = {}, block = 1): Promise<void> {
  const [argv, ...rest] = commands(page.text(`block ${block} under "${heading}"`));
  assert.equal(rest.length, 0, `${heading}: one command`);
  assert.equal(argv![0], 'lawcheck', heading);
  const run = await lawcheck(repo, argv!.slice(1), env);
  assert.deepEqual([run.code, run.stderr + run.stdout], [code, page.text(`block ${block + 1} under "${heading}"`) + '\n'], heading);
}

export async function scenario(page: Page): Promise<void> {
  const config = page.text('block 1 under "3. Choose a reviewer"');
  const read = parseConfig(config);
  assert.ok('config' in read && read.config.provider === 'ollama', config);
  const law = page.text('block 1 under "2. Put the rule in the law"') + '\n';
  const mainLaw = law.replace(/\nrules:\n {2}clear-errors:\n {4}why: .*\n/, '').replace('    rules: [clear-errors]\n', '');
  assert.equal(mainLaw, 'lawcheck: 0.1.0\n\ntypes:\n  library:\n    about: Code the commands call.\n    paths: ["src/core/**"]\n');
  await withFake(
    async (fake) => {
      const env = { LAWCHECK_REVIEWER_ENDPOINT: fake.base };
      await inTemp(async (dir) => {
        const repo = newRepository(dir, { '.lawcheck/law.yaml': mainLaw, '.lawcheck/.gitignore': '.local/\nconfig.local.yaml\n' });
        git(repo, 'checkout', '-q', '-b', 'work');
        write(repo, 'src/core/refund.ts', page.text('block 1 under "Write a reviewer rule"') + '\n');
        write(repo, '.lawcheck/rules/clear-errors.md', page.text('block 1 under "1. Write the rule file"') + '\n');
        write(repo, '.lawcheck/law.yaml', law);
        write(repo, '.lawcheck/config.yaml', config + '\n');

        const chats = () => fake.requests.filter((request) => request.path === '/api/chat').length;
        const [doctorArgv] = commands(page.text('block 1 under "4. Check that the reviewer answers"'));
        assert.deepEqual(doctorArgv, ['lawcheck', 'doctor', '--reviewer']);
        const doctor = await lawcheck(repo, doctorArgv!.slice(1), env);
        assert.equal(doctor.code, 0, doctor.stdout);
        assert.equal(doctor.stdout.trimEnd().split('\n').at(-1), page.text('block 2 under "4. Check that the reviewer answers"'), 'the last line of doctor');
        assert.equal(chats(), 1, 'doctor --reviewer sends one request');

        await walk(page, repo, '5. See what the change needs', 1, env);
        await walk(page, repo, '6. See the cost of a try', 0, env);
        assert.equal(chats(), 1, 'a plain check and a dry run call nobody');
        await walk(page, repo, '7. Try the rule on the file', 1, env);
        await walk(page, repo, '8. Ask the same question twice', 1, env);
        assert.equal(git(repo, 'status', '--short', '--untracked-files=all', '.lawcheck/verdicts', '.lawcheck/.local'), '', 'try records nothing');

        write(repo, 'src/core/refund.ts', page.text('block 1 under "9. Fix the file"') + '\n');
        await walk(page, repo, '10. Review the change', 0, env);
        const asked = chats();

        gitCommands(repo, page.text('block 1 under "11. Commit the verdicts"'));
        assert.equal(git(repo, 'status', '--short'), '', 'the commit holds every file of the change');
        await walk(page, repo, '12. Check as CI does', 0, {});
        assert.equal(chats(), asked, 'the plain check calls no model');
      });
    },
    (request) => (request.path === '/api/version' ? { body: '{"version":"0.12.6"}' } : ollama(defaultAnswer(request.prompt))),
  );
}

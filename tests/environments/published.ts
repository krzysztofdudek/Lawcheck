import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { blocksOf } from '../contract/docs-blocks.ts';

// The first steps of a new user with the lawcheck that npm installed globally: the version, the page of the quick start, and its five steps in a new repository. The page is the one inside the installed package, so the outputs it shows are those of the version that runs.
const [version] = process.argv.slice(2);
if (version === undefined) {
  console.error('usage: node tests/environments/published.ts <the version npm install --global lawcheck@<version> installed>');
  process.exit(2);
}

const COMMAND_MS = 60_000;
// A CI service sets variables that change what a check with no base does, and a new user at a terminal has none of them (decision 87 of design/decisions.md).
const env = { ...process.env };
for (const name of ['GITHUB_BASE_REF', 'CI_MERGE_REQUEST_TARGET_BRANCH_NAME', 'CI_COMMIT_BEFORE_SHA', 'SYSTEM_PULLREQUEST_TARGETBRANCH', 'CI', 'GITHUB_ACTIONS', 'GITLAB_CI', 'TF_BUILD', 'JENKINS_URL', 'BUILDKITE', 'CIRCLECI', 'TRAVIS', 'BITBUCKET_BUILD_NUMBER', 'TEAMCITY_VERSION', 'APPVEYOR', 'DRONE', 'CODEBUILD_BUILD_ID', 'BUILD_ID', 'WOODPECKER', 'LAWCHECK_BASE']) delete env[name];
const problems: string[] = [];
function same(what: string, found: unknown, expected: unknown): void {
  const ok = JSON.stringify(found) === JSON.stringify(expected);
  console.log(`${ok ? 'ok ' : 'RED'}  ${what}${ok ? '' : `: ${JSON.stringify(found)}, expected ${JSON.stringify(expected)}`}`);
  if (!ok) problems.push(what);
}

// A user types the name, and on Windows npm installs lawcheck as a .cmd file, which only a shell starts by its name.
function run(command: string, cwd: string, print = true): { code: number | null; stdout: string; stderr: string } {
  console.log(`\n$ ${command}`);
  const done = spawnSync(command, { cwd, env, shell: true, encoding: 'utf8', timeout: COMMAND_MS });
  if (done.error) throw new Error(`${command} could not run: ${done.error.message}`);
  if (print) process.stdout.write(done.stdout);
  process.stderr.write(done.stderr);
  return { code: done.status, stdout: done.stdout.replace(/\r\n/g, '\n'), stderr: done.stderr };
}

const home = mkdtempSync(join(tmpdir(), 'lawcheck-published-'));
try {
  const root = run('npm root --global', home).stdout.trim();
  const packed = JSON.parse(readFileSync(join(root, 'lawcheck', 'package.json'), 'utf8')) as { version: string };
  same(`npm holds lawcheck ${version} globally`, packed.version, version);
  const blocks = new Map(blocksOf(readFileSync(join(root, 'lawcheck', 'docs', 'quick-start.md'), 'utf8').replace(/\r\n/g, '\n')).map((block) => [block.key, block.text]));
  const block = (key: string): string => {
    const text = blocks.get(key);
    if (text === undefined) throw new Error(`docs/quick-start.md of the installed package has no ${key}`);
    return text;
  };
  const write = (repo: string, path: string, text: string): void => {
    mkdirSync(dirname(join(repo, path)), { recursive: true });
    writeFileSync(join(repo, path), text);
  };
  const step = (repo: string, what: string, command: string, output: string, code: number): void => {
    const done = run(command.replace(/^\$ /, ''), repo);
    same(`${what}: exit ${code}`, done.code, code);
    same(`${what}: the output the page shows`, done.stdout, output + '\n');
    same(`${what}: nothing on standard error`, done.stderr, '');
  };

  const shown = run('lawcheck --version', home);
  same('lawcheck --version prints the version', [shown.code, shown.stdout], [0, `${version}\n`]);
  const page = run('lawcheck docs quick-start', home, false);
  same('lawcheck docs quick-start prints the page', [page.code, page.stdout.startsWith('# Quick start\n')], [0, true]);

  same('git init shop', run('git init shop', home).code, 0);
  const repo = join(home, 'shop');
  write(repo, 'src/cli/print.ts', block('block 3 under "Quick start"') + '\n');
  step(repo, 'step 1, lawcheck init', block('block 1 under "1. Start the law"'), block('block 2 under "1. Start the law"'), 0);
  write(repo, '.lawcheck/law.yaml', block('block 1 under "3. Add one may_use line"') + '\n');
  write(repo, 'src/core/receipt.ts', block('block 1 under "4. Write a file that breaks it"') + '\n');
  step(repo, 'step 5, lawcheck check', block('block 1 under "5. Check"'), block('block 2 under "5. Check"'), 1);
} finally {
  rmSync(home, { recursive: true, force: true, maxRetries: 10 });
}

if (problems.length > 0) {
  console.error(`\nlawcheck ${version} from npm fails the first steps: ${problems.join('; ')}`);
  process.exit(1);
}
console.log(`\nlawcheck ${version} from npm passes the first steps`);

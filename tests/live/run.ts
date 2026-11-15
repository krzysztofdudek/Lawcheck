import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { startTool } from '../harness/start.ts';
import { ATTACKS, attackText, twin } from '../security/attacks.ts';
import { LIVE_FAIL_SHARE, LIVE_SAME_SHARE, LIVE_TIMES } from '../numbers.ts';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const OUT = process.env.LAWCHECK_LIVE_OUT ?? join(ROOT, 'tests', 'live', 'result.json');
const ENV = { ...process.env, GIT_AUTHOR_NAME: 'Test', GIT_AUTHOR_EMAIL: 'test@example.com', GIT_COMMITTER_NAME: 'Test', GIT_COMMITTER_EMAIL: 'test@example.com', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null' };
for (const name of ['LAWCHECK_BASE', 'LAWCHECK_REVIEWER_ENDPOINT', 'LAWCHECK_REVIEWER_KEY', 'ANTHROPIC_API_KEY']) delete ENV[name];

function git(cwd: string, ...args: string[]): void {
  const result = spawnSync('git', args, { cwd, env: ENV, stdio: 'ignore' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed`);
}

interface Tried {
  verdicts: string[];
  calls: number;
  error: string | null;
}

// One try of the attack text as src/core/attack.ts in the reviewer sample R, with the claude-code provider and the program's default model.
async function tryText(text: string): Promise<Tried> {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-live-'));
  try {
    const r = join(dir, 'r');
    mkdirSync(r);
    cpSync(join(ROOT, 'tests', 'sample'), r, { recursive: true });
    cpSync(join(ROOT, 'tests', 'reviewer-sample'), r, { recursive: true });
    writeFileSync(join(r, '.lawcheck', 'config.yaml'), 'reviewer:\n  provider: claude-code\n');
    git(r, 'init', '-q', '-b', 'main');
    git(r, 'add', '-A');
    git(r, 'commit', '-q', '-m', 'R');
    writeFileSync(join(r, 'src', 'core', 'attack.ts'), text);
    const run = await startTool(r, ['try', 'clear-errors', 'src/core/attack.ts', '--times', String(LIVE_TIMES), '--max-calls', String(LIVE_TIMES * 2), '--json'], ENV, { budget: 'LIVE_RUN_BUDGET_MS', stderr: /reviewer call/ }).ended;
    const document = JSON.parse(run.stdout);
    if (document.schema === 'lawcheck-error/1') return { verdicts: [], calls: 0, error: document.errors.map((e: { code: string; message: string }) => `${e.code}: ${e.message}`).join('; ') };
    return { verdicts: document.runs.map((run: { verdict: string }) => run.verdict), calls: document.summary.calls_made, error: null };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const cases = [];
let calls = 0;
let pairs = 0;
let same = 0;
let verdicts = 0;
let fails = 0;
for (const attack of ATTACKS) {
  const text = attackText(attack);
  const attacked = await tryText(text);
  const twinned = await tryText(twin(text, attack.separator));
  calls += attacked.calls + twinned.calls;
  for (let i = 0; i < LIVE_TIMES; i++) {
    pairs++;
    if (attacked.verdicts[i] !== undefined && attacked.verdicts[i] === twinned.verdicts[i]) same++;
  }
  for (const verdict of [...attacked.verdicts, ...twinned.verdicts]) {
    verdicts++;
    if (verdict === 'fail') fails++;
  }
  cases.push({ file: attack.file, separator: JSON.stringify(attack.separator), attack: attacked, twin: twinned });
  process.stderr.write(`${attack.file}: attack ${attacked.verdicts.join(' ') || attacked.error}; twin ${twinned.verdicts.join(' ') || twinned.error}\n`);
}
const sameShare = same / pairs;
const failShare = verdicts === 0 ? 0 : fails / (ATTACKS.length * 2 * LIVE_TIMES);
const version = spawnSync('claude', ['--version'], { encoding: 'utf8' }).stdout.trim();
const result = {
  schema: 'lawcheck-attacks/1',
  date: new Date().toISOString().slice(0, 10),
  lawcheck: JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version,
  verdict_format: 'lawcheck-verdict/2',
  provider: 'claude-code',
  program: version,
  model: null,
  times: LIVE_TIMES,
  line: { same_share: LIVE_SAME_SHARE, fail_share: LIVE_FAIL_SHARE },
  calls,
  pairs,
  same_share: sameShare,
  fail_share: failShare,
  held: sameShare >= LIVE_SAME_SHARE && failShare >= LIVE_FAIL_SHARE,
  cases,
};
writeFileSync(OUT, JSON.stringify(result, null, 2) + '\n');
process.stdout.write(`calls ${calls}, same ${same} of ${pairs}, fail ${fails} of ${ATTACKS.length * 2 * LIVE_TIMES}: ${result.held ? 'held' : 'did not hold'}\n`);
process.exit(result.held ? 0 : 1);

import { spawnSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SHIM = fileURLToPath(new URL('../harness/agent-shim.mjs', import.meta.url));
const args = process.argv.slice(2);

function hookEvent() {
  try {
    const words = readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8').split('\0');
    const at = words.findIndex((word) => word.endsWith('lawcheck-hook.mjs'));
    if (at >= 0) return words[at + 1] ?? 'hook';
  } catch {}
  return null;
}

const event = hookEvent();
if (event === null) {
  const result = spawnSync(process.execPath, [SHIM, ...args], { stdio: 'inherit' });
  process.exit(result.status ?? 2);
}
const file = args.find((arg) => arg.startsWith('./'))?.slice(2) ?? 'src/core/price.ts';
const count = process.env.LAWCHECK_TRIAL_LOG && existsSync(process.env.LAWCHECK_TRIAL_LOG) ? readFileSync(process.env.LAWCHECK_TRIAL_LOG, 'utf8').split('\n').filter((line) => line.includes(`"caller":"${event}"`)).length + 1 : 1;
const error = `${file}:1  error[trial-limit]  this stand-in of the trial fails every check of a hook (call ${count})`;
if (process.env.LAWCHECK_TRIAL_LOG) appendFileSync(process.env.LAWCHECK_TRIAL_LOG, JSON.stringify({ caller: event, args, exit: 1, errors: [error] }) + '\n');
process.stdout.write(['lawcheck: FAIL  1 error in 1 named file', '', error, '', `next: fix ${file}:1`, ''].join('\n'));
process.exit(1);

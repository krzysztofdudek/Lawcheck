import { spawnSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const CLI = fileURLToPath(new URL('../../dist/cli.js', import.meta.url));
const args = process.argv.slice(2);

function callerOf() {
  try {
    const words = readFileSync(`/proc/${process.ppid}/cmdline`, 'utf8').split('\0');
    const at = words.findIndex((word) => word.endsWith('lawcheck-hook.mjs'));
    if (at >= 0) return words[at + 1] ?? 'hook';
  } catch {}
  return 'agent';
}

function errorsOf(stdout) {
  if (args.includes('--json')) {
    try {
      const document = JSON.parse(stdout);
      return (document.findings ?? [])
        .filter((finding) => finding.severity === 'error')
        .map((finding) => `${finding.file}${finding.line === undefined ? '' : `:${finding.line}`}  error[${finding.code}]  ${finding.message}`);
    } catch {
      return [];
    }
  }
  return stdout.split('\n').filter((line) => line.includes('  error['));
}

const result = spawnSync(process.execPath, [CLI, ...args], { stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 1 << 30 });
const stdout = result.stdout?.toString('utf8') ?? '';
const exit = result.status ?? 2;
if (process.env.LAWCHECK_TRIAL_LOG) {
  appendFileSync(process.env.LAWCHECK_TRIAL_LOG, JSON.stringify({ caller: callerOf(), args, exit, errors: errorsOf(stdout) }) + '\n');
}
process.stdout.write(result.stdout ?? '');
process.stderr.write(result.stderr ?? '');
process.exitCode = exit;

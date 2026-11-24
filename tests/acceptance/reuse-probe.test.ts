import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { platformSkip } from '../harness/tool.ts';

function affinity(mask?: number): number {
  const set = mask === undefined ? '' : `$p.ProcessorAffinity = [IntPtr]${mask}; `;
  const out = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `$p = Get-Process -Id ${process.pid}; ${set}[int64]$p.ProcessorAffinity`], { encoding: 'utf8', windowsHide: true });
  return Number(out.stdout.trim());
}

function once(program: string, args: string[]): Promise<number> {
  return new Promise((done) => {
    const child = spawn(program, args, { stdio: 'ignore', windowsHide: true });
    child.on('close', () => done(child.pid!));
    child.on('error', () => done(-1));
  });
}

async function spin(ms: number): Promise<number[]> {
  const pids: number[] = [];
  const end = Date.now() + ms;
  while (Date.now() < end) pids.push(await once(process.env.ComSpec ?? 'cmd.exe', ['/d', '/c', 'exit']));
  return pids;
}

function stats(pids: number[]): string {
  const seen = new Map<number, number>();
  const lags: number[] = [];
  let reused = 0;
  let adjacent = 0;
  pids.forEach((pid, i) => {
    if (i > 0 && pids[i - 1] === pid) adjacent++;
    if (seen.has(pid)) {
      reused++;
      lags.push(i - seen.get(pid)!);
    }
    seen.set(pid, i);
  });
  lags.sort((a, b) => a - b);
  const q = (f: number) => (lags.length === 0 ? '-' : lags[Math.floor(f * (lags.length - 1))]);
  return `n ${pids.length} distinct ${seen.size} reused ${reused} adjacent ${adjacent} lag min ${q(0)} p25 ${q(0.25)} med ${q(0.5)} p75 ${q(0.75)} max ${q(1)} first ${pids.slice(0, 12).join(',')} last ${pids.slice(-12).join(',')}`;
}

test('test 1171: probe of how Windows gives ids back (one CI run)', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  const lines: string[] = [];
  const original = affinity();
  lines.push(`cpus mask ${original}`);
  lines.push(`unpinned ${stats(await spin(12_000))}`);
  affinity(1);
  lines.push(`pinned-1 ${stats(await spin(12_000))}`);
  lines.push(`pinned-1 again ${stats(await spin(12_000))}`);
  affinity(original);
  assert.fail(lines.join('\n'));
});

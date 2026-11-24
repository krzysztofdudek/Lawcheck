import { realpathSync as realMain } from 'node:fs';
import { resolve as resolvePath } from 'node:path';
import { judge, loadConfig, render } from './guard.ts';

const USAGE = 'usage: node tests/guard/cli.ts [--repo <dir>] [--base <rev>] [--head <rev>] [--json]';

export function parse(argv: string[]): { repo: string; base: string; head: string; json: boolean } | string {
  const out = { repo: process.cwd(), base: 'main', head: 'HEAD', json: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === '--json') { out.json = true; continue; }
    if (arg === '--repo' || arg === '--base' || arg === '--head') {
      const value = argv[++i];
      if (!value) return `${arg} needs a value`;
      out[arg.slice(2) as 'repo' | 'base' | 'head'] = value;
      continue;
    }
    return `unknown argument '${arg}'`;
  }
  out.repo = resolvePath(out.repo);
  return out;
}

if (process.argv[1] !== undefined && realMain(process.argv[1]) === import.meta.filename) {
  const args = parse(process.argv.slice(2));
  if (typeof args === 'string') {
    process.stderr.write(`suite guard: ${args}\n${USAGE}\n`);
    process.exit(2);
  }
  try {
    const report = judge(args.repo, args.base, args.head, loadConfig());
    process.stdout.write(args.json ? `${JSON.stringify(report, null, 2)}\n` : render(report));
    process.exitCode = report.passed ? 0 : 1;
  } catch (error) {
    process.stderr.write(`suite guard: could not run: ${(error as Error).message}\n`);
    process.exitCode = 2;
  }
}

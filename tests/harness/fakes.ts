import { CLI } from './start.ts';

// The lines of a stand-in for an installed lawcheck: a program on the PATH that logs how it was called and runs the built tool. A hook starts it, and the harness checks that hook's run.
export function installedLawcheck(log: string): string[] {
  return [
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd() }) + '\\n');`,
    `const r = spawnSync(process.execPath, [${JSON.stringify(CLI)}, ...process.argv.slice(2)], { stdio: ['ignore', 'inherit', 'inherit'] });`,
    'process.exit(r.status ?? 2);',
  ];
}

// The lines of a stand-in for a package runner (npx, pnpm, bun, yarn) that logs its words and runs the given lawcheck with the words after the runner's own.
export function packageRunner(log: string, name: string, skip: number, lawcheck: string, yarn = false): string[] {
  return [
    `appendFileSync(${JSON.stringify(log)}, JSON.stringify({ runner: ${JSON.stringify(name)}, args: process.argv.slice(2) }) + '\\n');`,
    ...(yarn ? ["process.stdout.write('yarn run v1.22.22\\n$ /x/node_modules/.bin/lawcheck\\n');"] : []),
    `const r = spawnSync(process.execPath, [${JSON.stringify(lawcheck)}, ...process.argv.slice(${2 + skip})], { stdio: ['ignore', 'pipe', 'inherit'] });`,
    'process.stdout.write(r.stdout);',
    ...(yarn ? ["process.stdout.write('Done in 0.10s.\\n');"] : []),
    'process.exit(r.status ?? 2);',
  ];
}

import { KINDS } from './ci-cell.ts';
import type { Kind } from './ci-cell.ts';
import { scenarios } from './ci-scenarios.ts';

const [kind, tarball] = process.argv.slice(2);
if (!KINDS.includes(kind as Kind) || tarball === undefined) {
  process.stdout.write(`cell: could not run: usage: ci-cell-main.ts <${KINDS.join('|')}> <lawcheck.tgz>\n`);
  process.exit(3);
}
let failed = false;
for (const outcome of scenarios(kind as Kind, tarball)) {
  if (outcome.problems.length === 0) process.stdout.write(`cell: ok ${outcome.name}\n`);
  else {
    failed = true;
    process.stdout.write(`cell: fail ${outcome.name}\n`);
    for (const problem of outcome.problems) process.stdout.write(`cell:   ${problem.split('\n').join('\ncell:   ')}\n`);
  }
}
process.stdout.write('cell: done\n');
process.exit(failed ? 1 : 0);

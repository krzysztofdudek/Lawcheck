import { copyFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildGrammars } from '@chrisdudek/runes/grammars';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const OUT = join(ROOT, 'dist', 'grammars');
const ONLY = ['typescript', 'tsx', 'javascript', 'python', 'go', 'rust', 'java', 'kotlin', 'csharp', 'c', 'cpp', 'php', 'ruby'];

try {
  await buildGrammars({
    outDir: OUT,
    only: ONLY,
    resolveFrom: ROOT,
    cacheDir: join(ROOT, '.grammars'),
    offline: process.argv.slice(2).includes('--offline'),
  });
  copyFileSync(join(ROOT, 'scripts', 'grammar-licenses.txt'), join(OUT, 'LICENSES.txt'));
} catch (error) {
  process.stderr.write(`grammars: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
}

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardProblems, pngProblems } from './theme/card.mjs';

export function problems(dir, card) {
  const out = pngProblems(readFileSync(card));
  const pages = readdirSync(dir, { recursive: true, encoding: 'utf8' })
    .filter((name) => name.endsWith('.html'))
    .filter((name) => readFileSync(join(dir, name), 'utf8').includes('<meta property="og:url"'));
  if (pages.length === 0) out.push(`${dir} has no page with an og:url`);
  for (const name of pages) out.push(...cardProblems(readFileSync(join(dir, name), 'utf8'), name));
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [dir, card] = process.argv.slice(2);
  if (!existsSync(dir) || !existsSync(card)) throw new Error(`usage: node site/check-docs-card.mjs <built docs folder> <og.png>`);
  const found = problems(dir, card);
  if (found.length > 0) {
    console.log(`docs card: FAIL  ${found.length} problems in ${dir}`);
    for (const problem of found) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log(`docs card: PASS  every page of ${dir} with an og:url names the card, and ${card} is a valid card`);
}

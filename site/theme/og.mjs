import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { css } from '../../brand/css.mjs';

export const WIDTH = 1200;
export const HEIGHT = 630;
export const CATEGORY = 'Architecture and rule checks for coding agents';
export const FINDING = { place: 'src/core/discount.ts:1', code: 'error[forbidden-use]', text: 'core may not use api (src/api/orders.ts); its may_use is [core]' };

const mark = (file) => readFileSync(file, 'utf8').replace('<svg ', '<svg class="mark" ').replace('currentColor', 'var(--lc-brand)');

export function og(tokens, { interFont, monoFont, markFile }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<style>
@font-face { font-family: "Inter"; font-weight: 100 900; src: url("${pathToFileURL(interFont)}") format("woff2"); }
@font-face { font-family: "JetBrains Mono"; font-weight: 100 800; src: url("${pathToFileURL(monoFont)}") format("woff2"); }
${css(tokens)}
* { box-sizing: border-box; margin: 0; }
body { width: ${WIDTH}px; height: ${HEIGHT}px; padding: 72px 80px; display: flex; flex-direction: column; justify-content: space-between; background: var(--lc-ground); color: var(--lc-text); font-family: var(--lc-font-sans); }
.lockup { display: flex; align-items: center; gap: 24px; font-size: 52px; font-weight: 700; line-height: 1; }
.mark { height: 72px; width: auto; }
.category { font-size: 72px; font-weight: 700; line-height: 1.1; letter-spacing: -0.02em; max-width: 960px; }
.finding { background: var(--lc-code); border: 2px solid var(--lc-line-lit); border-radius: var(--lc-radius-frame); padding: 28px 36px; font-family: var(--lc-font-mono); font-size: 32px; line-height: 1.5; }
.finding p { white-space: pre-wrap; text-wrap: balance; }
.fail { color: var(--lc-fail); }
.muted { color: var(--lc-text-muted); }
</style>
</head>
<body>
<div class="lockup">${mark(markFile)}<span>Lawcheck</span></div>
<div class="category">${CATEGORY}</div>
<div class="finding"><p>${FINDING.place}  <span class="fail">${FINDING.code}</span></p><p class="muted">${FINDING.text}</p></div>
</body>
</html>
`;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [interFont, monoFont] = process.argv.slice(2);
  const tokens = JSON.parse(readFileSync(new URL('../../brand/tokens.json', import.meta.url), 'utf8'));
  process.stdout.write(og(tokens, { interFont, monoFont, markFile: new URL('../../brand/mark.svg', import.meta.url) }));
}

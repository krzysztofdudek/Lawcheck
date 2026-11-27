import { createServer } from 'node:http';
import { mkdirSync, readFileSync, existsSync, statSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { PHONE_WIDTHS } from './check.mjs';

// 586 px is what a 440 px phone shows with Safari's page zoom at 75 %.
const WIDTHS = [...PHONE_WIDTHS, 430, 586];

const TYPES = { '.jpg': 'image/jpeg', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff2': 'font/woff2', '.json': 'application/json', '.txt': 'text/plain', '.xml': 'application/xml' };

export function serve(dir) {
  const server = createServer((request, response) => {
    const path = decodeURIComponent(new URL(request.url, 'http://x').pathname);
    let file = join(dir, path === '/' ? 'index.html' : path);
    if (!file.startsWith(dir) || !existsSync(file) || statSync(file).isDirectory()) file = join(dir, '404.html');
    response.writeHead(file.endsWith('404.html') && path !== '/404.html' ? 404 : 200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream' });
    response.end(readFileSync(file));
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

function inPage() {
  const describe = (element) => `${element.tagName.toLowerCase()}${element.className && typeof element.className === 'string' ? `.${element.className.trim().split(/\s+/).join('.')}` : ''}`;
  const out = [];
  const width = document.documentElement.clientWidth;
  if (document.documentElement.scrollWidth > width) out.push(`the page scrolls sideways: ${document.documentElement.scrollWidth} px of content in ${width} px`);
  const inScroller = (element) => {
    for (let parent = element.parentElement; parent; parent = parent.parentElement) {
      const overflow = getComputedStyle(parent).overflowX;
      if (overflow !== 'visible' && parent.scrollWidth > parent.clientWidth + 1) return true;
    }
    return false;
  };
  for (const element of document.querySelectorAll('body *')) {
    const style = getComputedStyle(element);
    if (style.display === 'none' || element.closest('.visually-hidden, .skip')) continue;
    const box = element.getBoundingClientRect();
    if (box.width > 0 && box.right > width + 1 && !inScroller(element)) out.push(`${describe(element)} ends at ${Math.round(box.right)} px, past the ${width} px screen`);
    if (style.display === 'grid' || style.display === 'inline-grid') {
      const columns = style.gridTemplateColumns.split(' ').length;
      if (columns > 1) out.push(`${describe(element)} is a grid of ${columns} columns`);
    }
    if (style.overflowX !== 'visible' && element.scrollWidth > element.clientWidth + 1) {
      const cue = element.tabIndex >= 0 && style.backgroundImage !== 'none' && style.overflowX !== 'hidden';
      const law = element.closest('.law-lines');
      if (law) out.push(`${describe(element)} hides part of the law: ${element.scrollWidth} px of lines in ${element.clientWidth} px`);
      else if (!cue) out.push(`${describe(element)} hides ${element.scrollWidth - element.clientWidth} px of its content with no way to scroll it that shows`);
    }
  }
  const blocks = [...document.querySelectorAll('#law pre')].map((block) => block.getBoundingClientRect());
  for (let a = 0; a < blocks.length; a++) for (let b = a + 1; b < blocks.length; b++) if (blocks[a].top < blocks[b].bottom && blocks[b].top < blocks[a].bottom) out.push('the law and the finding stand side by side');
  return out;
}

export async function measure(dir, { shots } = {}) {
  let chromium;
  try {
    ({ chromium } = await import('playwright'));
  } catch {
    throw new Error('phone.mjs needs the playwright package and its Chromium, for example in the Playwright container image');
  }
  const server = await serve(dir);
  const browser = await chromium.launch();
  const out = [];
  try {
    for (const scheme of ['dark', 'light']) {
      for (const width of WIDTHS) {
        const context = await browser.newContext({ viewport: { width, height: 800 }, colorScheme: scheme, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
        const page = await context.newPage();
        await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: 'load' });
        await page.evaluate(() => document.fonts.ready);
        for (const found of await page.evaluate(inPage)) out.push(`${scheme}, ${width} px: ${found}`);
        if (shots) {
          mkdirSync(shots, { recursive: true });
          await page.screenshot({ path: join(shots, `${scheme} ${width}.png`), fullPage: true });
        }
        await context.close();
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir, shots] = process.argv.slice(2);
  const found = await measure(resolve(dir), { shots });
  if (found.length > 0) {
    console.log(`phone: FAIL  ${found.length} problems in ${dir}`);
    for (const problem of found) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log(`phone: PASS  ${dir} does not scroll sideways, keeps no grid of more than one column, hides no line of the law, and sets no two panes of the law side by side at ${WIDTHS.join(', ')} px in both color schemes`);
}

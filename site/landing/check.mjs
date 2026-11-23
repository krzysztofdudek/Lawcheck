import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cardProblems, pngProblems } from '../theme/card.mjs';

const CANONICAL = 'https://lawcheck.dev/';

const metaOf = (html, attribute, name) => [...html.matchAll(new RegExp(`<meta ${attribute}="${name}" content="([^"]*)"`, 'g'))].map((match) => match[1]);
const count = (html, pattern) => (html.match(pattern) ?? []).length;
const decode = (text) => text.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

export function problems(dir, version) {
  const out = [];
  const read = (name) => (existsSync(join(dir, name)) ? readFileSync(join(dir, name), 'utf8') : null);
  const index = read('index.html');
  if (index === null) return ['index.html is missing'];

  if (count(index, /<h1[\s>]/g) !== 1) out.push(`index.html has ${count(index, /<h1[\s>]/g)} h1 elements, not one`);
  const title = decode(/<title>([^<]*)<\/title>/.exec(index)?.[1] ?? '');
  if (!/^Lawcheck\b/.test(title) || !/architecture checks for coding agents/i.test(title) || title.length > 60) out.push(`the title "${title}" does not start with Lawcheck, lacks the category or is over 60 characters`);
  const description = decode(metaOf(index, 'name', 'description')[0] ?? '');
  if (description.length < 70 || description.length > 160) out.push(`the description has ${description.length} characters, outside 70 to 160`);
  const canonical = [...index.matchAll(/<link rel="canonical" href="([^"]*)"/g)].map((match) => match[1]);
  if (canonical.length !== 1 || canonical[0] !== CANONICAL) out.push(`the canonical address is ${JSON.stringify(canonical)}, not ${CANONICAL} once`);
  for (const property of ['og:title', 'og:description', 'og:type', 'og:site_name', 'og:url']) if (metaOf(index, 'property', property).length !== 1) out.push(`${property} is not there once`);
  if (metaOf(index, 'property', 'og:url')[0] !== CANONICAL) out.push(`og:url is not ${CANONICAL}`);
  out.push(...cardProblems(index, 'index.html'));
  const card = existsSync(join(dir, 'og.png')) ? readFileSync(join(dir, 'og.png')) : null;
  if (card === null) out.push('og.png is missing');
  else out.push(...pngProblems(card));
  if (/noindex/i.test(index)) out.push('index.html says noindex');
  if (!index.includes(`>${version}<`)) out.push(`index.html does not show the version ${version}`);

  const blocks = [...index.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].map((match) => match[1]);
  if (blocks.length !== 1) out.push(`index.html has ${blocks.length} JSON-LD blocks, not one`);
  else {
    try {
      const graph = JSON.parse(blocks[0])['@graph'] ?? [];
      const types = graph.map((node) => node['@type']);
      if (!types.includes('WebSite') || !types.includes('SoftwareApplication')) out.push(`the JSON-LD has the types ${JSON.stringify(types)}, without WebSite or SoftwareApplication`);
      const application = graph.find((node) => node['@type'] === 'SoftwareApplication') ?? {};
      if (application.softwareVersion !== version) out.push(`the JSON-LD names the version ${application.softwareVersion}, not ${version}`);
      if (/aggregateRating|"review"/.test(blocks[0])) out.push('the JSON-LD holds a rating or a review');
    } catch (error) {
      out.push(`the JSON-LD does not parse: ${error.message}`);
    }
  }

  const missing = read('404.html');
  if (missing === null) out.push('404.html is missing');
  else {
    if (count(missing, /<h1[\s>]/g) !== 1) out.push('404.html has no single h1');
    if (!missing.includes('href="/"')) out.push('404.html has no link to /');
    if (/<script type="module"/.test(missing)) out.push('404.html loads the app, which would replace its text');
  }
  if (!(read('robots.txt') ?? '').includes(`Sitemap: ${CANONICAL}sitemap.xml`)) out.push('robots.txt does not name the sitemap');
  if (!(read('sitemap.xml') ?? '').includes(`<loc>${CANONICAL}</loc>`)) out.push(`sitemap.xml does not hold ${CANONICAL}`);
  try {
    const vercel = JSON.parse(read('vercel.json') ?? '');
    if (!vercel.redirects?.some((redirect) => redirect.destination?.startsWith('https://docs.lawcheck.dev/'))) out.push('vercel.json has no redirect to docs.lawcheck.dev');
  } catch {
    out.push('vercel.json is missing or does not parse');
  }
  return out;
}

export const PHONE_WIDTHS = [320, 360, 390];

function ruleList(css) {
  const rules = [];
  const walk = (text, inside) => {
    let at = 0;
    while (at < text.length) {
      const open = text.indexOf('{', at);
      if (open === -1) break;
      let depth = 1;
      let end = open + 1;
      while (end < text.length && depth > 0) {
        if (text[end] === '{') depth++;
        else if (text[end] === '}') depth--;
        end++;
      }
      const head = text.slice(at, open).trim();
      const body = text.slice(open + 1, end - 1);
      if (head.startsWith('@media')) {
        const max = /max-width\s*:\s*(\d+)px/.exec(head);
        const min = /min-width\s*:\s*(\d+)px/.exec(head);
        walk(body, { max: Math.min(inside.max, max ? Number(max[1]) : Infinity), min: Math.max(inside.min, min ? Number(min[1]) : 0) });
      } else if (!head.startsWith('@')) rules.push({ selectors: head.split(',').map((selector) => selector.trim()), body, ...inside });
      at = end;
    }
  };
  walk(css.replace(/\/\*[\s\S]*?\*\//g, ''), { max: Infinity, min: 0 });
  return rules;
}

function trackCount(value) {
  let tracks = 0;
  let depth = 0;
  let word = false;
  for (const char of value.trim()) {
    if (char === '(') depth++;
    if (char === ')') depth--;
    if (/\s/.test(char) && depth === 0) word = false;
    else if (!word) {
      word = true;
      tracks++;
    }
  }
  const repeated = /^repeat\(\s*(\d+)\s*,/.exec(value.trim());
  return repeated ? Number(repeated[1]) : tracks;
}

export function phoneProblems(dir) {
  const assets = join(dir, 'assets');
  const sheets = existsSync(assets) ? readdirSync(assets).filter((name) => name.endsWith('.css')) : [];
  if (sheets.length === 0) return ['assets has no stylesheet'];
  const rules = sheets.flatMap((name) => ruleList(readFileSync(join(assets, name), 'utf8')));
  const out = [];
  for (const width of PHONE_WIDTHS) {
    const columns = new Map();
    for (const rule of rules) {
      if (width > rule.max || width < rule.min) continue;
      const value = /(?:^|;)\s*grid-template-columns\s*:\s*([^;]+)/.exec(rule.body)?.[1];
      if (value !== undefined) for (const selector of rule.selectors) columns.set(selector, value.trim());
    }
    for (const [selector, value] of columns) if (trackCount(value) > 1) out.push(`at ${width} px ${selector} keeps ${trackCount(value)} columns (${value}), so its blocks stand side by side on a phone`);
  }
  return out;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [dir, manifest] = process.argv.slice(2);
  const { version } = JSON.parse(readFileSync(manifest, 'utf8'));
  const found = [...problems(dir, version), ...phoneProblems(dir)];
  if (found.length > 0) {
    console.log(`landing: FAIL  ${found.length} problems in ${dir}`);
    for (const problem of found) console.log(`  ${problem}`);
    process.exit(1);
  }
  console.log(`landing: PASS  ${dir} has one h1, its title, description, canonical address, Open Graph and its card, JSON-LD for ${version}, a 404 page, robots.txt, sitemap.xml and vercel.json, and no grid of more than one column at ${PHONE_WIDTHS.join(', ')} px`);
}

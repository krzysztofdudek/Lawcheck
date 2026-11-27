import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { ROOT } from '../harness/sets.ts';
import { codeTheme } from '../../brand/code-theme.mjs';
import { css } from '../../brand/css.mjs';
import { colorsIn, colorsOutside, contrast, pairProblems, pairsOf } from './brand-colors.ts';
import type { Tokens } from './brand-colors.ts';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const tokens = JSON.parse(read('brand/tokens.json')) as Tokens;
const values = new Set([...Object.values(tokens.colors.dusk), ...Object.values(tokens.colors.paper)].map((value) => value.toLowerCase()));
const hexes = (text: string): string[] => (text.match(/#[0-9a-fA-F]{6}\b/g) ?? []).map((hex) => hex.toLowerCase());
const withText = (replaced: string): Tokens => ({ ...tokens, colors: { ...tokens.colors, dusk: { ...tokens.colors.dusk, text: replaced } } });

test('test 741: every contrast pair of brand/tokens.json reaches its minimum, and every color that carries text or a boundary stands in a pair', () => {
  const pairs = pairsOf(tokens);
  assert.ok(pairs.length >= 40, `${pairs.length} pairs`);
  assert.deepEqual(pairProblems(tokens), []);
  for (const pair of pairs) assert.ok(contrast(tokens.colors[pair.mode][pair.foreground]!, tokens.colors[pair.mode][pair.background]!) >= pair.minimum, `${pair.mode}: ${pair.foreground} on ${pair.background}`);
});

test('test 741: control, a text color that is too dark for its surface, a pair that names a missing color and a color in no pair are each caught', () => {
  assert.deepEqual(pairProblems(withText('#3A3A3A')).slice(0, 1), ['dusk: text on ground: 1.73, below 4.5']);
  assert.ok(pairProblems({ ...tokens, contrast: [...tokens.contrast, { mode: 'paper', foreground: 'code', on: ['ground'], minimum: 4.5 }] }).includes('paper: code on ground: a color the mode does not have'));
  assert.deepEqual(pairProblems({ ...tokens, colors: { ...tokens.colors, paper: { ...tokens.colors.paper, accent: '#123456' } } }), ['paper: accent is in no pair as the color on a surface']);
  assert.equal(contrast('#000000', '#FFFFFF'), 21);
});

test('test 741: the syntax colors and the terminal colors name colors of dusk that reach 4.5 on the code surface', () => {
  const onCode = new Set(pairsOf(tokens).filter((pair) => pair.mode === 'dusk' && pair.background === 'code' && pair.minimum >= 4.5).map((pair) => pair.foreground));
  for (const [name, role] of [...Object.entries(tokens.syntax), ...Object.entries(tokens.terminal)]) assert.ok(onCode.has(role), `${name} is ${role}, which has no pair of 4.5 on code`);
  assert.equal(tokens.terminal.red, 'fail');
  assert.equal(tokens.terminal.green, 'proof');
});

test('test 741: no file of site/ or film/ holds a color value, and a planted one of each shape is found (control)', () => {
  assert.deepEqual(colorsOutside(ROOT, ['site', 'film']), []);
  const root = mkdtempSync(join(tmpdir(), 'lawcheck-brand-'));
  try {
    const planted: Record<string, string> = {
      'site/a.css': 'a { color: #f8d794; }\nb { border: 1px solid red; }\nc { background: rgb(1 2 3); }\nd { outline: 1px solid color(display-p3 1 0 0); }',
      'site/b.vue': '<svg fill="white"></svg>\n<p style="color:#fff">x</p>',
      'film/c.mjs': "export const gold = '#F8D794';",
      'film/d.md': 'Text with <span style="color: tomato">a name</span> and issue #1234.',
    };
    const clean: Record<string, string> = {
      'site/e.css': 'a { color: var(--lc-text); border: 1px solid var(--lc-line-strong); fill: currentColor; background: transparent; border-radius: 8px; }',
      'site/f.md': 'See [the film](/#film) and issue #1234, &#123; and ![x](gold.png).',
      'site/node_modules/g.css': 'a { color: red; }',
      'film/pilot.json': '{"hash": "4ad480da8bdcbeff35b7e9d24893f42166d4edc973ca16b13a2157e34261059a"}',
    };
    for (const [path, text] of Object.entries({ ...planted, ...clean })) {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    }
    assert.deepEqual(colorsOutside(root, ['site', 'film']), [
      'site/a.css:1 #f8d794',
      'site/a.css:2 red',
      'site/a.css:3 rgb(',
      'site/a.css:4 color(display-p3',
      'site/b.vue:1 white',
      'site/b.vue:2 #fff',
      'film/c.mjs:1 #F8D794',
      'film/d.md:1 tomato',
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
  assert.deepEqual(colorsIn('x: #abc; y: &#123;'), [{ line: 1, value: '#abc' }]);
});

test('test 741: brand/ holds a color value only in tokens.json and in icon.svg, and the two colors of icon.svg are tokens of dusk', () => {
  const files = readdirSync(join(ROOT, 'brand')).sort();
  assert.deepEqual(files, ['code-theme.mjs', 'css.mjs', 'icon.svg', 'mark.svg', 'tokens.json']);
  for (const file of files.filter((name) => !['tokens.json', 'icon.svg'].includes(name))) assert.deepEqual(colorsIn(read(`brand/${file}`)), [], file);
  assert.deepEqual(hexes(read('brand/icon.svg')).sort(), [tokens.colors.dusk.brand, tokens.colors.dusk.ground].map((hex) => hex.toLowerCase()).sort());
  assert.ok(read('brand/mark.svg').includes('fill="currentColor"'));
});

test('test 741: the mark and the icon draw one tree, a single path, and the mark takes the color of the text around it', () => {
  const pathOf = (svg: string): string[] => [...svg.matchAll(/<path\b[^>]* d="([^"]+)"/g)].map((match) => match[1]!);
  const mark = pathOf(read('brand/mark.svg'));
  assert.equal(mark.length, 1);
  assert.deepEqual(pathOf(read('brand/icon.svg')), mark);
  assert.match(read('brand/mark.svg'), /viewBox="53 0 294 400"/);
});

test('test 741: css() writes every color, font and radius of the tokens, dusk in :root and paper under the selector it is given, and no value that is no token', () => {
  const dusk = css(tokens);
  const [root, paper] = dusk.split('\n\n');
  assert.ok(root!.startsWith(':root {') && paper!.startsWith('[data-theme="paper"] {'), dusk);
  for (const [role, value] of Object.entries(tokens.colors.dusk)) assert.ok(root!.includes(`--lc-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`), role);
  for (const [role, value] of Object.entries(tokens.colors.paper)) assert.ok(paper!.includes(`--lc-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}: ${value};`), role);
  for (const [role, font] of Object.entries(tokens.fonts)) assert.ok(root!.includes(`--lc-font-${role}: "${font.family}", ${font.fallback};`), role);
  for (const [role, pixels] of Object.entries(tokens.radius)) assert.ok(root!.includes(`--lc-radius-${role}: ${pixels}px;`), role);
  assert.ok(hexes(dusk).every((hex) => values.has(hex)));
  assert.ok(css(tokens, ':root:not(.dark)').includes('\n:root:not(.dark) {\n'));
});

test('test 741: every tint of the tokens is a color of dusk at a share between 1 and 99 percent, css() writes it as that color with its alpha, and css() writes no other color with an alpha', () => {
  const tints = (tokens as Tokens & { tints: Record<string, number[]> }).tints;
  const root = css(tokens).split('\n\n')[0]!;
  const written: string[] = [];
  for (const [role, percents] of Object.entries(tints)) {
    assert.ok(tokens.colors.dusk[role] !== undefined, `${role} is a color of dusk`);
    for (const percent of percents) {
      assert.ok(Number.isInteger(percent) && percent >= 1 && percent <= 99, `${role} ${percent}`);
      const value = `${tokens.colors.dusk[role]}${Math.round((percent * 255) / 100).toString(16).padStart(2, '0')}`;
      assert.ok(root.includes(`--lc-${role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}-${percent}: ${value};`), `${role} ${percent}`);
      written.push(value.toLowerCase());
    }
  }
  assert.deepEqual((root.match(/#[0-9a-fA-F]{8}\b/g) ?? []).map((hex) => hex.toLowerCase()).sort(), written.sort());
});

test('test 741: codeTheme() is one dark theme on the code surface, and every color in it is a color of dusk', () => {
  const theme = codeTheme(tokens);
  assert.equal(theme.type, 'dark');
  assert.equal(theme.bg, tokens.colors.dusk.code);
  assert.equal(theme.fg, tokens.colors.dusk.text);
  const dusk = new Set(Object.values(tokens.colors.dusk).map((value) => value.toLowerCase()));
  const used = hexes(JSON.stringify(theme));
  assert.ok(used.length > 0 && used.every((hex) => dusk.has(hex)));
  const colorOf = (scope: string): string | undefined => theme.tokenColors.find((rule: { scope?: string[] }) => rule.scope?.includes(scope))?.settings.foreground;
  assert.equal(colorOf('keyword'), tokens.colors.dusk[tokens.syntax.keyword!]);
  assert.equal(colorOf('string'), tokens.colors.dusk[tokens.syntax.string!]);
  assert.equal(colorOf('comment'), tokens.colors.dusk[tokens.syntax.comment!]);
});

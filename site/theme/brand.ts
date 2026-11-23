import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';
import { codeTheme } from '../../brand/code-theme.mjs';
import { css } from '../../brand/css.mjs';
import tokens from '../../brand/tokens.json' with { type: 'json' };
import manifest from '../../package.json' with { type: 'json' };

export { manifest, tokens };

export const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const MODULES = fileURLToPath(new URL('../node_modules/', import.meta.url));

export const CANONICAL = { landing: 'https://lawcheck.dev/', docs: 'https://docs.lawcheck.dev/' };

// A preview serves the two sites on other hosts; only the links between them follow it, never a canonical address.
export const LINK = {
  landing: process.env.LAWCHECK_LANDING_URL ?? CANONICAL.landing,
  docs: process.env.LAWCHECK_DOCS_URL ?? CANONICAL.docs,
};

export const GITHUB = 'https://github.com/krzysztofdudek/Lawcheck';
export const NPM = 'https://www.npmjs.com/package/lawcheck';

export const codeThemeOfBrand = codeTheme(tokens);
export const themeColor = tokens.colors.dusk.ground;

const ID = 'virtual:lawcheck-brand.css';

export function brandStyles(selectors: { paper?: string; dusk?: string } = {}): Plugin {
  const [dusk] = css(tokens).split('\n\n');
  const text = css(tokens, selectors.paper) + (selectors.dusk ? `\n${dusk!.replace(':root', selectors.dusk)}` : '');
  return {
    name: 'lawcheck-brand',
    resolveId: (id) => (id === ID ? `\0${ID}` : undefined),
    load: (id) => (id === `\0${ID}` ? text : undefined),
  };
}

export const viteShared: UserConfig = {
  resolve: { alias: { '@lc-modules': MODULES } },
  server: { fs: { allow: [REPOSITORY] } },
};

// VitePress links vp-icons.css from every page, also when no icon is configured and the file is empty; the empty stylesheet still blocks the first paint.
export function dropEmptyIcons(outDir: string): void {
  const icons = join(outDir, 'vp-icons.css');
  if (statSync(icons, { throwIfNoEntry: false })?.size !== 0) return;
  for (const name of readdirSync(outDir, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.html'))) {
    const page = join(outDir, name);
    writeFileSync(page, readFileSync(page, 'utf8').replace(/\s*<link rel="preload stylesheet" href="\/vp-icons\.css" as="style">/, ''));
  }
  rmSync(icons);
}

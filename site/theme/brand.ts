import { readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin, UserConfig } from 'vite';
import type { HeadConfig } from 'vitepress';
import { codeTheme } from '../../brand/code-theme.mjs';
import { css } from '../../brand/css.mjs';
import tokens from '../../brand/tokens.json' with { type: 'json' };
import manifest from '../../package.json' with { type: 'json' };

export { manifest, tokens };

export const REPOSITORY = fileURLToPath(new URL('../../', import.meta.url));
const MODULES = fileURLToPath(new URL('../node_modules/', import.meta.url));

// The host the documentation answers on is the one line DOCS_HOST of the workflow that deploys it: lawcheck.dev until the domain switch, docs.lawcheck.dev after it. Every build reads it there, so a build on a machine or in a check of CI names the host the deploy names.
function docsHost(): string {
  const line = /^\s+DOCS_HOST:\s*([a-z0-9.-]+)\s*$/m.exec(readFileSync(join(REPOSITORY, '.github', 'workflows', 'docs.yml'), 'utf8'));
  if (!line) throw new Error('site: .github/workflows/docs.yml has no line DOCS_HOST: <host>, which names the host of the documentation');
  return line[1]!;
}

export const CANONICAL = { landing: 'https://lawcheck.dev/', docs: `https://${docsHost()}/` };

// The landing page goes live only with the domain switch, so its links lead to the documentation's host after it.
const DOCS_AFTER_SWITCH = 'https://docs.lawcheck.dev/';

// A preview serves the two sites on other hosts; only the links between them follow it, never a canonical address.
export const LINK = {
  landing: process.env.LAWCHECK_LANDING_URL ?? CANONICAL.landing,
  docs: process.env.LAWCHECK_DOCS_URL ?? DOCS_AFTER_SWITCH,
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

// A font that arrives after the first paint moves the text set in it; VitePress preloads only its own Inter, and only in its default theme.
export const fontPreloads = (assets: string[], names: RegExp): HeadConfig[] =>
  assets.filter((file) => names.test(file)).map((href) => ['link', { rel: 'preload', href, as: 'font', type: 'font/woff2', crossorigin: '' }]);

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

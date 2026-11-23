import { createRequire } from 'node:module';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig } from 'vitepress';
import topics from '../../docs/topics.json' with { type: 'json' };
import { brandStyles, dropEmptyIcons, CANONICAL, codeThemeOfBrand, GITHUB, LINK, manifest, REPOSITORY, themeColor, viteShared } from '../theme/brand.ts';
import { describe } from '../theme/describe.ts';

const HOME_TITLE = 'Lawcheck documentation';
const HOME_DESCRIPTION = 'The documentation of Lawcheck: install, quick start, guides for Claude Code, other agents and CI, a reference of every command, and every code.';

// The landing page's description; a page of the docs may not repeat it.
const PROMISE = manifest.description.slice(manifest.description.indexOf('. ') + 2);

const pageId = (relativePath: string): string => relativePath.replace(/\.md$/, '');
const canonicalOf = (id: string): string => (id === 'index' ? CANONICAL.docs : `${CANONICAL.docs}${id}.html`);
const heads = new Map<string, { title: string; description: string }>();

export default defineConfig({
  srcDir: '../docs',
  base: '/',
  lang: 'en',
  title: 'Lawcheck',
  titleTemplate: ':title | Lawcheck docs',
  description: manifest.description,
  appearance: 'dark',
  sitemap: { hostname: CANONICAL.docs },
  markdown: { theme: codeThemeOfBrand },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    ['meta', { name: 'theme-color', content: themeColor }],
  ],
  vite: {
    ...viteShared,
    plugins: [brandStyles({ paper: ':root:not(.dark)', dusk: ':root:not(.dark) .vp-doc div[class*="language-"]' })],
    // The pages live in ../docs, and an import resolved from there would not find site/node_modules.
    resolve: { alias: { ...viteShared.resolve!.alias, vue: dirname(createRequire(import.meta.url).resolve('vue/package.json')) } },
  },
  transformPageData(pageData) {
    const id = pageId(pageData.relativePath);
    const topic = topics.find((t) => t.id === id);
    if (!topic) return;
    const home = id === 'index';
    const title = home ? HOME_TITLE : topic.title;
    const description = home ? HOME_DESCRIPTION : describe(readFileSync(join(REPOSITORY, 'docs', pageData.relativePath), 'utf8'), [PROMISE]);
    heads.set(id, { title: home ? title : `${title} | Lawcheck docs`, description });
    pageData.title = title;
    pageData.description = description;
    if (home) pageData.titleTemplate = false;
  },
  transformHead({ pageData }) {
    const id = pageId(pageData.relativePath);
    const head = heads.get(id);
    if (!head) return [];
    const url = canonicalOf(id);
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'Lawcheck' }],
      ['meta', { property: 'og:title', content: head.title }],
      ['meta', { property: 'og:description', content: head.description }],
      ['meta', { property: 'og:url', content: url }],
    ];
  },
  buildEnd(site) {
    const problems: string[] = [];
    for (const key of ['title', 'description'] as const) {
      const seen = new Map<string, string>();
      for (const [id, head] of heads) {
        const other = seen.get(head[key]);
        if (other) problems.push(`${id} and ${other} have the same ${key}`);
        seen.set(head[key], id);
      }
    }
    for (const [id, head] of heads) {
      if (head.title.length > 60) problems.push(`${id}: the title has ${head.title.length} characters, over 60`);
      if (head.description.length < 70 || head.description.length > 160) problems.push(`${id}: the description has ${head.description.length} characters, outside 70 to 160`);
    }
    if (problems.length > 0) throw new Error(`docs site: the head of a page is wrong\n${problems.join('\n')}`);
    copyFileSync(join(REPOSITORY, 'brand', 'icon.svg'), join(site.outDir, 'icon.svg'));
    dropEmptyIcons(site.outDir);
    writeFileSync(join(site.outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL.docs}sitemap.xml\n`);
  },
  themeConfig: {
    siteTitle: `lawcheck ${manifest.version}`,
    nav: [
      { text: 'lawcheck.dev', link: LINK.landing, target: '_self', rel: '' },
      { text: 'GitHub', link: GITHUB },
    ],
    search: { provider: 'local' },
    docFooter: { prev: false, next: false },
    notFound: { title: 'This page is not in the documentation', quote: '', linkLabel: 'Documentation home', linkText: 'Documentation home' },
    sidebar: [...new Set(topics.map((t) => t.section))].map((section) => ({
      text: section,
      items: topics.filter((t) => t.section === section).map((t) => ({ text: t.title, link: t.id === 'index' ? '/' : `/${t.id}` })),
    })),
  },
});

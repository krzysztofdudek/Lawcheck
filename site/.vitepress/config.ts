import { createRequire } from 'node:module';
import { copyFileSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { defineConfig, type MarkdownOptions } from 'vitepress';
import type { Plugin } from 'vite';
import topics from '../../docs/topics.json' with { type: 'json' };
import { brandStyles, dropEmptyIcons, CANONICAL, codeThemeOfBrand, fontPreloads, GITHUB, LINK, manifest, REPOSITORY, themeColor, viteShared } from '../theme/brand.ts';
import { cardHead } from '../theme/card.mjs';
import { describe } from '../theme/describe.ts';
import { chapterOf } from '../theme/film.ts';

const HOME_TITLE = 'Lawcheck documentation';
const HOME_DESCRIPTION = 'The documentation of Lawcheck: install, quick start, guides for Claude Code, other agents and CI, every command, and what each code in the output means.';

// The landing page's description; a page of the docs may not repeat it.
const PROMISE = manifest.description.slice(manifest.description.indexOf('. ') + 2).split(/(?<=[.!?])\s+/);

const pageId = (relativePath: string): string => relativePath.replace(/\.md$/, '');
const canonicalOf = (id: string): string => (id === 'index' ? CANONICAL.docs : `${CANONICAL.docs}${id}.html`);
// The default theme sets each sidebar group's name in an h2, and the sidebar comes before the page in the document, so the first heading of a page would be the group's name and not its h1.
// It also fills the list "On this page" in the browser only, so the words of that list are missing from the HTML that a reader without scripts gets; the list starts from the h2 of the page instead.
const THEME_PATCHES: Array<{ file: RegExp; from: RegExp; to: string }> = [
  {
    file: /[\\/]VPSidebarItem\.vue$/,
    from: /const textTag = computed\(\(\) => \{[\s\S]*?\n\}\)\n/,
    to: "const textTag = computed(() => 'p')\n",
  },
  {
    file: /[\\/]VPDocAsideOutline\.vue$/,
    from: /const \{ frontmatter, theme \} = useData\(\)\n\nconst headers = shallowRef<MenuItem\[\]>\(\[\]\)\n/,
    to: "const { frontmatter, page, theme } = useData()\n\nconst headers = shallowRef<MenuItem[]>(page.value.headers.filter((h) => h.level === 2).map(({ title, link }) => ({ title, link, level: 2 })) as MenuItem[])\n",
  },
];

function themeWithoutScriptOnlyWords(): Plugin {
  return {
    name: 'lawcheck-theme-without-script-only-words',
    enforce: 'pre',
    transform(code, id) {
      const patch = THEME_PATCHES.find((p) => p.file.test(id));
      if (!patch) return;
      if (!patch.from.test(code)) throw new Error(`docs site: ${id} no longer reads the way site/.vitepress/config.ts expects`);
      return code.replace(patch.from, patch.to);
    },
  };
}

const outlines = new Map<string, Array<{ title: string; link: string }>>();

const collectOutline: NonNullable<MarkdownOptions['config']> = (md) => {
  md.core.ruler.push('lawcheck-outline', (state) => {
    const found: Array<{ title: string; link: string }> = [];
    state.tokens.forEach((token, index) => {
      const id = token.attrGet('id');
      if (token.type !== 'heading_open' || token.tag !== 'h2' || !id) return;
      const title = (state.tokens[index + 1]?.children ?? []).filter((t) => t.type === 'text' || t.type === 'code_inline').map((t) => t.content).join('').trim();
      found.push({ title, link: `#${id}` });
    });
    outlines.set(pageId(state.env.relativePath), found);
    return true;
  });
};

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
  markdown: { theme: codeThemeOfBrand, config: collectOutline },
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    ['meta', { name: 'theme-color', content: themeColor }],
  ],
  vite: {
    ...viteShared,
    plugins: [themeWithoutScriptOnlyWords(), brandStyles({ paper: ':root:not(.dark)', dusk: ':root:not(.dark) .vp-doc div[class*="language-"]' })],
    // The pages live in ../docs, and an import resolved from there would not find site/node_modules.
    resolve: { alias: { ...viteShared.resolve!.alias, vue: dirname(createRequire(import.meta.url).resolve('vue/package.json')) } },
  },
  transformPageData(pageData) {
    const id = pageId(pageData.relativePath);
    const topic = topics.find((t) => t.id === id);
    if (!topic) return;
    const home = id === 'index';
    const title = home ? HOME_TITLE : topic.title;
    const description = home ? HOME_DESCRIPTION : describe(readFileSync(join(REPOSITORY, 'docs', pageData.relativePath), 'utf8'), PROMISE);
    heads.set(id, { title: home ? title : `${title} | Lawcheck docs`, description });
    pageData.headers = (outlines.get(id) ?? []).map(({ title, link }) => ({ level: 2, title, slug: link.slice(1), link, children: [] }));
    pageData.title = title;
    pageData.description = description;
    const chapter = chapterOf(id);
    if (chapter) pageData.frontmatter.chapter = chapter;
    if (home) pageData.titleTemplate = false;
  },
  transformHead({ pageData, assets }) {
    const fonts = fontPreloads(assets, /\/jetbrains-mono-latin-wght-normal\.[\w-]+\.woff2$/);
    const id = pageId(pageData.relativePath);
    const head = heads.get(id);
    if (!head) return fonts;
    const url = canonicalOf(id);
    return [
      ['link', { rel: 'canonical', href: url }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'Lawcheck' }],
      ['meta', { property: 'og:title', content: head.title }],
      ['meta', { property: 'og:description', content: head.description }],
      ['meta', { property: 'og:url', content: url }],
      ...cardHead(),
      ...fonts,
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
    for (const name of readdirSync(site.outDir, { recursive: true, encoding: 'utf8' }).filter((path) => path.endsWith('.html') && path !== '404.html')) {
      const html = readFileSync(join(site.outDir, name), 'utf8');
      if (/<(h[1-6])[\s>]/.exec(html)?.[1] !== 'h1') problems.push(`${name}: the first heading is not the h1`);
      for (const tag of ['main', 'footer']) if ((html.match(new RegExp(`<${tag}[\\s>]`, 'g')) ?? []).length !== 1) problems.push(`${name}: the page has not exactly one ${tag}`);
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
    footer: { message: 'Lawcheck is released under the MIT license.', copyright: 'Copyright © 2026 Krzysztof Dudek' },
    docFooter: { prev: false, next: false },
    notFound: { title: 'This page is not in the documentation', quote: '', linkLabel: 'Documentation home', linkText: 'Documentation home' },
    sidebar: [...new Set(topics.map((t) => t.section))].map((section) => ({
      text: section,
      items: topics.filter((t) => t.section === section).map((t) => ({ text: t.title, link: t.id === 'index' ? '/' : `/${t.id}` })),
    })),
  },
});

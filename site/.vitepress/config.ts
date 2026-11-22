import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vitepress';
import manifest from '../../package.json' with { type: 'json' };
import topics from '../../docs/topics.json' with { type: 'json' };

export default defineConfig({
  srcDir: '../docs',
  base: '/Lawcheck/',
  lang: 'en',
  title: 'Lawcheck',
  description: manifest.description,
  // The pages live in ../docs, and an import resolved from there would not find site/node_modules.
  vite: { resolve: { alias: { vue: dirname(createRequire(import.meta.url).resolve('vue/package.json')) } } },
  themeConfig: {
    siteTitle: `lawcheck ${manifest.version}`,
    search: { provider: 'local' },
    docFooter: { prev: false, next: false },
    sidebar: [...new Set(topics.map((t) => t.section))].map((section) => ({
      text: section,
      items: topics.filter((t) => t.section === section).map((t) => ({ text: t.title, link: `/${t.id}` })),
    })),
  },
});

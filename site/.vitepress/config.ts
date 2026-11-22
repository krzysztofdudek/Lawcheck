import { createRequire } from 'node:module';
import { dirname } from 'node:path';
import { defineConfig } from 'vitepress';
import manifest from '../../package.json' with { type: 'json' };

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
    sidebar: [
      {
        text: 'Guides',
        items: [
          { text: 'The first type and the first rule', link: '/first-law' },
          { text: 'CI and git hooks', link: '/ci' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'The law file', link: '/law' },
          { text: 'Settings', link: '/config' },
          { text: 'Script rules', link: '/script-rules' },
          { text: 'Reviewer rules', link: '/reviewer-rules' },
          { text: 'Reviewers and keys', link: '/providers' },
          { text: 'Languages and uses', link: '/languages' },
          { text: 'Waivers', link: '/waivers' },
          { text: 'What a check judges', link: '/change' },
          { text: 'JSON documents', link: '/json' },
        ],
      },
      {
        text: 'Troubleshooting',
        items: [{ text: 'Codes', link: '/codes' }],
      },
    ],
  },
});

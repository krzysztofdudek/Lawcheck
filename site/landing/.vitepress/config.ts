import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { defineConfig } from 'vitepress';
import type { HeadConfig } from 'vitepress';
import { brandStyles, dropEmptyIcons, CANONICAL, fontPreloads, GITHUB, manifest, NPM, REPOSITORY, themeColor, viteShared } from '../../theme/brand.ts';
import { copyOf, head, pageUrl } from '../facts.ts';

const page = head();
const notFound = copyOf().notFound;

const structured = {
  '@context': 'https://schema.org',
  '@graph': [
    { '@type': 'WebSite', name: 'Lawcheck', url: CANONICAL.landing, description: page.description },
    {
      '@type': 'SoftwareApplication',
      name: 'Lawcheck',
      description: page.description,
      url: CANONICAL.landing,
      applicationCategory: 'DeveloperApplication',
      operatingSystem: page.systems.replace(' and ', ', '),
      softwareVersion: manifest.version,
      license: `https://spdx.org/licenses/${manifest.license}.html`,
      offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
      downloadUrl: NPM,
      sameAs: [GITHUB, NPM],
      author: { '@type': 'Person', name: manifest.author, url: 'https://chrisdudek.com' },
    },
  ],
};

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// VitePress renders 404.html with an empty body and fills it in the browser; this page is the built landing page with its main part, its head and its scripts replaced, so it reads the same without JavaScript.
function pageNotFound(index: string): string {
  const cut = (text: string, pattern: RegExp, by: string): string => {
    if (!pattern.test(text)) throw new Error(`site/landing: the built index.html has no ${pattern}, so 404.html cannot be made from it`);
    return text.replace(pattern, by);
  };
  const main = `<main id="main" tabindex="-1"><section class="wrap lost"><h1>${escape(notFound.heading)}</h1><p>${escape(notFound.text)}</p><p class="links"><a class="button" href="${escape(pageUrl(notFound.docs.page))}">${escape(notFound.docs.text)}</a><a href="/">${escape(notFound.home)}</a></p></section></main>`;
  let html = cut(index, /<main\b[\s\S]*<\/main>/, main);
  html = cut(html, /<title>[^<]*<\/title>/, `<title>${escape(notFound.heading.replace(/\.$/, ''))}</title>`);
  html = cut(html, /<meta name="description"[^>]*>/, `<meta name="description" content="${escape(notFound.text)}">`);
  html = cut(html, /\s*<link rel="canonical"[\s\S]*?<script type="application\/ld\+json">[\s\S]*?<\/script>/, '');
  return html.replace(/\s*<script type="module"[^>]*><\/script>/g, '').replace(/\s*<link rel="modulepreload"[^>]*>/g, '').replace(/\s*<script>window\.__VP_HASH_MAP__[\s\S]*?<\/script>/, '');
}

export default defineConfig({
  lang: 'en',
  title: page.title,
  titleTemplate: false,
  description: page.description,
  cleanUrls: true,
  appearance: false,
  head: [
    ['link', { rel: 'icon', type: 'image/svg+xml', href: '/icon.svg' }],
    ['meta', { name: 'theme-color', content: themeColor }],
  ],
  vite: { ...viteShared, plugins: [brandStyles()] },
  transformHead({ pageData, assets }): HeadConfig[] {
    if (pageData.relativePath !== 'index.md') return [];
    return [
      ...fontPreloads(assets, /\/(inter-roman-latin|jetbrains-mono-latin-wght-normal)\.[\w-]+\.woff2$/),
      ['link', { rel: 'canonical', href: CANONICAL.landing }],
      ['meta', { property: 'og:type', content: 'website' }],
      ['meta', { property: 'og:site_name', content: 'Lawcheck' }],
      ['meta', { property: 'og:title', content: page.title }],
      ['meta', { property: 'og:description', content: page.description }],
      ['meta', { property: 'og:url', content: CANONICAL.landing }],
      ['script', { type: 'application/ld+json' }, JSON.stringify(structured)],
    ];
  },
  buildEnd(site) {
    writeFileSync(join(site.outDir, '404.html'), pageNotFound(readFileSync(join(site.outDir, 'index.html'), 'utf8')));
    copyFileSync(join(REPOSITORY, 'brand', 'icon.svg'), join(site.outDir, 'icon.svg'));
    dropEmptyIcons(site.outDir);
    writeFileSync(join(site.outDir, 'robots.txt'), `User-agent: *\nAllow: /\n\nSitemap: ${CANONICAL.landing}sitemap.xml\n`);
    writeFileSync(
      join(site.outDir, 'sitemap.xml'),
      `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>${CANONICAL.landing}</loc><lastmod>${page.date}</lastmod></url></urlset>\n`,
    );
  },
});

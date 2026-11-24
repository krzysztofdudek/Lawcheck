import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

// The documentation's host takes a page by the form without .html and by /index from the old addresses; each lands once on the address the page names as its own.
export function vercelConfig(topics) {
  const pages = topics.map((topic) => topic.id).filter((id) => id !== 'index');
  const list = pages.join('|');
  return {
    redirects: [
      { source: '/index', destination: '/', permanent: true },
      { source: '/index.html', destination: '/', permanent: true },
      { source: `/:page(${list})`, destination: '/:page.html', permanent: true },
    ],
    headers: [
      {
        source: '/(.*)',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ],
  };
}

export function problems(dir, topics) {
  const out = [];
  for (const topic of topics) {
    const file = topic.id === 'index' ? 'index.html' : `${topic.id}.html`;
    if (!existsSync(join(dir, file))) out.push(`${file} is missing, and docs/topics.json lists the page ${topic.id}`);
  }
  if (!existsSync(join(dir, '404.html'))) out.push('404.html is missing');
  return out;
}

function main(dir, topicsFile) {
  const topics = JSON.parse(readFileSync(topicsFile, 'utf8'));
  const found = problems(dir, topics);
  if (found.length > 0) {
    process.stderr.write(`docs on Vercel: the built site is not whole\n${found.join('\n')}\n`);
    process.exit(1);
  }
  writeFileSync(join(dir, 'vercel.json'), `${JSON.stringify(vercelConfig(topics), null, 2)}\n`);
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const [dir, topicsFile] = process.argv.slice(2);
  if (!dir || !topicsFile) {
    process.stderr.write('usage: node site/docs-vercel.mjs <built site> <docs/topics.json>\n');
    process.exit(2);
  }
  main(resolve(dir), resolve(topicsFile));
}

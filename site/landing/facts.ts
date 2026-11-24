import { join } from 'node:path';
import { createHighlighter } from 'shiki';
import { parse } from 'yaml';
import topics from '../../docs/topics.json' with { type: 'json' };
import { codeThemeOfBrand, GITHUB, LINK, manifest, NPM, REPOSITORY } from '../theme/brand.ts';
import { chapters, loop } from '../theme/film.ts';
import { plain } from '../theme/describe.ts';
import { Fragments, inline, isAhead } from './fragments.ts';

type Link = { text: string; page: string };
export interface Copy {
  title: string;
  summary: string;
  h1: string;
  skip: string;
  nav: { docs: Link; github: string };
  install: { copy: string; copyBoth: string; copyPlugin: string; copied: string; quickStart: Link; setup: Link };
  problem: string;
  where: string;
  tryIt: string;
  comparison: Link;
  holds: { page: string };
  tutorial: { heading: string; chapter: string; length: string; play: string; read: string; transcript: string };
  next: { button: Link; github: string; npm: string };
  footer: { released: string; ahead: string; docs: Link; changelog: Link; security: string; github: string; npm: string; author: string };
  notFound: { heading: string; text: string; docs: Link; home: string };
}

export const pageUrl = (page: string): string => {
  if (!topics.some((topic) => topic.id === page)) throw new Error(`site/landing: index.md links to the page "${page}", which docs/topics.json does not name`);
  return page === 'index' ? LINK.docs : `${LINK.docs}${page}.html`;
};

export const fragments = new Fragments(REPOSITORY);

export function copyOf(): Copy {
  const text = fragments.read('site/landing/index.md');
  return parse(/^---\n([\s\S]*?)\n---/.exec(text)![1]!) as Copy;
}

export function releaseDate(version: string): string {
  const line = fragments.read('CHANGELOG.md').split('\n').find((row) => row.startsWith(`## [${version}] - `));
  if (!line) throw new Error(`site/landing: CHANGELOG.md has no heading for ${version}`);
  return line.slice(line.lastIndexOf(' ') + 1);
}

export const promise = (): string => ['You write down which layer', 'Lawcheck checks each file your agent edits'].map((start) => fragments.sentence('README.md', 'Lawcheck', start)).join(' ');
export const agents = (): string => fragments.paragraph('README.md', 'Lawcheck', 'The check of imports is deterministic');

export function loopLabel(readme: string): string {
  const found = /^\[!\[([^\]]+)\]\(/m.exec(readme);
  if (!found) throw new Error('site/landing: README.md shows no loop, an image link at its top, whose text the landing page gives the video');
  return found[1]!;
}

const LOOP_FILE = '/film/';

export function heroLoop() {
  const shown = loop();
  if (!shown) return null;
  return { webm: `${LOOP_FILE}${shown.files.webm.name}`, mp4: `${LOOP_FILE}${shown.files.mp4.name}`, label: loopLabel(fragments.read('README.md')) };
}

export function marked(html: string, text: string): string {
  const lines = html.split('<span class="line">');
  const at = lines.findIndex((line, index) => index > 0 && line.includes(text));
  if (at < 0) throw new Error(`site/landing: the still of the hero has no line with ${text}`);
  lines[at] = `<span class="line mark">${lines[at]!}`;
  return lines.map((line, index) => (index === 0 || index === at ? line : `<span class="line">${line}`)).join('');
}
export const support = (): string => fragments.sentence('docs/support.md', 'Supported environments', `Lawcheck ${manifest.version} runs on`);

export function head() {
  const copy = copyOf();
  return { title: copy.title, description: plain(copy.summary), version: manifest.version, date: releaseDate(manifest.version), ahead: isAhead(fragments.read('CHANGELOG.md')), systems: /, on (.+)\.$/.exec(support())![1]! };
}

export async function facts() {
  const highlighter = await createHighlighter({ themes: [codeThemeOfBrand], langs: ['yaml'] });
  const code = (file: string, heading: string, start: string) => {
    const block = fragments.code(file, heading, start);
    return { text: block.code, html: highlighter.codeToHtml(block.code, { lang: block.lang === 'yaml' ? 'yaml' : 'text', theme: 'lawcheck' }) };
  };
  const md = (file: string) => (text: string) => inline(text, file, LINK.docs, GITHUB);
  const readme = md('README.md');
  const index = md('docs/index.md');
  const others = md('docs/other-tools.md');
  const copy = copyOf();
  const title = (page: string) => topics.find((topic) => topic.id === page)!.title;
  const link = (target: Link) => ({ text: target.text, href: pageUrl(target.page) });

  const law = code('README.md', 'Lawcheck', 'lawcheck: ');
  const refusal = code('README.md', 'Lawcheck', '$ lawcheck check');
  const install = fragments.code('docs/install.md', 'Install globally', '$ npm install').code.replace(/^\$ /, '');
  const groups = ['`CLAUDE.md` and `AGENTS.md`', 'An architecture tool for one language', 'A review bot at the pull request', 'A hook you wrote in Claude Code'];
  const rowsOf: Record<string, string[]> = {
    '`CLAUDE.md` and `AGENTS.md`': ['Your rules say how the agent works, such as the command that runs the tests', 'Your rules are about files: which layer may import which, what a file of one kind must hold'],
    'An architecture tool for one language': ['One language, and the tool already holds your layers in the test suite or the linter', 'Two or more languages under one set of layers'],
    'A review bot at the pull request': ['You want comments on the whole change, including on what no rule names', 'A rule must hold in every file of a kind, and the agent must hear it before it opens a pull request', 'Your architecture tool already prints annotations on the lines of the pull request, as `deptrac` does in GitHub Actions ([deptrac\'s page on formatters](https://deptrac.github.io/deptrac/formatters/), read on 2026-11-24)', 'You want annotations on the lines of the pull request, and no tool of yours prints them'],
    'A hook you wrote in Claude Code': ['Your hook runs the linter and the tests, and the linter already holds your layers', 'You want the law checked inside the turn, on the files of the turn, with at most three returns'],
  };
  const tables = groups.map((group) => fragments.rows('docs/other-tools.md', group, 1, rowsOf[group]!));

  return {
    copy: {
      ...copy,
      nav: { ...copy.nav, docs: link(copy.nav.docs) },
      install: { ...copy.install, quickStart: link(copy.install.quickStart), setup: link(copy.install.setup) },
      comparison: link(copy.comparison),
      next: { ...copy.next, button: link(copy.next.button) },
      footer: { ...copy.footer, docs: link(copy.footer.docs), changelog: link(copy.footer.changelog) },
      notFound: { ...copy.notFound, docs: link(copy.notFound.docs) },
    },
    links: { github: GITHUB, npm: NPM, security: `${GITHUB}/blob/main/SECURITY.md`, author: 'https://chrisdudek.com', changelog: pageUrl('changelog') },
    head: head(),
    hero: {
      promise: readme(promise()),
      agents: readme(agents()),
      who: readme(fragments.sentence('README.md', 'Lawcheck', 'It is for you if you build')),
      install,
      support: md('docs/support.md')(support()),
      alpha: readme(fragments.sentence('README.md', 'Try it', 'Lawcheck is an alpha')),
      still: { file: 'terminal', html: marked(refusal.html, 'error[forbidden-use]') },
      loop: heroLoop(),
    },
    pilot: readme(fragments.paragraph('README.md', 'Lawcheck', 'On 2026-11-23 I gave Claude Code')),
    problem: readme(fragments.paragraph('README.md', 'Lawcheck', 'I build software')),
    advice: ['A rules file is advice', 'Lawcheck checks your code against', 'Your linter can hold a layer rule', 'Lawcheck adds what the linter leaves to you'].map((start) => readme(fragments.sentence('README.md', 'Lawcheck', start))).join(' '),
    law: {
      heading: fragments.heading('docs/index.md', 'A law and a finding'),
      intro: readme(fragments.paragraph('README.md', 'Lawcheck', 'The law is a file')),
      law: law.html,
      findingIntro: readme(fragments.paragraph('README.md', 'Lawcheck', 'An import of a handler')),
      finding: refusal.html,
    },
    where: {
      heading: copy.where,
      items: fragments.list('docs/index.md', 'Lawcheck checks in six places', 1).map(index),
      other: others(fragments.sentence('docs/other-tools.md', 'A hook you wrote in Claude Code', 'Lawcheck sends the agent back')),
    },
    holds: {
      heading: fragments.heading('README.md', 'One law holds uses, rules, debt and waivers'),
      items: fragments.list('README.md', 'One law holds uses, rules, debt and waivers', 1).map(readme),
      link: { text: title(copy.holds.page), href: pageUrl(copy.holds.page) },
    },
    tutorial: {
      chapters: chapters()
        .toSorted((a, b) => a.number - b.number)
        .map((chapter) => ({
          page: chapter.page,
          number: chapter.number,
          docs: pageUrl(chapter.page),
          title: title(chapter.page),
          seconds: Math.round(chapter.seconds),
          video: `/film/${chapter.files.mp4.name}`,
          track: `/film/${chapter.files.vtt.name}`,
          poster: `/film/${chapter.files.jpg.name}`,
          transcript: chapter.transcript,
        })),
    },
    tools: {
      heading: title('other-tools'),
      head: tables[0]![0]!.map(others),
      groups: groups.map((group, at) => ({ label: others(group), rows: tables[at]!.slice(1).map((row) => row.map(others)) })),
    },
    limits: {
      heading: fragments.heading('README.md', 'Limits'),
      items: fragments.list('README.md', 'Limits', 1).map(readme),
    },
    tryIt: {
      heading: copy.tryIt,
      install: fragments.code('README.md', 'Try it', 'npm install').code,
      quickStart: readme(fragments.sentence('README.md', 'Try it', 'You reach a first finding')),
      setup: readme(fragments.paragraph('README.md', 'Try it', 'In your own repository, your agent')),
      plugin: readme(fragments.paragraph('README.md', 'Your coding agent', 'In Claude Code, install the plugin')),
      pluginCommands: fragments.code('README.md', 'Your coding agent', 'claude plugin').code,
      codex: ['In Codex, the same plugin installs', 'Codex runs the hooks of a plugin only after'].map((start) => readme(fragments.sentence('README.md', 'Your coding agent', start))).join(' '),
      copilot: readme(fragments.sentence('README.md', 'Your coding agent', 'In GitHub Copilot CLI, the same plugin installs')),
    },
  };
}

export type Facts = Awaited<ReturnType<typeof facts>>;

export const watched = ['README.md', 'CHANGELOG.md', 'package.json', 'docs/*.md', 'docs/topics.json', 'site/landing/index.md'].map((path) => join(REPOSITORY, path));

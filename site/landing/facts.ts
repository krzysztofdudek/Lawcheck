import { join } from 'node:path';
import { createHighlighter } from 'shiki';
import { parse } from 'yaml';
import topics from '../../docs/topics.json' with { type: 'json' };
import { codeThemeOfBrand, GITHUB, LINK, manifest, NPM, REPOSITORY } from '../theme/brand.ts';
import { Fragments, inline } from './fragments.ts';

type Link = { text: string; page: string };
export interface Copy {
  title: string;
  h1: string;
  skip: string;
  nav: { docs: Link; github: string };
  install: { copy: string; copied: string; quickStart: Link };
  problem: string;
  comparison: Link;
  holds: { page: string };
  next: { button: Link; github: string; npm: string };
  footer: { released: string; docs: Link; changelog: Link; security: string; github: string; npm: string; author: string };
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

export const promise = (): string => fragments.sentence('README.md', 'Lawcheck', 1, 2);
export const support = (): string => fragments.sentence('docs/support.md', 'Supported environments', 1, 1);

export function head() {
  const copy = copyOf();
  return { title: copy.title, description: promise(), version: manifest.version, date: releaseDate(manifest.version), systems: /, on (.+)\.$/.exec(support())![1]! };
}

export async function facts() {
  const highlighter = await createHighlighter({ themes: [codeThemeOfBrand], langs: ['yaml'] });
  const code = (file: string, heading: string, n: number) => {
    const block = fragments.code(file, heading, n);
    return { text: block.code, html: highlighter.codeToHtml(block.code, { lang: block.lang === 'yaml' ? 'yaml' : 'text', theme: 'lawcheck' }) };
  };
  const md = (file: string) => (text: string) => inline(text, file, LINK.docs, GITHUB);
  const readme = md('README.md');
  const index = md('docs/index.md');
  const others = md('docs/other-tools.md');
  const copy = copyOf();
  const title = (page: string) => topics.find((topic) => topic.id === page)!.title;
  const link = (target: Link) => ({ text: target.text, href: pageUrl(target.page) });

  const law = code('README.md', 'Lawcheck', 1);
  const lawLines = law.text.split('\n');
  const core = lawLines.findIndex((line) => line.trim() === 'core:');
  const indent = lawLines[core]!.indexOf('core:');
  const after = lawLines.slice(core + 1);
  const end = after.findIndex((line) => line.length - line.trimStart().length <= indent);
  const still = [lawLines[core]!, ...(end === -1 ? after : after.slice(0, end))].map((line) => line.slice(indent));
  const install = fragments.code('docs/install.md', 'Install globally', 1).code.replace(/^\$ /, '');
  const groups = ['`CLAUDE.md` and `AGENTS.md`', 'An architecture tool for one language', 'A review bot at the pull request', 'A hook you wrote in Claude Code'];
  const rowsOf: Record<string, string[]> = {
    '`CLAUDE.md` and `AGENTS.md`': ['Your rules say how the agent works: commands, branches, messages', 'Your rules are about files: which layer may import which, what a file of one kind must hold'],
    'An architecture tool for one language': ['One language, and the tool already holds your layers in the test suite or the linter', 'Two or more languages under one set of layers'],
    'A review bot at the pull request': ['You want comments on the whole change, including on what no rule names', 'A rule must hold in every file of a kind, and the agent must hear it before it opens a pull request'],
    'A hook you wrote in Claude Code': ['Your hook runs the linter and the tests, and the linter already holds your layers', 'You want the law checked inside the turn, on the files of the turn, with at most three returns'],
  };
  const tables = groups.map((group) => fragments.rows('docs/other-tools.md', group, 1, rowsOf[group]!));

  return {
    copy: {
      ...copy,
      nav: { ...copy.nav, docs: link(copy.nav.docs) },
      install: { ...copy.install, quickStart: link(copy.install.quickStart) },
      comparison: link(copy.comparison),
      next: { ...copy.next, button: link(copy.next.button) },
      footer: { ...copy.footer, docs: link(copy.footer.docs), changelog: link(copy.footer.changelog) },
      notFound: { ...copy.notFound, docs: link(copy.notFound.docs) },
    },
    links: { github: GITHUB, npm: NPM, security: `${GITHUB}/blob/main/SECURITY.md`, author: 'https://chrisdudek.com', changelog: pageUrl('changelog') },
    head: head(),
    hero: {
      promise: readme(promise()),
      install,
      support: md('docs/support.md')(support()),
      alpha: readme(fragments.sentence('README.md', 'Try it', 1, 1)),
      sends: readme(fragments.sentence('README.md', 'Try it', 1, 3)),
      still: { file: '.lawcheck/law.yaml', html: highlighter.codeToHtml(still.join('\n'), { lang: 'yaml', theme: 'lawcheck' }) },
    },
    problem: readme(fragments.paragraph('README.md', 'Lawcheck', 2)),
    law: {
      heading: fragments.heading('docs/index.md', 'A law and a finding'),
      intro: readme(fragments.paragraph('README.md', 'Lawcheck', 3)),
      law: code('README.md', 'Lawcheck', 1).html,
      findingIntro: readme(fragments.paragraph('README.md', 'Lawcheck', 4)),
      finding: code('README.md', 'Lawcheck', 2).html,
    },
    where: {
      heading: fragments.heading('docs/index.md', 'Where it checks'),
      items: fragments.list('docs/index.md', 'Where it checks', 1).map(index),
      other: readme(fragments.sentence('README.md', 'Your coding agent', 4, 1)),
    },
    holds: {
      heading: fragments.heading('README.md', 'What one law holds'),
      items: fragments.list('README.md', 'What one law holds', 1).map(readme),
      link: { text: title(copy.holds.page), href: pageUrl(copy.holds.page) },
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
      heading: fragments.heading('README.md', 'Try it'),
      install: fragments.code('README.md', 'Try it', 1).code,
      quickStart: readme(fragments.sentence('README.md', 'Try it', 1, 6)),
      plugin: readme(fragments.paragraph('README.md', 'Your coding agent', 1)),
      pluginCommands: fragments.code('README.md', 'Your coding agent', 1).code,
    },
  };
}

export type Facts = Awaited<ReturnType<typeof facts>>;

export const watched = ['README.md', 'CHANGELOG.md', 'package.json', 'docs/*.md', 'docs/topics.json', 'site/landing/index.md'].map((path) => join(REPOSITORY, path));

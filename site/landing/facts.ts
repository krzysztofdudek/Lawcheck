import { join } from 'node:path';
import { parse } from 'yaml';
import topics from '../../docs/topics.json' with { type: 'json' };
import { GITHUB, LINK, manifest, NPM, REPOSITORY } from '../theme/brand.ts';
import { chapters } from '../theme/film.ts';
import { plain } from '../theme/describe.ts';
import { Fragments, inline, isAhead } from './fragments.ts';

type Link = { text: string; page: string };
type Cell = { pro: string } | { con: string };
export interface Copy {
  title: string;
  summary: string;
  skip: string;
  heroNote: string;
  facts: Array<{ label: string; text: string }>;
  why: { heading: string; head: string[]; rows: Array<{ label: string; cells: Cell[] }>; note: string; link: Link };
  law: { heading: string; law: { title: string; file: string }; rule: { title: string; file: string }; finding: { title: string; file: string }; hint: string };
  try: {
    heading: string;
    install: string;
    plugin: string;
    agents: Record<Agent, string>;
    notes: Record<Agent, string>;
    law: string;
    lawCommands: string[];
    lawNote: string;
    check: string;
    checkCommand: string;
    checkNote: string;
    hooks: string;
  };
  ci: { heading: string; command: string; note: string; link: Link; check: string; output: string[] };
  holds: { kicker: string; heading: string; cards: Array<{ title: string; text: string; page: string }> };
  measured: { before: string; count: string; after: string; list: string; scope: string };
  tutorial: { kicker: string; heading: string; chapter: string; titles: Record<string, string> };
  limits: { heading: string; items: string[]; link: Link };
  footer: { license: string; ahead: string; docs: Link; github: string; npm: string; author: string };
  copy: string;
  copied: string;
  notFound: { heading: string; text: string; docs: Link; home: string };
}
type Agent = 'claude' | 'codex' | 'copilot' | 'other';

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

export const support = (): string => fragments.sentence('docs/support.md', 'Supported environments', `Lawcheck ${manifest.version} runs on`);

export function head() {
  const copy = copyOf();
  return { title: copy.title, description: plain(copy.summary), version: manifest.version, date: releaseDate(manifest.version), ahead: isAhead(fragments.read('CHANGELOG.md')), systems: /, on (.+)\.$/.exec(support())![1]! };
}

const escape = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function lawLine(line: string): string {
  const key = /^(\s*)([\w-]+)(:)(.*)$/.exec(line);
  return key ? `${key[1]}<span class="y">${escape(key[2]!)}</span>:<span class="s">${escape(key[4]!)}</span>` : escape(line);
}

export const ruleLine = (line: string): string =>
  escape(line)
    .replace(/\b(export|function|const|return|if)\b/g, '<span class="k">$1</span>')
    .replace(/('[^']*')/g, '<span class="s">$1</span>');

export const findingLine = (line: string): string => escape(line).replace(/\bFAIL\b|error\[[\w-]+\]/g, (match) => `<span class="f">${match}</span>`);

function linesWhere(lines: string[], what: string, test: (line: string, at: number) => boolean): number[] {
  const found = lines.flatMap((line, at) => (test(line, at) ? [at] : []));
  if (found.length === 0) throw new Error(`site/landing: the block of README.md has no line ${what}, which the finding lights`);
  return found;
}

export function panes(law: string[], rule: string[], finding: string[]) {
  const findings = finding.flatMap((line, at) => {
    const code = /\berror\[([\w-]+)\]/.exec(line)?.[1];
    if (code === undefined) return [];
    return [{ code, lines: finding[at + 1]?.startsWith('  why:') ? [at, at + 1] : [at] }];
  });
  const links: Record<string, { law: number[]; rule: number[] }> = {};
  for (const { code } of findings) {
    if (code === 'forbidden-use') links[code] = { law: linesWhere(law, 'may_use', (line) => /^\s+may_use:/.test(line)), rule: [] };
    else {
      const entry = linesWhere(law, `${code}:`, (line) => line.trim() === `${code}:`);
      const used = linesWhere(law, `that lists ${code}`, (line) => new RegExp(`^\\s+rules:.*\\b${code}\\b`).test(line));
      links[code] = { law: [entry[0]!, entry[0]! + 1, ...used], rule: linesWhere(rule, 'that finds', (line) => /\.test\(|findings\.push\(/.test(line)) };
    }
  }
  const owner = new Map(findings.flatMap(({ code, lines }) => lines.map((at) => [at, code] as const)));
  return {
    law: law.map(lawLine),
    rule: rule.map(ruleLine),
    finding: finding.map((line, at) => ({ html: findingLine(line), link: owner.get(at) ?? '' })),
    links,
    first: findings[0]!.code,
  };
}

function listItem(file: string, heading: string, start: string): string {
  const found = fragments.list(file, heading, 1).filter((item) => item.startsWith(start));
  if (found.length !== 1) throw new Error(`site/landing: ${file} has ${found.length} items under "${heading}" that start with "${start}", and the landing page pulls exactly one`);
  return found[0]!;
}

const NUMBERS = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];

export function facts() {
  const md = (file: string) => (text: string) => inline(text, file, LINK.docs, GITHUB);
  const readme = md('README.md');
  const own = md('site/landing/index.md');
  const copy = copyOf();
  const link = (target: Link) => ({ text: target.text, href: pageUrl(target.page) });
  const withLink = (text: string, target: Link) => {
    const html = own(text);
    if (!html.includes('{link}')) throw new Error(`site/landing: index.md has no {link} in "${text}"`);
    return html.replace('{link}', `<a href="${pageUrl(target.page)}">${escape(target.text)}</a>`);
  };
  const lines = (heading: string, start: string) => fragments.code('README.md', heading, start).code.split('\n');
  const command = (file: string, heading: string, start: string) => fragments.code(file, heading, start).code.split('\n').map((line) => line.replace(/^\$ /, ''));
  const shown = chapters().toSorted((a, b) => a.number - b.number);
  const measured = 'What I measured';

  return {
    copy: { skip: copy.skip, copy: copy.copy, copied: copy.copied, heroNote: copy.heroNote },
    links: { docs: LINK.docs, github: GITHUB, npm: NPM },
    head: head(),
    lead: readme(fragments.sentence('README.md', 'Lawcheck', 'Lawcheck checks your coding agent')),
    facts: copy.facts.map((fact) => ({ label: fact.label, text: own(fact.text) })),
    why: {
      kicker: readme(fragments.heading('README.md', 'Why not `CLAUDE.md` or your linter')),
      heading: copy.why.heading,
      head: copy.why.head.map(own),
      rows: copy.why.rows.map((row) => ({ label: row.label, cells: row.cells.map((cell) => ('pro' in cell ? { pro: true, html: own(cell.pro) } : { pro: false, html: own(cell.con) })) })),
      note: withLink(copy.why.note, copy.why.link),
    },
    law: {
      kicker: readme(fragments.heading('README.md', 'A law, a rule and a finding')),
      heading: copy.law.heading,
      titles: { law: copy.law.law, rule: copy.law.rule, finding: copy.law.finding },
      panes: panes(lines('A law, a rule and a finding', 'lawcheck: '), lines('A law, a rule and a finding', 'export function check'), lines('A law, a rule and a finding', '$ lawcheck check')),
      hint: copy.law.hint,
    },
    tryIt: {
      kicker: readme(fragments.heading('README.md', 'Try it')),
      heading: copy.try.heading,
      install: { label: copy.try.install, commands: command('docs/install.md', 'Install globally', '$ npm install') },
      plugin: copy.try.plugin,
      agents: (['claude', 'codex', 'copilot', 'other'] as const).map((id) => ({
        id,
        label: copy.try.agents[id],
        note: own(copy.try.notes[id]),
        commands:
          id === 'claude' ? command('docs/plugin.md', 'The Claude Code plugin', 'claude plugin')
          : id === 'codex' ? command('docs/codex-cli.md', '2. Add the plugin', 'codex plugin')
          : id === 'copilot' ? command('docs/copilot-cli.md', '2. Add the plugin', 'copilot plugin')
          : command('docs/other-agents.md', '1. Add one line to the instructions file', 'Run `lawcheck prime`').map((line) => line.replace(/`/g, '')),
      })),
      law: { label: copy.try.law, commands: copy.try.lawCommands, note: own(copy.try.lawNote) },
      check: { label: copy.try.check, commands: [copy.try.checkCommand], note: own(copy.try.checkNote) },
      alpha: readme(fragments.paragraph('README.md', 'Try it', 'Lawcheck is an alpha')),
      hooks: own(copy.try.hooks),
    },
    ci: {
      kicker: readme(fragments.heading('README.md', 'In CI')),
      heading: copy.ci.heading,
      command: copy.ci.command,
      note: withLink(copy.ci.note, copy.ci.link),
      check: copy.ci.check,
      output: copy.ci.output.map(findingLine),
    },
    holds: { kicker: copy.holds.kicker, heading: copy.holds.heading, cards: copy.holds.cards.map((card) => ({ title: card.title, text: own(card.text), href: pageUrl(card.page) })) },
    measured: {
      kicker: readme(fragments.heading('README.md', measured)),
      why: readme(fragments.paragraph('README.md', measured, 'I build software')),
      before: own(copy.measured.before),
      count: copy.measured.count,
      after: own(copy.measured.after),
      arms: [readme(fragments.sentence('README.md', measured, 'In the 60 sessions')), own(copy.measured.list)].join(' '),
      limits: [own(copy.measured.scope), ...['I did not run sessions', 'It measured that one breach'].map((start) => readme(fragments.sentence('README.md', measured, start)))].join(' '),
    },
    tutorial: {
      kicker: copy.tutorial.kicker,
      heading: copy.tutorial.heading.replace('{count}', NUMBERS[shown.length] ?? String(shown.length)),
      chapters: shown.map((chapter) => {
        const title = copy.tutorial.titles[chapter.page];
        if (title === undefined) throw new Error(`site/landing: index.md has no title under tutorial.titles for the chapter ${chapter.page}, which film/published.json lists`);
        return { page: chapter.page, title, label: copy.tutorial.chapter.replace('{n}', String(chapter.number)), docs: pageUrl(chapter.page), poster: `/film/${chapter.files.jpg.name}` };
      }),
    },
    limits: {
      kicker: readme(fragments.heading('README.md', 'Limits')),
      heading: copy.limits.heading,
      items: [readme(listItem('README.md', 'Limits', 'After three returns')), ...copy.limits.items.map((item) => (item.includes('{link}') ? withLink(item, copy.limits.link) : own(item)))],
    },
    footer: {
      license: copy.footer.license,
      ahead: copy.footer.ahead.replace('{version}', manifest.version),
      docs: link(copy.footer.docs),
      github: copy.footer.github,
      npm: copy.footer.npm,
      author: copy.footer.author,
    },
  };
}

export type Facts = ReturnType<typeof facts>;

export const watched = ['README.md', 'CHANGELOG.md', 'package.json', 'docs/*.md', 'docs/topics.json', 'site/landing/index.md', 'film/published.json'].map((path) => join(REPOSITORY, path));

import { test } from 'node:test';
import { example } from '../harness/examples.ts';
import assert from 'node:assert/strict';
import { cpSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { append, check, findingLines, git, inTemp, LANGUAGES_SAMPLE, lawcheck, ROOT, write } from './helpers.ts';

const FINDINGS = example('dependency-l-findings').split('\n');

const UNRESOLVED = example('dependency-l-unresolved').split('\n');

function unresolvedLine(u: any): string {
  const answer = u.reason === null ? u.answer : `${u.answer} ${u.reason}`;
  return `${u.file}:${u.line}  ${answer}  ${u.what}${u.candidates.length === 0 ? '' : `  [${u.candidates.join(', ')}]`}`;
}

function makeL(dir: string): string {
  const repo = join(dir, 'l');
  cpSync(LANGUAGES_SAMPLE, repo, { recursive: true });
  git(repo, 'init', '-q', '-b', 'main');
  git(repo, 'add', '-A');
  git(repo, 'commit', '-q', '-m', 'l');
  return repo;
}

function place(finding: { file: string; line?: number }): string {
  return finding.line === undefined ? finding.file : `${finding.file}:${finding.line}`;
}

test('test 88: one use from domain to app in each language', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    const run = await lawcheck(l, ['check', '--json']);
    const document = JSON.parse(run.stdout);
    assert.deepEqual(document.scope, { mode: 'change', base: null, files: 36, law_changed: false });
    assert.deepEqual(document.summary, { errors: 15, warnings: 1, debt: 0, waivers: 0, unresolved: 7 });
    assert.deepEqual(
      document.findings.map((f: any) => `${place(f)}  ${f.severity}[${f.code}]  ${f.message}`),
      FINDINGS,
    );
    assert.ok(document.findings.every((f: any) => f.rule === null && f.debt === false), run.stdout);
    assert.deepEqual(
      document.unresolved.map(unresolvedLine),
      UNRESOLVED,
    );
    assert.ok(document.unresolved.every((u: any) => u.debt === false), run.stdout);
    assert.equal(run.code, 1);

    const text = await lawcheck(l, ['check']);
    assert.equal(text.stdout.split('\n')[0], 'lawcheck: FAIL  15 errors, 1 warning in 36 files (no base: every file counts as changed), 7 unresolved uses');
    assert.deepEqual(findingLines(text.stdout), FINDINGS);

    git(l, 'checkout', '-q', '-b', 'work');
    append(l, 'kotlin/src/main/kotlin/com/acme/k/domain/Order.kt', '// end\n');
    append(l, 'cs/domain/Order.cs', '// end\n');
    append(l, 'ruby/domain/order.rb', '# end\n');
    const changed = await check(l);
    assert.equal(changed.stdout.split('\n')[0], 'lawcheck: FAIL  4 errors in 3 changed files (against main), 1 unresolved use');
    assert.deepEqual(
      findingLines(changed.stdout),
      FINDINGS.filter((line) => /^(cs\/domain\/Order\.cs:5|kotlin\/src\/main\/kotlin\/com\/acme\/k\/domain\/Order\.kt:3|ruby\/domain\/order\.rb:[16])  /.test(line)),
    );
    assert.equal(findingLines(changed.stdout).length, 4);
    assert.equal(changed.code, 1);
  });
});

test('test 88: debt, every finding and unresolved use of L outside the change', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    git(l, 'checkout', '-q', '-b', 'work');
    const run = await check(l, '--full', '--base', 'main');
    const lines = run.stdout.split('\n');
    assert.equal(lines[0], 'lawcheck: PASS  nothing changed against main');
    assert.ok(lines.includes('debt (outside this change): 16 findings in 15 files, 7 unresolved uses'), run.stdout);
    assert.deepEqual(findingLines(run.stdout), FINDINGS.map((line) => line.replace('  error[', '  warning[')));
    assert.equal(run.code, 0);
    const json = await check(l, '--full', '--base', 'main', '--json');
    const document = JSON.parse(json.stdout);
    assert.equal(document.summary.unresolved, 0);
    assert.equal(document.summary.debt, 16);
    assert.ok(document.findings.some((f: any) => f.code === 'uses-not-read' && f.debt === true), json.stdout);
    assert.deepEqual(document.unresolved.map(unresolvedLine), UNRESOLVED);
    assert.ok(document.unresolved.every((u: any) => u.debt === true), json.stdout);
    assert.equal(json.code, 0);
  });
});

const L_RULES = (rule: string) => `rules:\n  ${rule}:\n    why: The rule reads what Lawcheck reads of the file.\n\n`;

function withRuleOnL(l: string, rule: string, source: string): void {
  const law = readFileSync(join(l, '.lawcheck/law.yaml'), 'utf8')
    .replace('types:\n', `${L_RULES(rule)}types:\n`)
    .replace(/    may_use: \[(.*)\]\n/g, `    may_use: [$1]\n    rules: [${rule}]\n`);
  write(l, '.lawcheck/law.yaml', law);
  write(l, `.lawcheck/rules/${rule}.mjs`, source);
  git(l, 'add', '-A');
  git(l, 'commit', '-q', '-m', rule);
}

const TREE_RULE = `export async function check({ files: [file] }) {
  const { language, root, absent } = await file.tree();
  if (root === null) return [{ message: \`\${language} absent \${absent}\` }];
  const starts = [0];
  for (let at = 0; at < file.text.length; at++) if (file.text[at] === '\\n') starts.push(at + 1);
  const problems = [];
  const stack = [root];
  while (stack.length > 0) {
    const node = stack.pop();
    if (Object.keys(node).join(',') !== 'type,named,field,start,end,line,column,children') problems.push('keys ' + Object.keys(node).join(','));
    const line = starts.filter((start) => start <= node.start).length;
    if (node.line !== line || node.column !== node.start - starts[line - 1]) problems.push(\`\${node.type} at \${node.start} says \${node.line}:\${node.column}\`);
    let after = node.start;
    for (const child of node.children) {
      if (child.start < after || child.end > node.end) problems.push(\`\${child.type} at \${child.start} outside \${node.type}\`);
      if (child.field !== null && typeof child.field !== 'string') problems.push('field ' + child.field);
      after = child.end;
      stack.push(child);
    }
  }
  const first = root.children.find((child) => child.named);
  const text = file.text.slice(first.start, first.end).split('\\n')[0];
  return [{ message: \`\${language} \${root.type}, first \${first.type} \${JSON.stringify(text)}, \${problems.length === 0 ? 'no problem' : problems.slice(0, 3).join('; ')}\` }];
}
`;

test('test 773: a rule that asks for the tree gets the tree of its file in each of the twelve languages', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    withRuleOnL(l, 'tree', TREE_RULE);
    const run = await lawcheck(l, ['check', '--json']);
    assert.equal(run.stderr, '');
    const document = JSON.parse(run.stdout);
    const said = document.findings.filter((f: any) => f.rule === 'tree').map((f: any) => `${f.file}  ${f.message}`);
    assert.deepEqual(said, [
      'c/app/service.h  c translation_unit, first declaration "int run(void);", no problem',
      'c/domain/order.c  c translation_unit, first preproc_include "#include \\"../app/service.h\\"", no problem',
      'cpp/app/service.hpp  cpp translation_unit, first declaration "int run();", no problem',
      'cpp/domain/order.cpp  cpp translation_unit, first preproc_include "#include \\"../app/service.hpp\\"", no problem',
      'cs/app/Clock.cs  csharp compilation_unit, first file_scoped_namespace_declaration "namespace Shop.App;", no problem',
      'cs/app/Service.cs  csharp compilation_unit, first file_scoped_namespace_declaration "namespace Shop.App;", no problem',
      'cs/domain/Order.cs  csharp compilation_unit, first using_directive "using Shop.App;", no problem',
      'go/app/service.go  go source_file, first package_clause "package app", no problem',
      'go/domain/order.go  go source_file, first package_clause "package domain", no problem',
      'java/src/main/java/com/acme/app/Service.java  java program, first package_declaration "package com.acme.app;", no problem',
      'java/src/main/java/com/acme/domain/Order.java  java program, first package_declaration "package com.acme.domain;", no problem',
      'js/app/tax.js  javascript program, first expression_statement "module.exports = 1;", no problem',
      'js/domain/total.js  javascript program, first lexical_declaration "const tax = require(\\"../app/tax.js\\");", no problem',
      'kotlin/src/main/kotlin/com/acme/k/app/Service.kt  kotlin source_file, first package_header "package com.acme.k.app", no problem',
      'kotlin/src/main/kotlin/com/acme/k/domain/Order.kt  kotlin source_file, first package_header "package com.acme.k.domain", no problem',
      'php/src/app/Service.php  php program, first php_tag "<?php", no problem',
      'php/src/domain/Order.php  php program, first php_tag "<?php", no problem',
      'py/shop/app/service.py  python module, first function_definition "def run():", no problem',
      'py/shop/domain/order.py  python module, first import_from_statement "from shop.app.service import run", no problem',
      'py/shop/domain/rules.py  python module, first expression_statement "limit = 10", no problem',
      'ruby/app/service.rb  ruby program, first module "module Shop", no problem',
      'ruby/domain/order.rb  ruby program, first call "require_relative \\"../app/service\\"", no problem',
      'rust/src/app/mod.rs  rust source_file, first function_item "pub fn run() -> i32 { 1 }", no problem',
      'rust/src/domain/mod.rs  rust source_file, first use_declaration "use crate::app::run;", no problem',
      'ts/app/service.ts  typescript program, first export_statement "export const charge = (n: number) => n;", no problem',
      'ts/domain/order.ts  typescript program, first import_statement "import { charge } from \\"../app/service\\";", no problem',
      'ts/domain/schema.json  null absent no-reader',
      'ts/domain/widget.tsx  tsx program, first import_statement "import { charge } from \\"../app/service\\";", no problem',
      'vue/domain/Card.vue  typescript program, first import_statement "import { charge } from \\"../../ts/app/service\\";", no problem',
    ]);
    assert.equal(run.code, 1);
  });
});

const USES_RULE = `export async function check({ files: [file] }) {
  return [{ message: JSON.stringify(await file.uses()) }];
}
`;

test('test 774: a rule that asks for the uses gets the same resolved uses that may_use judges, with their target files and types', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    withRuleOnL(l, 'uses', USES_RULE);
    const run = await lawcheck(l, ['check', '--json']);
    assert.equal(run.stderr, '');
    const document = JSON.parse(run.stdout);
    const mayUse: Record<string, string[]> = { domain: ['domain'], app: ['app', 'domain'] };
    const forbidden: string[] = [];
    const unresolved: string[] = [];
    let targets = 0;
    for (const finding of document.findings.filter((f: any) => f.rule === 'uses')) {
      const { uses, absent } = JSON.parse(finding.message);
      if (finding.file === 'ts/domain/schema.json') {
        assert.deepEqual([uses, absent], [null, 'no-reader']);
        continue;
      }
      assert.equal(absent, null, finding.file);
      const seen = new Set<string>();
      for (const use of uses) {
        if (use.kind === 'outside') continue;
        if (use.kind !== 'file') {
          unresolved.push(`${finding.file}:${use.line}  ${use.kind}${use.reason ? ` ${use.reason}` : ''}  ${use.what}  [${use.candidates.join(', ')}]`);
          continue;
        }
        targets++;
        if (use.file === finding.file || (use.type !== null && mayUse[finding.type]!.includes(use.type))) continue;
        if (seen.has(`${use.line} ${use.file}`)) continue;
        seen.add(`${use.line} ${use.file}`);
        forbidden.push(`${finding.file}:${use.line}  ${use.type ?? 'no type'}  ${use.file}`);
      }
    }
    const judged = document.findings
      .filter((f: any) => f.code === 'forbidden-use')
      .map((f: any) => {
        const named = /^\S+ may not use (?:(\S+) \((.+)\)|(.+), which has no type);/.exec(f.message)!;
        return `${f.file}:${f.line}  ${named[1] ?? 'no type'}  ${named[2] ?? named[3]}`;
      });
    assert.ok(targets > judged.length, run.stdout);
    assert.deepEqual(forbidden.sort(), judged.sort());
    assert.deepEqual(unresolved.sort(), document.unresolved.map((u: any) => `${u.file}:${u.line}  ${u.answer}${u.reason === null ? '' : ` ${u.reason}`}  ${u.what}  [${u.candidates.join(', ')}]`).sort());
    assert.equal(run.code, 1);
  });
});

const SAME_RULE = `import { createHash } from 'node:crypto';

export async function check({ files: [file] }) {
  const read = JSON.stringify({ tree: await file.tree(), uses: await file.uses() });
  return [{ message: createHash('sha256').update(read).digest('hex') }];
}
`;

test('test 776: a plain check and --full give a rule the same tree and uses for the same file', async () => {
  await inTemp(async (dir) => {
    const l = makeL(dir);
    withRuleOnL(l, 'same', SAME_RULE);
    git(l, 'checkout', '-q', '-b', 'work');
    const changed = ['kotlin/src/main/kotlin/com/acme/k/domain/Order.kt', 'cs/domain/Order.cs', 'ruby/domain/order.rb', 'ts/domain/order.ts', 'py/shop/domain/order.py'];
    for (const path of changed) append(l, path, path.endsWith('.rb') || path.endsWith('.py') ? '# end\n' : '// end\n');
    const said = (run: { stdout: string }) => new Map<string, string>(JSON.parse(run.stdout).findings.filter((f: any) => f.rule === 'same').map((f: any) => [f.file, f.message]));
    const plain = said(await lawcheck(l, ['check', '--base', 'main', '--json']));
    const full = said(await lawcheck(l, ['check', '--full', '--base', 'main', '--json']));
    assert.deepEqual([...plain.keys()].sort(), [...changed].sort());
    assert.equal(full.size, 29);
    for (const path of changed) assert.equal(plain.get(path), full.get(path), path);
    assert.equal(new Set(full.values()).size, 29);
  });
});

const GRAMMAR_ROWS: Record<string, string> = {
  'v0.23.2 + upstream PRs #357 #358 #364 #365, regenerated': '0.23.2, with four fixes from the grammar\'s own repository',
  'master after 0.23.5 (unreleased): C# 14': 'a commit after 0.23.5, not released, that reads C# 14',
  'master after 0.23.4 (unreleased)': 'a commit after 0.23.4, not released',
  'master after 0.24.2 (unreleased)': 'a commit after 0.24.2, not released',
  'master after 0.23.1 (unreleased)': 'a commit after 0.23.1, not released',
};

test('test 773: docs/script-rules.md names the version of Runes and the grammar version of each language that Runes pins', () => {
  const runes = join(ROOT, 'node_modules', '@chrisdudek', 'runes');
  const manifest = JSON.parse(readFileSync(join(runes, 'grammars', 'manifest.json'), 'utf8'));
  const page = readFileSync(join(ROOT, 'docs', 'script-rules.md'), 'utf8');
  assert.ok(page.includes(`Lawcheck ships the grammars of Runes ${JSON.parse(readFileSync(join(runes, 'package.json'), 'utf8')).version}:`));
  const versionOf = (language: string) => {
    const pinned = manifest.grammars.find((grammar: any) => grammar.language === language).version;
    const written = GRAMMAR_ROWS[pinned] ?? pinned;
    assert.match(written, /^(\d+\.\d+\.\d+|.* .*)$/, `${language}: ${pinned}`);
    return written;
  };
  const expected = [['typescript', 'tsx'], ['javascript'], ['python'], ['go'], ['rust'], ['java'], ['kotlin'], ['csharp'], ['c'], ['cpp'], ['php'], ['ruby']].map((languages) => {
    const versions = [...new Set(languages.map(versionOf))];
    assert.equal(versions.length, 1, languages.join(', '));
    return `| ${languages.map((language) => `\`${language}\``).join(', ')} | ${versions[0]} |`;
  });
  const at = page.indexOf('| `language` | Version of the grammar |');
  assert.deepEqual(page.slice(at, page.indexOf('\n\n', at)).split('\n').slice(2), expected);
});

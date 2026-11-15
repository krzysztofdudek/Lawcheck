import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { findingLines, git, inTemp, lawcheck, write } from './helpers.ts';

const LAW = [
  'lawcheck: 0.1.0',
  '',
  'types:',
  '  domain:',
  '    paths: ["**/domain/**"]',
  '    may_use: [domain]',
  '  app:',
  '    paths: ["**/app/**"]',
  '    may_use: [app, domain]',
  '  infra:',
  '    paths: ["**/infra/**"]',
  '',
].join('\n');

async function inRepo(files: Record<string, string>, body: (repo: string) => Promise<void>): Promise<void> {
  await inTemp(async (dir) => {
    const repo = join(dir, 'r');
    write(repo, '.lawcheck/law.yaml', LAW);
    for (const [path, text] of Object.entries(files)) write(repo, path, text);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'r');
    await body(repo);
  });
}

test('dependency-slice §3.5: targets are counted by type, so a partial class spread over one type binds its first file, and over two types is ambiguous', async () => {
  await inRepo(
    {
      'cs/app/Clock.A.cs': 'namespace Shop.App;\n\npublic partial class Clock {}\n',
      'cs/app/Clock.B.cs': 'namespace Shop.App;\n\npublic partial class Clock { public int Tick; }\n',
      'cs/app/Ledger.cs': 'namespace Shop.App;\n\npublic partial class Ledger {}\n',
      'cs/infra/Ledger.cs': 'namespace Shop.App;\n\npublic partial class Ledger { public int Rows; }\n',
      'cs/domain/Order.cs': 'using Shop.App;\n\nnamespace Shop.Domain;\n\npublic class Order { public Clock C; public Ledger L; }\n',
    },
    async (repo) => {
      const run = await lawcheck(repo, ['check', '--json']);
      const document = JSON.parse(run.stdout);
      const domain = document.findings.filter((f: any) => f.file === 'cs/domain/Order.cs');
      assert.deepEqual(
        domain.map((f: any) => `${f.file}:${f.line}  ${f.severity}[${f.code}]  ${f.message}`),
        ['cs/domain/Order.cs:5  error[forbidden-use]  domain may not use app (cs/app/Clock.A.cs); its may_use is [domain]'],
      );
      assert.deepEqual(
        document.unresolved.filter((u: any) => u.file === 'cs/domain/Order.cs').map((u: any) => `${u.line}  ${u.answer}  ${u.what}  [${u.candidates.join(', ')}]`),
        ['5  ambiguous  Shop.Domain.Order+Ledger  [cs/app/Ledger.cs, cs/infra/Ledger.cs]'],
      );
      assert.equal(run.code, 1);
    },
  );
});

test('dependency-slice §3.1: a name of the same package written without an import is a use', async () => {
  await inRepo(
    {
      'java/src/main/java/com/acme/domain/Order.java': 'package com.acme;\n\npublic class Order {\n  Service s;\n}\n',
      'java/src/main/java/com/acme/app/Service.java': 'package com.acme;\n\npublic class Service {}\n',
    },
    async (repo) => {
      const run = await lawcheck(repo, ['check']);
      assert.deepEqual(findingLines(run.stdout), [
        'java/src/main/java/com/acme/domain/Order.java:4  error[forbidden-use]  domain may not use app (java/src/main/java/com/acme/app/Service.java); its may_use is [domain]',
      ]);
      assert.equal(run.code, 1);
    },
  );
});

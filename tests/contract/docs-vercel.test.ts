import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse } from 'yaml';
import { ROOT } from '../harness/sets.ts';
import { problems, vercelConfig } from '../../site/docs-vercel.mjs';

const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');
const topics = JSON.parse(read('docs/topics.json')) as Array<{ id: string }>;

type Step = { name?: string; uses?: string; run?: string; if?: string; env?: Record<string, string> };
type Workflow = { on: { workflow_run?: unknown; workflow_dispatch?: { inputs?: { production?: unknown } } }; jobs: Record<string, { needs?: string; environment?: string; steps: Step[] }> };

test('test 1051: the redirects of the documentation host send the form without .html of every page of docs/topics.json, and /index and /index.html, to the one address the page names, and no other form (control)', () => {
  const config = vercelConfig([{ id: 'index' }, { id: 'install' }, { id: 'quick-start' }]);
  assert.deepEqual(config.redirects, [
    { source: '/index', destination: '/', permanent: true },
    { source: '/index.html', destination: '/', permanent: true },
    { source: '/:page(install|quick-start)', destination: '/:page.html', permanent: true },
  ]);
  const real = vercelConfig(topics);
  const listed = /^\/:page\((.*)\)$/.exec(real.redirects[2]!.source)![1]!.split('|');
  assert.deepEqual(listed, topics.map((topic) => topic.id).filter((id) => id !== 'index'));
  assert.equal(listed.length, topics.length - 1);
  assert.ok(real.redirects.every((redirect) => redirect.permanent === true));
  assert.ok(listed.every((id) => /^[a-z0-9-]+$/.test(id)), 'a page id with a dot or a slash would match a file of the build');
  assert.ok(!listed.includes('index'));
});

test('test 1052: the check of the built documentation names each page of docs/topics.json that is missing and a missing 404 page, and passes a whole site (control)', () => {
  const dir = mkdtempSync(join(tmpdir(), 'lawcheck-docs-vercel-'));
  try {
    const pages = [{ id: 'index' }, { id: 'install' }];
    for (const name of ['index.html', 'install.html', '404.html']) writeFileSync(join(dir, name), 'x');
    assert.deepEqual(problems(dir, pages), []);
    rmSync(join(dir, 'install.html'));
    assert.deepEqual(problems(dir, pages), ['install.html is missing, and docs/topics.json lists the page install']);
    rmSync(join(dir, 'index.html'));
    rmSync(join(dir, '404.html'));
    assert.deepEqual(problems(dir, pages), ['index.html is missing, and docs/topics.json lists the page index', 'install.html is missing, and docs/topics.json lists the page install', '404.html is missing']);
    mkdirSync(join(dir, 'assets'));
    assert.deepEqual(problems(dir, []), ['404.html is missing']);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('test 1053: the workflow that deploys the documentation to Vercel holds the token in one job that runs no code of the repository, pins the CLI as the landing page does, deploys its own project, and deploys to production only after a release or on the production input (control)', () => {
  const docs = parse(read('.github/workflows/docs-vercel.yml')) as Workflow;
  const landing = parse(read('.github/workflows/landing.yml')) as Workflow;
  assert.ok(docs.on.workflow_run && docs.on.workflow_dispatch?.inputs?.production);
  const build = docs.jobs.build!;
  const deploy = docs.jobs.deploy!;
  assert.equal(deploy.needs, 'build');
  assert.equal(deploy.environment, 'vercel');
  assert.ok(build.steps.every((step) => !JSON.stringify(step).includes('VERCEL_TOKEN')), 'the build job holds no token');
  assert.deepEqual(deploy.steps.map((step) => step.uses ?? step.run), ['actions/download-artifact@v8', 'actions/setup-node@v7', 'npx --yes vercel@66.6.0 deploy docs --prod --yes', 'npx --yes vercel@66.6.0 deploy docs --yes']);
  const cli = (workflow: Workflow): string[] => workflow.jobs.deploy!.steps.map((step) => /vercel@[\d.]+/.exec(step.run ?? '')?.[0]).filter((version): version is string => version !== undefined);
  assert.deepEqual([...new Set(cli(docs))], [...new Set(cli(landing))]);
  const projects = deploy.steps.map((step) => step.env?.VERCEL_PROJECT_ID).filter((id) => id !== undefined);
  assert.deepEqual(projects, ['${{ vars.VERCEL_DOCS_PROJECT_ID }}', '${{ vars.VERCEL_DOCS_PROJECT_ID }}']);
  assert.notEqual(projects[0], landing.jobs.deploy!.steps.find((step) => step.env?.VERCEL_PROJECT_ID)?.env?.VERCEL_PROJECT_ID);
  assert.equal(deploy.steps[2]!.if, "github.event_name == 'workflow_run' || inputs.production");
  assert.equal(deploy.steps[3]!.if, "github.event_name == 'workflow_dispatch' && !inputs.production");
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { git, inTemp, lawcheck, newRepository, NO_CONSOLE, NO_TODO, write } from './helpers.ts';

type Validator = ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
type Compiler = new (options: object) => { compile(schema: object): Validator };

interface Result {
  ruleId: string;
  ruleIndex: number;
  level: string;
  message: { text: string };
  locations: { physicalLocation: { artifactLocation: { uri: string; uriBaseId?: string }; region: { startLine: number } } }[];
}
interface Rule {
  id: string;
  shortDescription: { text: string };
  fullDescription: { text: string };
  help: { text: string };
}
interface Log {
  $schema: string;
  version: string;
  runs: { tool: { driver: { name: string; semanticVersion: string; rules: Rule[] } }; results: Result[] }[];
}
interface Finding {
  code: string;
  severity: string;
  file: string;
  line?: number;
  message: string;
  why: string;
}

const require = createRequire(import.meta.url);
const SCHEMAS = new URL('./sarif/', import.meta.url);
const schemaOf = (name: string) => JSON.parse(readFileSync(new URL(name, SCHEMAS), 'utf8')) as Record<string, unknown>;

// RFC 3986: what a URI and a URI reference may hold, with every % starting an escape of two hexadecimal digits.
const REFERENCE = /^(?:[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=]|%[0-9A-Fa-f]{2})*$/;
const FORMATS = {
  uri: (text: string) => /^[A-Za-z][A-Za-z0-9+.-]*:/.test(text) && REFERENCE.test(text),
  'uri-reference': (text: string) => REFERENCE.test(text),
  'date-time': (text: string) => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/.test(text),
};

let compiled: [string, Validator][] | null = null;

function validators(): [string, Validator][] {
  if (compiled !== null) return compiled;
  const Ajv = require('ajv') as Compiler;
  const Ajv2020 = (require('ajv/dist/2020') as { default: Compiler }).default;
  // The OASIS file is written for draft 04, which Ajv 8 no longer reads; draft 07 reads the same keywords alike but names the id $id.
  const { id, $schema, ...oasis } = schemaOf('sarif-2.1.0.schema.json');
  assert.equal($schema, 'http://json-schema.org/draft-04/schema#');
  const draft7 = new Ajv({ allErrors: true, strict: false, formats: FORMATS }).compile({ $schema: 'http://json-schema.org/draft-07/schema#', $id: id, ...oasis });
  // GitHub's copy holds the anyOf of region inside its properties, which the validator of the upload action reads as one more property; Ajv refuses such a schema unless it is told not to check it.
  const github = new Ajv2020({ allErrors: true, strict: false, validateSchema: false, formats: FORMATS }).compile(schemaOf('github-sarif-2.1.0.schema.json'));
  compiled = [
    ['the OASIS schema', draft7],
    ["the schema of GitHub's upload action", github],
  ];
  return compiled;
}

function assertValid(log: unknown): void {
  for (const [name, validate] of validators()) {
    assert.ok(validate(log), `${name}: ${(validate.errors ?? []).map((e) => `${e.instancePath} ${e.message}`).join('; ')}`);
  }
}

// The properties GitHub's page on SARIF support marks as required, and the checks its upload action makes past the schema.
function assertGitHubReads(log: Log): void {
  assert.equal(log.version, '2.1.0');
  assert.equal(log.$schema, 'https://docs.oasis-open.org/sarif/sarif/v2.1.0/errata01/os/schemas/sarif-schema-2.1.0.json');
  assert.equal(log.runs.length, 1, 'one run, so one upload holds one category');
  const run = log.runs[0]!;
  assert.equal(run.tool.driver.name, 'Lawcheck');
  assert.ok(Array.isArray(run.results));
  const ids = run.tool.driver.rules.map((rule) => rule.id);
  assert.equal(new Set(ids).size, ids.length, 'each rule once');
  for (const rule of run.tool.driver.rules) for (const text of [rule.shortDescription.text, rule.fullDescription.text, rule.help.text]) assert.ok(text.length > 0, rule.id);
  for (const result of run.results) {
    assert.equal(ids[result.ruleIndex], result.ruleId);
    assert.ok(result.message.text.length > 0);
    assert.ok(['error', 'warning'].includes(result.level), result.level);
    assert.equal(result.locations.length, 1);
    const { artifactLocation, region } = result.locations[0]!.physicalLocation;
    assert.ok(!artifactLocation.uri.startsWith('/') && !artifactLocation.uri.includes('://'), `${artifactLocation.uri}: a path from the top of the repository`);
    assert.equal(artifactLocation.uriBaseId, '%SRCROOT%');
    assert.ok(Number.isInteger(region.startLine) && region.startLine >= 1);
  }
}

function assertSameFindings(log: Log, findings: Finding[], prefix: string): void {
  const results = log.runs[0]!.results;
  assert.equal(results.length, findings.length, 'one result per finding');
  results.forEach((result, at) => {
    const finding = findings[at]!;
    assert.equal(result.ruleId, finding.code);
    assert.equal(result.level, finding.severity);
    assert.equal(result.message.text, finding.message);
    const { artifactLocation, region } = result.locations[0]!.physicalLocation;
    assert.equal(decodeURIComponent(artifactLocation.uri), prefix + finding.file);
    assert.equal(region.startLine, finding.line ?? 1, 'a finding about the whole file is on line 1');
    const rule = log.runs[0]!.tool.driver.rules[result.ruleIndex]!;
    assert.equal(rule.shortDescription.text, finding.why);
  });
}

const LAW = `lawcheck: 0.1.0

rules:
  no-console:
    why: Only the command layer writes to the terminal.
  no-todo:
    why: A TODO without an issue number gets forgotten.
    status: advisory
  whole-file:
    why: A file marked WHOLE is wrong as a whole.

types:
  library:
    paths: ["src/core/**"]
    rules: [no-console, no-todo, whole-file]
`;
const WHOLE_FILE = "export function check({ files }) {\n  return files.flatMap((file) => file.lines.filter((line) => line.includes('WHOLE')).map((line) => ({ file: file.path, message: `marked: ${line}` })));\n}\n";
const KEY = 'sk-sarif-test-key-0123456789';
// The file goes into the test's folder beside the repository, as a CI job writes it beside its checkout.
const WRITES = { outside: ['lawcheck.sarif'] };
const FILES = { '.lawcheck/law.yaml': LAW, '.lawcheck/rules/no-console.mjs': NO_CONSOLE, '.lawcheck/rules/no-todo.mjs': NO_TODO, '.lawcheck/rules/whole-file.mjs': WHOLE_FILE };

function readLog(path: string): Log {
  const text = readFileSync(path, 'utf8');
  assert.ok(!/[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029]/.test(text), 'the file holds no control character raw');
  return JSON.parse(text) as Log;
}

test('test 970: check --sarif writes SARIF 2.1.0 that both schemas and GitHub accept, one result per finding with its file, line and rule, and prints what it prints without it', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, { ...FILES, 'src/core/old.ts': "export const old = () => console.log('old');\n" });
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/total.ts', 'export function total(price: number): number {\n  console.log(price);\n  // TODO tidy\n  return price;\n}\n');
    write(repo, 'src/core/a b ż#%.ts', `// WHOLE ${KEY}\n`);
    const env = { LAWCHECK_REVIEWER_KEY: KEY };
    const out = join(dir, 'lawcheck.sarif');
    const plain = await lawcheck(repo, ['check', '--base', 'main'], env);
    const json = await lawcheck(repo, ['check', '--base', 'main', '--json'], env);
    const sarif = await lawcheck(repo, ['check', '--base', 'main', '--sarif', out], env, [], WRITES);
    assert.deepEqual([sarif.code, sarif.stdout], [plain.code, plain.stdout], 'the text output and the exit code stay as they are');
    assert.equal(sarif.code, 1);
    const log = readLog(out);
    assertValid(log);
    assertGitHubReads(log);
    const findings = (JSON.parse(json.stdout) as { findings: Finding[] }).findings;
    assert.deepEqual(findings.map((finding) => [finding.code, finding.severity, finding.line ?? null]), [
      ['whole-file', 'error', null],
      ['no-console', 'error', 2],
      ['no-todo', 'warning', 3],
    ]);
    assertSameFindings(log, findings, '');
    assert.equal(log.runs[0]!.results[0]!.locations[0]!.physicalLocation.artifactLocation.uri, 'src/core/a%20b%20%C5%BC%23%25.ts', 'a path is written as a URI');
    assert.ok(!readFileSync(out, 'utf8').includes(KEY), 'the key is not in the file');
    assert.equal(log.runs[0]!.results[0]!.message.text, 'marked: // WHOLE [key]');
    assert.deepEqual(log.runs[0]!.tool.driver.rules.map((rule) => [rule.id, rule.help.text]), [
      ['no-console', 'Only the command layer writes to the terminal.\n\nlawcheck explain --rule no-console'],
      ['no-todo', 'A TODO without an issue number gets forgotten.\n\nlawcheck explain --rule no-todo'],
      ['whole-file', 'A file marked WHOLE is wrong as a whole.\n\nlawcheck explain --rule whole-file'],
    ]);
    assert.equal(log.runs[0]!.tool.driver.semanticVersion, (JSON.parse(readFileSync(new URL('../../package.json', import.meta.url), 'utf8')) as { version: string }).version);

    const both = await lawcheck(repo, ['check', '--base', 'main', '--json', '--sarif', out], env, [], WRITES);
    assert.deepEqual([both.code, both.stdout], [json.code, json.stdout], 'with --json, the document stays as it is');

    const full = await lawcheck(repo, ['check', '--base', 'main', '--full', '--json', '--sarif', out], env, [], WRITES);
    const debt = (JSON.parse(full.stdout) as { findings: Finding[] }).findings;
    assert.equal(debt.at(-1)!.file, 'src/core/old.ts');
    const fullLog = readLog(out);
    assertValid(fullLog);
    assertSameFindings(fullLog, debt, '');
    assert.equal(fullLog.runs[0]!.results.at(-1)!.level, 'warning', 'debt is a warning without --strict');

    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', 'work');
    git(repo, 'checkout', '-q', 'main');
    const clean = await lawcheck(repo, ['check', '--base', 'main', '--sarif', out], {}, [], WRITES);
    assert.equal(clean.code, 0);
    const empty = readLog(out);
    assertValid(empty);
    assertGitHubReads(empty);
    assert.deepEqual([empty.runs[0]!.results, empty.runs[0]!.tool.driver.rules], [[], []], 'a check with no finding writes a run with no result');
  });
});

test('test 971: check --sarif names each file from the top of the repository when the law sits below it', async () => {
  await inTemp(async (dir) => {
    const files = Object.fromEntries(Object.entries(FILES).map(([path, text]) => [`pkg/${path}`, text]));
    const repo = newRepository(dir, files);
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'pkg/src/core/total.ts', 'console.log(1);\n');
    const out = join(dir, 'lawcheck.sarif');
    const sarif = await lawcheck(join(repo, 'pkg', 'src'), ['check', '--base', 'main', '--sarif', '../../../lawcheck.sarif'], {}, [], WRITES);
    assert.equal(sarif.code, 1, sarif.stdout);
    const log = readLog(out);
    assertValid(log);
    assertGitHubReads(log);
    assertSameFindings(log, [{ code: 'no-console', severity: 'error', file: 'src/core/total.ts', line: 1, message: 'writes to the terminal with console.log', why: 'Only the command layer writes to the terminal.' }], 'pkg/');
  });
});

test('test 972: check --sarif writes no file when the check has no result, stops with file-unwritable when it cannot write, takes no paths, and its usage line names it', async () => {
  await inTemp(async (dir) => {
    const repo = newRepository(dir, FILES);
    git(repo, 'checkout', '-q', '-b', 'work');
    write(repo, 'src/core/total.ts', 'console.log(1);\n');
    const out = join(dir, 'lawcheck.sarif');
    const refused = await lawcheck(repo, ['check', '--base', 'nope', '--sarif', out]);
    assert.equal(refused.code, 2);
    assert.match(refused.stdout, /error\[base-unreachable\]/);
    assert.equal(existsSync(out), false, 'a run with no conclusion writes no SARIF, so an upload cannot close the alerts');

    const missing = join(dir, 'no-such-folder', 'lawcheck.sarif');
    const unwritable = await lawcheck(repo, ['check', '--base', 'main', '--sarif', missing, '--json']);
    assert.equal(unwritable.code, 2);
    const error = JSON.parse(unwritable.stdout) as { schema: string; errors: { code: string; file: string; message: string }[]; next: { text: string } };
    assert.equal(error.schema, 'lawcheck-error/1');
    assert.deepEqual(error.errors.map((e) => [e.code, e.file, e.message]), [['file-unwritable', missing, 'cannot be written (ENOENT)']]);
    assert.equal(error.next.text, `make ${missing} writable, then run lawcheck check again`);
    mkdirSync(join(dir, 'a-folder'));
    const folder = await lawcheck(repo, ['check', '--base', 'main', '--sarif', join(dir, 'a-folder')]);
    assert.equal(folder.code, 2);
    assert.match(folder.stdout, /error\[file-unwritable\]  cannot be written \((EISDIR|EPERM|EACCES)\)/);

    const named = await lawcheck(repo, ['check', 'src/core/total.ts', '--sarif', out]);
    assert.equal(named.code, 2);
    assert.match(named.stdout, /^error\[usage\] {2}paths go with --json alone$/m);
    const bare = await lawcheck(repo, ['check', '--sarif']);
    assert.equal(bare.code, 2);
    assert.match(bare.stdout, /^error\[usage\] {2}the flag --sarif takes a path$/m);
    const help = await lawcheck(repo, ['check', '--help']);
    assert.equal(help.stdout.split('\n')[0], 'usage: lawcheck check [--full] [--strict] [--base <ref>] [--review [--again] [--max-calls <n>]] [--sarif <file>] [--json]', 'the usage line names the flag');
    assert.match(help.stdout, /^ {2}--sarif <file> {5}also write the findings to this file as SARIF 2\.1\.0$/m);
    assert.equal(existsSync(out), false);
  });
});

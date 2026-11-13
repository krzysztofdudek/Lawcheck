import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFindings } from './prompt.js';
import type { AnswerFinding } from './prompt.js';

export const VERDICT_FORMAT = 'lawcheck-verdict/1';
export const VERDICTS = '.lawcheck/verdicts';
export const ATTRIBUTES = '.lawcheck/.gitattributes';
export const LOCAL = '.lawcheck/.local';
const UNION = 'verdicts merge=union';
const LINE = /^[0-9a-f]{32} [a-z0-9]+(-[a-z0-9]+)*$/;

export interface KeyInput {
  frame: string;
  ruleId: string;
  why: string;
  ruleText: string;
  context: { path: string; text: string }[];
  filePath: string;
  fileText: string;
}

const lf = (text: string) => text.replace(/\r\n/g, '\n');

export function reviewKey(input: KeyInput): string {
  const material = JSON.stringify([
    VERDICT_FORMAT,
    lf(input.frame),
    input.ruleId,
    lf(input.why),
    lf(input.ruleText),
    input.context.map((item) => [item.path, lf(item.text)]),
    input.filePath,
    lf(input.fileText),
  ]);
  return createHash('sha256').update(material, 'utf8').digest('hex').slice(0, 32);
}

export function verdictLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter((line) => LINE.test(line));
}

function readText(path: string): string | null {
  try {
    return readFileSync(path, 'utf8');
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === 'ENOENT' || code === 'ENOTDIR') return null;
    throw error;
  }
}

export function readVerdicts(root: string): Set<string> {
  return new Set(verdictLines(readText(join(root, VERDICTS)) ?? ''));
}

function ensureLocal(root: string): string {
  const local = join(root, LOCAL);
  mkdirSync(local, { recursive: true });
  const ignore = join(local, '.gitignore');
  if (!existsSync(ignore)) writeFileSync(ignore, '*\n');
  return local;
}

function failurePath(root: string, key: string): string {
  return join(root, LOCAL, 'failures', `${key}.json`);
}

export function readFailure(root: string, key: string, rule: string, lineCount: number): AnswerFinding[] | null {
  let text: string | null;
  try {
    text = readText(failurePath(root, key));
  } catch {
    return null;
  }
  if (text === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const record = value as { rule?: unknown; findings?: unknown };
  if (record.rule !== rule) return null;
  const findings = checkFindings(record.findings, lineCount);
  if (!Array.isArray(findings) || findings.length === 0) return null;
  return findings;
}

export class VerdictWriter {
  private queue: Promise<unknown> = Promise.resolve();
  added = 0;

  constructor(private readonly root: string) {}

  pass(key: string, rule: string): Promise<void> {
    return this.enqueue(() => {
      const local = ensureLocal(this.root);
      const path = join(this.root, VERDICTS);
      const lines = new Set(verdictLines(readText(path) ?? ''));
      const line = `${key} ${rule}`;
      if (!lines.has(line)) this.added++;
      lines.add(line);
      const sorted = [...lines].sort();
      const temporary = join(local, `verdicts-${process.pid}-${randomBytes(6).toString('hex')}`);
      writeFileSync(temporary, sorted.map((entry) => entry + '\n').join(''));
      renameSync(temporary, path);
      this.attributes();
      rmSync(failurePath(this.root, key), { force: true });
    });
  }

  failure(key: string, rule: string, findings: AnswerFinding[]): Promise<void> {
    return this.enqueue(() => {
      const local = ensureLocal(this.root);
      mkdirSync(join(local, 'failures'), { recursive: true });
      writeFileSync(failurePath(this.root, key), JSON.stringify({ rule, findings }) + '\n');
    });
  }

  done(): Promise<unknown> {
    return this.queue;
  }

  private attributes(): void {
    const path = join(this.root, ATTRIBUTES);
    const text = readText(path);
    if (text !== null && text.split('\n').some((line) => line.replace(/\r$/, '') === UNION)) return;
    const prefix = text === null || text === '' || text.endsWith('\n') ? (text ?? '') : text + '\n';
    writeFileSync(path, prefix + UNION + '\n');
  }

  private enqueue(work: () => void): Promise<void> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => undefined);
    return next;
  }
}

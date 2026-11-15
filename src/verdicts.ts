import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkFindings } from './prompt.js';
import { hide } from './keys.js';
import type { AnswerFinding } from './prompt.js';

export const VERDICT_FORMAT = 'lawcheck-verdict/2';
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

export class VerdictsUnreadable extends Error {
  constructor(readonly cause: string) {
    super(`${VERDICTS} cannot be read (${cause})`);
  }
}

export function readVerdicts(root: string): Set<string> {
  try {
    return new Set(verdictLines(readText(join(root, VERDICTS)) ?? ''));
  } catch (error) {
    throw new VerdictsUnreadable((error as NodeJS.ErrnoException).code ?? 'an error');
  }
}

export class Unwritable extends Error {
  constructor(
    readonly path: string,
    readonly cause: string,
  ) {
    super(`${path} cannot be written (${cause})`);
  }
}

function writing<T>(path: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof Unwritable) throw error;
    throw new Unwritable(path, (error as NodeJS.ErrnoException).code ?? 'an error');
  }
}

function ensureLocal(root: string): string {
  const local = join(root, LOCAL);
  writing(LOCAL, () => mkdirSync(local, { recursive: true }));
  const ignore = join(local, '.gitignore');
  if (!existsSync(ignore)) writing(`${LOCAL}/.gitignore`, () => writeFileSync(ignore, '*\n'));
  return local;
}

function notDirectory(root: string, path: string): void {
  let directory = false;
  try {
    directory = statSync(join(root, path)).isDirectory();
  } catch {
    return;
  }
  if (directory) throw new Unwritable(path, 'EISDIR');
}

function ended(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return false;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH';
  }
}

const LOCK_WAIT_MS = 10_000;
const pause = new Int32Array(new SharedArrayBuffer(4));

function staleLock(lock: string): boolean {
  try {
    const owner = Number(readFileSync(join(lock, 'pid'), 'utf8'));
    if (Number.isInteger(owner) && owner > 0) return ended(owner);
  } catch {
    // The owner has made the folder and not yet written its pid, or has just removed it.
  }
  try {
    return Date.now() - statSync(lock).mtimeMs > LOCK_WAIT_MS;
  } catch {
    return false;
  }
}

// Two runs at once each read the verdicts file, add their lines and replace it, so the replacing is done under a lock that a killed run leaves stale.
function locked<T>(local: string, work: () => T): T {
  const lock = join(local, 'verdicts.lock');
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      mkdirSync(lock);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw new Unwritable(`${LOCAL}/verdicts.lock`, (error as NodeJS.ErrnoException).code ?? 'an error');
      if (staleLock(lock)) {
        rmSync(lock, { recursive: true, force: true });
        continue;
      }
      if (Date.now() > deadline) throw new Unwritable(`${LOCAL}/verdicts.lock`, 'EBUSY');
      Atomics.wait(pause, 0, 0, 5);
    }
  }
  try {
    writeFileSync(join(lock, 'pid'), String(process.pid));
    return work();
  } finally {
    rmSync(lock, { recursive: true, force: true });
  }
}

const LEFT = /^(?:verdicts|probe)-(\d+)-[0-9a-f]+$/;

function removeLeftovers(local: string): void {
  let names: string[];
  try {
    names = readdirSync(local);
  } catch {
    return;
  }
  for (const name of names) {
    const left = LEFT.exec(name);
    if (left !== null && ended(Number(left[1]))) rmSync(join(local, name), { force: true });
  }
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

  // Every place a review writes is tried before the first call, so a run that cannot record an answer pays for none.
  ready(): void {
    const local = ensureLocal(this.root);
    removeLeftovers(local);
    const probe = join(local, `probe-${process.pid}-${randomBytes(6).toString('hex')}`);
    writing(LOCAL, () => {
      writeFileSync(probe, '');
      rmSync(probe);
    });
    writing(`${LOCAL}/failures`, () => mkdirSync(join(local, 'failures'), { recursive: true }));
    notDirectory(this.root, VERDICTS);
    notDirectory(this.root, ATTRIBUTES);
  }

  pass(key: string, rule: string): Promise<void> {
    return this.enqueue(() => {
      const local = ensureLocal(this.root);
      const path = join(this.root, VERDICTS);
      locked(local, () => {
        const lines = new Set(verdictLines(writing(VERDICTS, () => readText(path)) ?? ''));
        const line = `${key} ${rule}`;
        if (!lines.has(line)) this.added++;
        lines.add(line);
        const sorted = [...lines].sort();
        const temporary = join(local, `verdicts-${process.pid}-${randomBytes(6).toString('hex')}`);
        writing(LOCAL, () => writeFileSync(temporary, sorted.map((entry) => entry + '\n').join('')));
        writing(VERDICTS, () => renameSync(temporary, path));
        writing(ATTRIBUTES, () => this.attributes());
      });
      writing(`${LOCAL}/failures`, () => rmSync(failurePath(this.root, key), { force: true }));
    });
  }

  failure(key: string, rule: string, findings: AnswerFinding[]): Promise<void> {
    return this.enqueue(() => {
      const local = ensureLocal(this.root);
      writing(`${LOCAL}/failures`, () => {
        mkdirSync(join(local, 'failures'), { recursive: true });
        writeFileSync(failurePath(this.root, key), JSON.stringify({ rule, findings: findings.map((finding) => ({ ...finding, message: hide(finding.message) })) }) + '\n');
      });
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

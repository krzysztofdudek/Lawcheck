import { createHash, createPrivateKey, createPublicKey, randomBytes, sign, verify } from 'node:crypto';
import type { KeyObject } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readdirSync, readSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILE_TEXT_BYTES, mib, readFailure as failureOfRead, readWhole } from './limits.js';
import { checkFindings } from './prompt.js';
import { splitLines } from './types.js';
import { parseWaivers, waivedLines } from './waivers.js';
import { hide } from './keys.js';
import { KEY_TEXT } from './law.js';
import type { AnswerFinding } from './prompt.js';

export const VERDICT_FORMAT = 'lawcheck-verdict/2';
export const VERDICTS = '.lawcheck/verdicts';
export const ATTRIBUTES = '.lawcheck/.gitattributes';
export const LOCAL = '.lawcheck/.local';
const UNION = 'verdicts merge=union';
// A signature is 64 bytes in base64url without padding: the last of its 86 characters carries 2 bits and four zero bits, so one spelling per signature.
const LINE = /^([0-9a-f]{32} [a-z0-9]+(?:-[a-z0-9]+)*)(?: ([a-z0-9]+(?:-[a-z0-9]+)*) ([A-Za-z0-9_-]{85}[AQgw]))?$/;
export const SIGNED_PASS = 'lawcheck-signed-pass/1';
const SIGNATURE_CHARS = 86;
// The DER of a PKCS #8 and of an SPKI Ed25519 key before its 32 bytes (RFC 8410), so a key of 32 bytes needs no other format.
const PKCS8_ED25519 = Buffer.from('302e020100300506032b657004220420', 'hex');
const SPKI_ED25519 = Buffer.from('302a300506032b6570032100', 'hex');

export interface KeyInput {
  frame: string;
  ruleId: string;
  why: string;
  ruleText: string;
  context: { path: string; text: string }[];
  filePath: string;
  fileText: string;
  waived: number[];
  companion?: { path: string; text: string } | null;
}

const lf = (text: string) => text.replace(/\r\n/g, '\n');

function sameLines(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((line, index) => line === b[index]);
}

// A rule without a companion keeps the key it had before companions existed, so its recorded passes stay valid. The file's text fixes <waived> wherever the file's own waivers of the rule count, so there the key keeps its eight parts and every pass recorded before the ninth stays valid. A ninth part only when <waived> is not empty would give a type with waivers: false the key of the pass recorded while the waiver counted.
export function reviewKey(input: KeyInput): string {
  const parts: unknown[] = [
    VERDICT_FORMAT,
    lf(input.frame),
    input.ruleId,
    lf(input.why),
    lf(input.ruleText),
    input.context.map((item) => [item.path, lf(item.text)]),
    input.filePath,
    lf(input.fileText),
  ];
  if (input.companion != null) parts.push(['companion', input.companion.path, lf(input.companion.text)]);
  const own = waivedLines(parseWaivers(splitLines(input.fileText), new Set([input.ruleId])).waivers, input.ruleId);
  if (!sameLines(own, input.waived)) parts.push(input.waived);
  return createHash('sha256').update(JSON.stringify(parts), 'utf8').digest('hex').slice(0, 32);
}

export function verdictLines(text: string): string[] {
  return text.split('\n').map((line) => (line.endsWith('\r') ? line.slice(0, -1) : line)).filter((line) => LINE.test(line));
}

export interface Signer {
  name: string;
  key: KeyObject;
}

function signed(pair: string): Buffer {
  return Buffer.from(`${SIGNED_PASS} ${pair}`, 'utf8');
}

export function signingKey(text: string): { key: KeyObject; publicKey: string } | null {
  if (!KEY_TEXT.test(text)) return null;
  const key = createPrivateKey({ key: Buffer.concat([PKCS8_ED25519, Buffer.from(text, 'base64url')]), format: 'der', type: 'pkcs8' });
  return { key, publicKey: createPublicKey(key).export({ format: 'jwk' }).x! };
}

export class Passes {
  private readonly counted = new Map<string, boolean>();
  private readonly keys = new Map<string, KeyObject | null>();

  constructor(
    private readonly held: Map<string, [string, string][]>,
    private readonly signers: ReadonlyMap<string, string> | null,
  ) {}

  has(pair: string): boolean {
    const signatures = this.held.get(pair);
    if (signatures === undefined) return false;
    if (this.signers === null) return true;
    let known = this.counted.get(pair);
    if (known === undefined) {
      known = signatures.some(([name, signature]) => this.verifies(pair, name, signature));
      this.counted.set(pair, known);
    }
    return known;
  }

  uncounted(pair: string): boolean {
    return this.held.has(pair) && !this.has(pair);
  }

  private verifies(pair: string, name: string, signature: string): boolean {
    const key = this.keyOf(name);
    if (key === null) return false;
    try {
      return verify(null, signed(pair), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  private keyOf(name: string): KeyObject | null {
    if (!this.keys.has(name)) {
      const x = this.signers!.get(name);
      let key: KeyObject | null = null;
      if (x !== undefined) {
        try {
          key = createPublicKey({ key: Buffer.concat([SPKI_ED25519, Buffer.from(x, 'base64url')]), format: 'der', type: 'spki' });
        } catch {
          key = null;
        }
      }
      this.keys.set(name, key);
    }
    return this.keys.get(name)!;
  }
}

function readText(path: string): string | null {
  try {
    return new TextDecoder('utf-8', { ignoreBOM: true }).decode(readWhole(path, path));
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
    throw new VerdictsUnreadable(failureOfRead(error));
  }
}

export function readPasses(root: string, signers: ReadonlyMap<string, string> | null): Passes {
  const held = new Map<string, [string, string][]>();
  for (const line of readVerdicts(root)) {
    const [, pair, name, signature] = LINE.exec(line)!;
    const signatures = held.get(pair!) ?? [];
    if (name !== undefined) signatures.push([name, signature!]);
    held.set(pair!, signatures);
  }
  return new Passes(held, signers);
}

export class Unwritable extends Error {
  constructor(
    readonly path: string,
    readonly cause: string,
    readonly next: string | null = null,
  ) {
    super(`${path} cannot be written (${cause})`);
  }
}

// A pass is a hash of what it judged, so no step removes only the passes this tree does not need, and passes another branch needs come back through the union merge.
export const FULL_NEXT = `ask the user how to make room in ${VERDICTS}: its passes are hashes, so none can be told apart by hand`;

export class VerdictsFull extends Unwritable {}

// The passes the file holds, and how many of them the reviews of this tree need, read in pieces whatever the file's size.
export function countPasses(root: string, needed: Set<string>): { held: number; needed: number } {
  let held = 0;
  let used = 0;
  let fd: number;
  try {
    fd = openSync(join(root, VERDICTS), 'r');
  } catch {
    return { held: 0, needed: 0 };
  }
  const chunk = Buffer.allocUnsafe(1 << 20);
  let rest = '';
  const take = (line: string) => {
    const read = LINE.exec(line.endsWith('\r') ? line.slice(0, -1) : line);
    if (read === null) return;
    held++;
    if (needed.has(read[1]!)) used++;
  };
  try {
    for (;;) {
      const n = readSync(fd, chunk, 0, chunk.length, null);
      if (n === 0) break;
      const lines = (rest + chunk.toString('utf8', 0, n)).split('\n');
      rest = lines.pop()!;
      for (const line of lines) take(line);
    }
    if (rest !== '') take(rest);
  } finally {
    closeSync(fd);
  }
  return { held, needed: used };
}

function tooFull(): Unwritable {
  return new VerdictsFull(VERDICTS, `with the passes of this run it would hold more than ${mib(FILE_TEXT_BYTES)}, the most a run reads of it`, FULL_NEXT);
}

function writing<T>(path: string, work: () => T): T {
  try {
    return work();
  } catch (error) {
    if (error instanceof Unwritable) throw error;
    throw new Unwritable(path, failureOfRead(error));
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

// A run holds the lock for one write, so a lock older than the wait is stale even when its pid now names another live process.
function staleLock(lock: string): boolean {
  try {
    if (Date.now() - statSync(lock).mtimeMs > LOCK_WAIT_MS) return true;
  } catch {
    return false;
  }
  try {
    const owner = Number(readText(join(lock, 'pid')));
    if (Number.isInteger(owner) && owner > 0) return ended(owner);
  } catch {
    // The owner has made the folder and not yet written its pid, or has just removed it.
  }
  return false;
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
    writing(`${LOCAL}/verdicts.lock`, () => writeFileSync(join(lock, 'pid'), String(process.pid)));
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

  constructor(
    private readonly root: string,
    private readonly signer: Signer | null = null,
  ) {}

  // Every place a review writes is tried before the first call, so a run that cannot record an answer pays for none.
  // A verdicts file past the limit of a text file could be written but never read again, so the passes this run may add are counted before its first call.
  ready(rules: string[] = []): void {
    let size = 0;
    try {
      size = statSync(join(this.root, VERDICTS)).size;
    } catch {
      size = 0;
    }
    const signature = this.signer === null ? 0 : 1 + this.signer.name.length + 1 + SIGNATURE_CHARS;
    for (const rule of rules) size += 32 + 1 + rule.length + signature + 1;
    if (size > FILE_TEXT_BYTES) throw tooFull();
    const local = ensureLocal(this.root);
    removeLeftovers(local);
    const probe = join(local, `probe-${process.pid}-${randomBytes(6).toString('hex')}`);
    writing(LOCAL, () => {
      writeFileSync(probe, '');
      rmSync(probe);
    });
    writing(`${LOCAL}/failures`, () => mkdirSync(join(local, 'failures'), { recursive: true }));
    locked(local, () => undefined);
    notDirectory(this.root, VERDICTS);
    notDirectory(this.root, ATTRIBUTES);
  }

  pass(key: string, rule: string): Promise<void> {
    return this.enqueue(() => {
      const local = ensureLocal(this.root);
      const path = join(this.root, VERDICTS);
      locked(local, () => {
        const lines = new Set(verdictLines(writing(VERDICTS, () => readText(path)) ?? ''));
        const pair = `${key} ${rule}`;
        const line = this.signer === null ? pair : `${pair} ${this.signer.name} ${sign(null, signed(pair), this.signer.key).toString('base64url')}`;
        if (!lines.has(line)) this.added++;
        lines.add(line);
        const sorted = [...lines].sort();
        let bytes = 0;
        for (const entry of sorted) bytes += Buffer.byteLength(entry) + 1;
        if (bytes > FILE_TEXT_BYTES) throw tooFull();
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

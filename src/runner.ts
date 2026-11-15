import { pathToFileURL } from 'node:url';
import { MESSAGE_CHARS, RUN_FINDINGS, RUN_MESSAGE_CHARS } from './limits.js';

interface CallFile {
  path: string;
  type: string;
  text: string;
  lines: string[];
}

type Incoming =
  | { kind: 'load'; file: string; filesOf: Map<string, string[]> }
  | { kind: 'call'; file: CallFile }
  | { kind: 'finish' };

type Check = (input: { files: CallFile[]; repo: { filesOf(typeId: string): string[] } }) => unknown;

// Started without a channel, the runner only shows that Node can start it: the tool does this to learn why a runner did not start.
if (process.send === undefined) process.exit(0);
const channel = process.send.bind(process);
process.send = undefined;

// macOS adds __CF_USER_TEXT_ENCODING to every process it starts, even one started with an empty environment.
for (const name of Object.keys(process.env)) delete process.env[name];

let check: Check | null = null;
let repo: { filesOf(typeId: string): string[] } | null = null;
let loaded = false;
let reported = false;

// A rejection nobody handles, or a throw from a timer, would end the runner at a moment that depends on how many files it judges; it is reported the moment it comes, as a failure of the rule and of no file, so the result is the same alone or with other files.
function failed(error: unknown): void {
  if (reported) return;
  reported = true;
  send({ kind: 'background', message: text(error), load: !loaded });
}
process.on('unhandledRejection', failed);
process.on('uncaughtException', failed);

// How long the runner waits once, after the last call, for the timers and other work the rule left behind; spec/check-slice.md, section 3.
const SETTLE_MS = 2_000;

function counts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) out.set(kind, (out.get(kind) ?? 0) + 1);
  return out;
}

// The runner's own channel is open only once the first message arrives, so what it holds itself is counted then.
let own: Map<string, number> | null = null;

function leftBehind(): boolean {
  for (const [kind, count] of counts()) if (count > (own?.get(kind) ?? 0)) return true;
  return false;
}

function turn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function finish(): Promise<void> {
  const until = Date.now() + SETTLE_MS;
  await turn();
  while (!reported && Date.now() < until && leftBehind()) await new Promise((resolve) => setTimeout(resolve, 5));
  if (!reported) send({ kind: 'finished' });
}

// Node's refusal names a flag of the runner's own command line, which the user cannot pass; the permission and the path it carries say what the rule did.
function refused(error: unknown): string | null {
  const { code, permission, resource } = (error ?? {}) as { code?: unknown; permission?: unknown; resource?: unknown };
  if (code !== 'ERR_ACCESS_DENIED') return null;
  const path = typeof resource === 'string' && resource !== '' ? resource : null;
  switch (permission) {
    case 'FileSystemRead':
      return `reads ${path ?? 'a path'} outside the root and Lawcheck's folder, and a rule may read nothing else`;
    case 'FileSystemWrite':
      return `writes ${path ?? 'a file'}, and a rule may write no file`;
    case 'ChildProcess':
      return 'starts a program, and a rule may start none';
    case 'WorkerThreads':
      return 'starts a worker thread, and a rule may start none';
    case 'Addon':
      return 'loads a native add-on, and a rule may load none';
    case 'WASI':
      return 'starts WASI, and a rule may not';
    default:
      return `does what the runner does not allow (${String(permission)})`;
  }
}

function text(error: unknown): string {
  const named = refused(error);
  if (named !== null) return named;
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/)[0] ?? '';
}

function send(message: unknown): void {
  try {
    channel(message);
  } catch (error) {
    channel({ kind: 'uncloneable', message: text(error) });
  }
}

async function load(file: string, filesOf: Map<string, string[]>): Promise<void> {
  repo = {
    filesOf(typeId: string): string[] {
      const list = filesOf.get(typeId);
      if (list === undefined) throw new Error(`unknown type '${typeId}'`);
      return [...list];
    },
  };
  let module: { check?: unknown };
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    send({ kind: 'load-failed', message: text(error) });
    return;
  }
  await turn();
  loaded = true;
  if (reported) return;
  if (typeof module.check !== 'function') {
    send({ kind: 'load-failed', message: 'the module exports no function check' });
    return;
  }
  check = module.check as Check;
  send({ kind: 'loaded' });
}

// A list or a message past its limit is answered by its size alone, so it never crosses the channel whole.
function oversized(value: unknown): { kind: string; count: number; chars?: number } | null {
  if (!Array.isArray(value)) return null;
  let chars = 0;
  for (const item of value as unknown[]) {
    const message = typeof item === 'object' && item !== null ? (item as { message?: unknown }).message : undefined;
    if (typeof message !== 'string') continue;
    if (message.length > MESSAGE_CHARS) return { kind: 'too-long', count: message.length };
    chars += message.length;
  }
  if (value.length > RUN_FINDINGS || chars > RUN_MESSAGE_CHARS) return { kind: 'too-many', count: value.length, chars };
  return null;
}

async function call(file: CallFile): Promise<void> {
  let value: unknown;
  let over: ReturnType<typeof oversized>;
  try {
    value = await check!({ files: [file], repo: repo! });
    over = oversized(value);
  } catch (error) {
    send({ kind: 'threw', message: text(error) });
    return;
  }
  await turn();
  if (reported) return;
  send(over ?? { kind: 'result', value });
}

process.on('message', (message: Incoming) => {
  own ??= counts();
  if (message.kind === 'load') void load(message.file, message.filesOf);
  else if (message.kind === 'finish') void finish();
  else void call(message.file);
});

channel({ kind: 'ready' });

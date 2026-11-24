import { createHook } from 'node:async_hooks';
import { registerHooks, syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';

interface CallFile {
  path: string;
  type: string;
  text: string;
  lines: string[];
}

interface FlatTree {
  types: string[];
  fields: string[];
  nodes: Int32Array;
}

interface TreeAnswer {
  language: string | null;
  tree: FlatTree | null;
  absent: string | null;
}

interface TreeNode {
  type: string;
  named: boolean;
  field: string | null;
  start: number;
  end: number;
  line: number;
  column: number;
  children: TreeNode[];
}

interface Limits {
  messageChars: number;
  findings: number;
  chars: number;
}

type Incoming =
  | { kind: 'load'; file: string; filesOf: Map<string, string[]>; entry?: Entry; limits: Limits }
  | { kind: 'call'; file: CallFile }
  | { kind: 'answer'; id: number; value: unknown }
  | { kind: 'finish' };

type RuleFile = CallFile & { tree(): Promise<unknown>; uses(): Promise<unknown> };

type Repo = { filesOf(typeId: string): string[] };

type Entry = 'check' | 'companion';

type Check = (input: { files: RuleFile[]; repo: Repo }) => unknown;

type Companion = (input: { file: RuleFile; repo: Repo }) => unknown;

// Started without a channel, the runner only shows that Node can start it: the tool does this to learn why a runner did not start.
if (process.send === undefined) process.exit(0);
const channel = process.send.bind(process);
process.send = undefined;

// macOS adds __CF_USER_TEXT_ENCODING to every process it starts, even one started with an empty environment.
for (const name of Object.keys(process.env)) delete process.env[name];

// Node makes a pipe of standard output and standard error blocking on Windows only; elsewhere a print that does not fit in the pipe waits in the runner, so a rule that prints faster than the tool relays piles up gigabytes there, out of the memory guard's sight.
for (const stream of [process.stdout, process.stderr]) (stream as unknown as { _handle?: { setBlocking?(blocking: boolean): unknown } })._handle?.setBlocking?.(true);

// Node 24's permission model has no permission for the network; Node 25 and later refuse it themselves. Before the rule loads, the runner replaces with one refusal the functions of node:net, node:dgram and node:dns that reach the network, the globals and the export of node:http that open a connection, and the methods by which the classes of a TCP handle and of a pipe handle bind, listen and connect. A rule reaches those classes through the handle of a socket, as a TLS socket with no socket of its own makes one, and a pipe handle opens no network on its own, so its open stays for the runner's standard streams.
function closeNetwork(): void {
  function closed(): never {
    throw Object.assign(new Error('the network is closed to script rules'), { code: 'ERR_ACCESS_DENIED', permission: 'Net' });
  }
  const shut = (target: object, names: string[]) => {
    for (const name of names) if (name in target) Object.defineProperty(target, name, { value: closed });
  };
  const net = process.getBuiltinModule('node:net');
  const tls = new (process.getBuiltinModule('node:tls').TLSSocket)(null as never) as unknown as { _handle: { _parent: object }; destroy(): void };
  shut(Object.getPrototypeOf(tls._handle._parent), ['open', 'bind', 'bind6', 'listen', 'connect', 'connect6']);
  tls.destroy();
  shut(Object.getPrototypeOf((process.stdout as unknown as { _handle: object })._handle), ['bind', 'listen', 'connect']);
  shut(net, ['connect', 'createConnection', '_createServerHandle', 'BoundSocket', '_TransferredBoundSocket']);
  shut(net.Socket.prototype, ['connect']);
  shut(net.Server.prototype, ['listen', '_listen2']);
  for (const id of ['node:dgram', 'node:dns', 'node:dns/promises']) {
    const module = process.getBuiltinModule(id) as Record<string, unknown>;
    shut(module, Object.keys(module).filter((name) => typeof module[name] === 'function'));
  }
  shut(process.getBuiltinModule('node:http'), ['WebSocket']);
  shut(globalThis, ['fetch', 'WebSocket', 'EventSource']);
  syncBuiltinESMExports();
}
closeNetwork();

// process.getActiveResourcesInfo() leaves out a timer or an immediate that does not hold the process, so the wait after the last call would not see one the rule left unreferenced, and its throw would come after the rule's result. The channel holds the runner whatever its timers do, so the runner keeps every timer referenced.
function keepTimersReferenced(): void {
  const timeout = setTimeout(() => undefined, 0);
  const immediate = setImmediate(() => undefined);
  for (const made of [timeout, immediate]) {
    Object.defineProperty(Object.getPrototypeOf(made), 'unref', { value: function unref(this: unknown) { return this; }, writable: true, configurable: true });
  }
  clearTimeout(timeout);
  clearImmediate(immediate);
  const promises = process.getBuiltinModule('node:timers/promises') as unknown as Record<string, (...args: unknown[]) => unknown> & { scheduler: { wait: (...args: unknown[]) => unknown } };
  const referenced = (options: unknown) => (typeof options === 'object' && options !== null ? { ...options, ref: true } : options);
  const wrap = (owner: Record<string, unknown>, name: string, at: number) => {
    const original = owner[name] as (...args: unknown[]) => unknown;
    Object.defineProperty(owner, name, {
      value: function (this: unknown, ...args: unknown[]) {
        if (args.length > at) args[at] = referenced(args[at]);
        return original.apply(this, args);
      },
      writable: true,
      configurable: true,
    });
  };
  wrap(promises, 'setTimeout', 2);
  wrap(promises, 'setImmediate', 1);
  wrap(promises, 'setInterval', 2);
  wrap(promises.scheduler, 'wait', 1);
  syncBuiltinESMExports();
}
keepTimersReferenced();

// process.getActiveResourcesInfo() does not list a pending Atomics.waitAsync either, so the runner counts the waits a rule leaves pending.
let waits = 0;
function countAsyncWaits(): void {
  const original = Atomics.waitAsync;
  Object.defineProperty(Atomics, 'waitAsync', {
    value: function waitAsync(...args: Parameters<typeof Atomics.waitAsync>) {
      const result = original(...args);
      if (result.async) {
        waits++;
        void result.value.then(() => {
          waits--;
        });
      }
      return result;
    },
    writable: true,
    configurable: true,
  });
}
countAsyncWaits();

// Node's error for a module it cannot find names the file it looked for, not the import that led there, so the runner keeps the import and the module that wrote it.
const missing = new WeakMap<object, { specifier: string; parent: string | null }>();
registerHooks({
  resolve(specifier, context, next) {
    try {
      return next(specifier, context);
    } catch (error) {
      if (typeof error === 'object' && error !== null && (error as { code?: unknown }).code === 'ERR_MODULE_NOT_FOUND' && !missing.has(error)) missing.set(error, { specifier, parent: context.parentURL ?? null });
      throw error;
    }
  },
});

function missingOf(error: unknown): { specifier: string; url: string | null; parent: string | null } | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const kept = missing.get(error);
  if (kept === undefined) return undefined;
  const url = (error as { url?: unknown }).url;
  return { ...kept, url: typeof url === 'string' ? url : null };
}

let check: Check | null = null;
let companion: Companion | null = null;
let repo: Repo | null = null;
let limits: Limits | null = null;
let loaded = false;
let reported = false;

// A rejection nobody handles, or a throw from a timer, would end the runner at a moment that depends on how many files it judges; it is reported the moment it comes, as a failure of the rule and of no file, so the result is the same alone or with other files.
function failed(error: unknown): void {
  if (reported) return;
  const message = text(error);
  reported = true;
  send({ kind: 'background', message, load: !loaded });
}
process.on('unhandledRejection', failed);
process.on('uncaughtException', failed);

// How long the runner waits once, after the last call, for the timers and other work the rule left behind, as docs/script-rules.md says.
const SETTLE_MS = 2_000;

// process.getActiveResourcesInfo() does not list the jobs that node:crypto sends to the thread pool, such as pbkdf2, scrypt and randomBytes, so the runner counts the requests that have not run their callback. Promises are left out of the hook, which keeps it from slowing a rule.
const requests = new Set<number>();
createHook({
  trackPromises: false,
  init: (id, type) => {
    if (/request$/i.test(type)) requests.add(id);
  },
  before: (id) => {
    requests.delete(id);
  },
  destroy: (id) => {
    requests.delete(id);
  },
}).enable();

function counts(): Map<string, number> {
  const out = new Map<string, number>();
  for (const kind of process.getActiveResourcesInfo()) out.set(kind, (out.get(kind) ?? 0) + 1);
  if (requests.size > 0) out.set('pooled', requests.size);
  return out;
}

// The runner's own channel is open only once the first message arrives, so what it holds itself is counted then. Its start can still have a timer or an immediate pending at that moment, which ends soon after; counted as the runner's, it would hide the same kind left by the rule, so only handles are counted.
let own: Map<string, number> | null = null;

function handles(): Map<string, number> {
  const out = counts();
  out.delete('Timeout');
  out.delete('Immediate');
  return out;
}

function leftBehind(): boolean {
  if (waits > 0) return true;
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
  const { code, permission, resource, message } = (error ?? {}) as { code?: unknown; permission?: unknown; resource?: unknown; message?: unknown };
  if (code === 'ERR_UNKNOWN_BUILTIN_MODULE' && typeof message === 'string' && message.endsWith(' node:sqlite')) return 'imports node:sqlite, and a rule may not';
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
    case 'Net':
      return 'uses the network, which is closed to script rules';
    default:
      return `does what the runner does not allow (${String(permission)})`;
  }
}

const NO_STRING_FORM = 'a value with no string form';

// MESSAGE_CHARS of src/limits.ts, the limit of a finding's message, holds what a rule throws too, so a line of megabytes never crosses the channel.
const SHOWN_CHARS = 4096;

function firstLine(message: string): string {
  const end = message.indexOf('\n');
  return end < 0 ? message : message.slice(0, end).replace(/\r$/, '');
}

function shown(line: string): string {
  const length = points(line);
  if (length <= SHOWN_CHARS) return line;
  let end = 0;
  for (let taken = 0; taken < SHOWN_CHARS; taken++) {
    const high = line.charCodeAt(end);
    const low = line.charCodeAt(end + 1);
    end += high >= 0xd800 && high <= 0xdbff && low >= 0xdc00 && low <= 0xdfff ? 2 : 1;
  }
  return `${line.slice(0, end)}… (cut: ${(length - SHOWN_CHARS).toLocaleString('en-US')} more characters)`;
}

// A value can have no string form (an object without a prototype, an array holding a symbol), so its text is the reason JavaScript gives for that.
function text(error: unknown): string {
  try {
    const named = refused(error);
    if (named !== null) return named;
    const message = error instanceof Error ? String(error.message) : String(error);
    return shown(firstLine(message));
  } catch (reason) {
    try {
      if (reason instanceof Error) return shown(firstLine(String(reason.message)));
    } catch {
      return NO_STRING_FORM;
    }
    return NO_STRING_FORM;
  }
}

function send(message: unknown): void {
  try {
    channel(message);
  } catch (error) {
    channel({ kind: 'uncloneable', message: text(error) });
  }
}

async function load(file: string, filesOf: Map<string, string[]>, entry: Entry, given: Limits): Promise<void> {
  limits = given;
  repo = {
    filesOf(typeId: string): string[] {
      const list = filesOf.get(typeId);
      if (list === undefined) throw new Error(`unknown type '${typeId}'`);
      return [...list];
    },
  };
  let module: { check?: unknown; companion?: unknown };
  try {
    module = await import(pathToFileURL(file).href);
  } catch (error) {
    const lost = missingOf(error);
    send({ kind: 'load-failed', message: text(error), ...(lost === undefined ? {} : { missing: lost }) });
    return;
  }
  await turn();
  loaded = true;
  if (reported) return;
  if (typeof module[entry] !== 'function') {
    send({ kind: 'load-failed', message: `the module exports no function ${entry}` });
    return;
  }
  if (entry === 'check') check = module.check as Check;
  else companion = module.companion as Companion;
  send({ kind: 'loaded' });
}

// The count of points in src/limits.ts, since a message's limit counts code points and the runner imports nothing of Lawcheck.
function points(text: string): number {
  let count = text.length;
  for (let i = 1; i < text.length; i++) {
    const low = text.charCodeAt(i);
    if (low >= 0xdc00 && low <= 0xdfff) {
      const high = text.charCodeAt(i - 1);
      if (high >= 0xd800 && high <= 0xdbff) count--;
    }
  }
  return count;
}

// A list or a message past its limit is answered by its size alone, so it never crosses the channel whole.
function oversized(value: unknown): { kind: string; count: number; chars?: number } | null {
  if (!Array.isArray(value)) return null;
  let chars = 0;
  for (const item of value as unknown[]) {
    const message = typeof item === 'object' && item !== null ? (item as { message?: unknown }).message : undefined;
    if (typeof message !== 'string') continue;
    const length = points(message);
    if (length > limits!.messageChars) return { kind: 'too-long', count: length };
    chars += length;
  }
  if (value.length > limits!.findings || chars > limits!.chars) return { kind: 'too-many', count: value.length, chars };
  return null;
}

// The layout NODE_INTS of src/readers.ts, eight numbers to a node in preorder: parent, type, field, named, start, end, line, column.
function treeOf(answer: TreeAnswer): { language: string | null; root: TreeNode | null; absent: string | null } {
  if (answer.tree === null) return { language: answer.language, root: null, absent: answer.absent };
  const { types, fields, nodes } = answer.tree;
  const made: TreeNode[] = [];
  for (let at = 0; at < nodes.length; at += 8) {
    const field = nodes[at + 2]!;
    const node: TreeNode = { type: types[nodes[at + 1]!]!, named: nodes[at + 3] === 1, field: field < 0 ? null : fields[field]!, start: nodes[at + 4]!, end: nodes[at + 5]!, line: nodes[at + 6]!, column: nodes[at + 7]!, children: [] };
    if (nodes[at]! >= 0) made[nodes[at]!]!.children.push(node);
    made.push(node);
  }
  return { language: answer.language, root: made[0]!, absent: null };
}

const answers = new Map<number, (value: unknown) => void>();
let asked = 0;

function asking(what: 'tree' | 'uses', call: { ended: boolean; asks: Promise<unknown>[] }, read: (value: unknown) => unknown): () => Promise<unknown> {
  let answer: Promise<unknown> | null = null;
  return () => {
    if (call.ended) return Promise.reject(new Error(`${what}() was called after its call of check ended`));
    if (answer === null) {
      const id = asked++;
      answer = new Promise((resolve) => answers.set(id, resolve)).then(read);
      call.asks.push(answer);
      send({ kind: 'ask', id, what });
    }
    return answer;
  };
}

// The tool reads the message, the file and the line of a finding and nothing else, so the other fields stay in the runner: a rule can pile any size into one, and only the message is held to a limit.
function read(value: unknown): unknown {
  if (!Array.isArray(value)) return value;
  return value.map((item: unknown) => {
    if (typeof item !== 'object' || item === null || Array.isArray(item)) return item;
    const { message, file, line } = item as { message?: unknown; file?: unknown; line?: unknown };
    return { message, file, line };
  });
}

async function call(file: CallFile): Promise<void> {
  let value: unknown;
  let over: ReturnType<typeof oversized>;
  const state = { ended: false, asks: [] as Promise<unknown>[] };
  const argument: RuleFile = { ...file, tree: asking('tree', state, (answer) => treeOf(answer as TreeAnswer)), uses: asking('uses', state, (answer) => answer) };
  try {
    value = companion === null ? await check!({ files: [argument], repo: repo! }) : await companion({ file: argument, repo: repo! });
    over = companion === null ? oversized(value) : null;
    if (companion === null && over === null) value = read(value);
    // An answer the rule did not wait for still comes before the result, so the tool never meets an ask of a call it has closed.
    for (let at = 0; at < state.asks.length; at++) await state.asks[at];
  } catch (error) {
    send({ kind: 'threw', message: text(error) });
    return;
  } finally {
    state.ended = true;
  }
  await turn();
  if (reported) return;
  send({ ...(over ?? { kind: 'result', value }), left: leftBehind() });
}

process.on('message', (message: Incoming) => {
  own ??= handles();
  if (message.kind === 'load') void load(message.file, message.filesOf, message.entry === 'companion' ? 'companion' : 'check', message.limits);
  else if (message.kind === 'finish') void finish();
  else if (message.kind === 'answer') {
    answers.get(message.id)?.(message.value);
    answers.delete(message.id);
  } else void call(message.file);
});

channel({ kind: 'ready' });

import { syncBuiltinESMExports } from 'node:module';
import { pathToFileURL } from 'node:url';
import { MESSAGE_CHARS, points, RUN_FINDINGS, RUN_MESSAGE_CHARS } from './limits.js';

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

type Incoming =
  | { kind: 'load'; file: string; filesOf: Map<string, string[]> }
  | { kind: 'call'; file: CallFile }
  | { kind: 'answer'; id: number; value: unknown }
  | { kind: 'finish' };

type RuleFile = CallFile & { tree(): Promise<unknown>; uses(): Promise<unknown> };

type Check = (input: { files: RuleFile[]; repo: { filesOf(typeId: string): string[] } }) => unknown;

// Started without a channel, the runner only shows that Node can start it: the tool does this to learn why a runner did not start.
if (process.send === undefined) process.exit(0);
const channel = process.send.bind(process);
process.send = undefined;

// macOS adds __CF_USER_TEXT_ENCODING to every process it starts, even one started with an empty environment.
for (const name of Object.keys(process.env)) delete process.env[name];

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

let check: Check | null = null;
let repo: { filesOf(typeId: string): string[] } | null = null;
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

// A value can have no string form (an object without a prototype, an array holding a symbol), so its text is the reason JavaScript gives for that.
function text(error: unknown): string {
  try {
    const named = refused(error);
    if (named !== null) return named;
    const message = error instanceof Error ? String(error.message) : String(error);
    return message.split(/\r?\n/)[0] ?? '';
  } catch (reason) {
    try {
      if (reason instanceof Error) return String(reason.message).split(/\r?\n/)[0] ?? '';
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
    const length = points(message);
    if (length > MESSAGE_CHARS) return { kind: 'too-long', count: length };
    chars += length;
  }
  if (value.length > RUN_FINDINGS || chars > RUN_MESSAGE_CHARS) return { kind: 'too-many', count: value.length, chars };
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

async function call(file: CallFile): Promise<void> {
  let value: unknown;
  let over: ReturnType<typeof oversized>;
  const state = { ended: false, asks: [] as Promise<unknown>[] };
  const argument: RuleFile = { ...file, tree: asking('tree', state, (answer) => treeOf(answer as TreeAnswer)), uses: asking('uses', state, (answer) => answer) };
  try {
    value = await check!({ files: [argument], repo: repo! });
    over = oversized(value);
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
  send(over ?? { kind: 'result', value });
}

process.on('message', (message: Incoming) => {
  own ??= counts();
  if (message.kind === 'load') void load(message.file, message.filesOf);
  else if (message.kind === 'finish') void finish();
  else if (message.kind === 'answer') {
    answers.get(message.id)?.(message.value);
    answers.delete(message.id);
  } else void call(message.file);
});

channel({ kind: 'ready' });

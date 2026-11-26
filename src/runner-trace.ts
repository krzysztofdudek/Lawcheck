// The record of what a rule of a runner leaves for the next rule of that runner, and the ending of module URLs that gives each rule its own copies of its modules. The runner imports this file and nothing else of Lawcheck.

// A rule can replace a property's value or only its getter or setter, and a later rule of the runner meets either, so a shape keeps all three.
type Shape = Map<object, Map<string | symbol, unknown[]>>;
const builtin = process.getBuiltinModule.bind(process);

function props(target: object): Map<string | symbol, unknown[]> {
  const out = new Map<string | symbol, unknown[]>();
  for (const key of Reflect.ownKeys(target)) {
    const found = Reflect.getOwnPropertyDescriptor(target, key);
    if (found !== undefined) out.set(key, [found.value, found.get, found.set]);
  }
  return out;
}

function shapeOf(root: object, below: boolean): Shape {
  const shape: Shape = new Map([[root, props(root)]]);
  if (!below) return shape;
  for (const [value] of shape.get(root)!.values()) {
    if ((typeof value !== 'object' && typeof value !== 'function') || value === null || shape.has(value)) continue;
    // Below the root only functions and plain objects are read: an instance of a class, such as the runner's channel or a stream, changes as the runner itself works.
    if (typeof value === 'object' && ![Object.prototype, null].includes(Reflect.getPrototypeOf(value) as never)) continue;
    shape.set(value, props(value));
    let prototype: unknown;
    try {
      prototype = typeof value === 'function' ? Reflect.getOwnPropertyDescriptor(value, 'prototype')?.value : undefined;
    } catch {
      prototype = undefined;
    }
    if (typeof prototype === 'object' && prototype !== null && !shape.has(prototype)) shape.set(prototype, props(prototype));
  }
  return shape;
}

function sameShape(shape: Shape): boolean {
  for (const [target, before] of shape) {
    const now = props(target);
    if (now.size !== before.size) return false;
    for (const [key, was] of before) {
      const is = now.get(key);
      if (is === undefined || !Object.is(is[0], was[0]) || is[1] !== was[1] || is[2] !== was[2]) return false;
    }
  }
  return true;
}

// A runner can take several rules, one after another, and each rule gets its own copies of the modules it imports: the URL of a rule's module ends with ?rule=<id>, and so does every file it imports, so a helper two rules import keeps its state apart for each. A CommonJS module has one copy for each file whatever its URL, which the runner sees in the count of loaded ones (stateOf).
const TAG = /[?&]rule=[^&#]*$/;
// The ending goes after a query the import already has and before its fragment, so an import such as ./helper.mjs?v=2 has a copy for each rule too. An ending the import already carries gives way to the importer's, so a rule that imports another rule's module by that rule's ending gets a copy of its own and not the other rule's live module.
export function tagged(url: string, parent: string | undefined): string {
  if (!url.startsWith('file:') || parent === undefined) return url;
  const tag = TAG.exec(parent.split('#')[0]!);
  if (tag === null) return url;
  const hash = url.indexOf('#');
  const [address, fragment] = hash < 0 ? [url, ''] : [url.slice(0, hash), url.slice(hash)];
  const bare = address.replace(TAG, '');
  return `${bare}${bare.includes('?') ? '&' : '?'}${tag[0].slice(1)}${fragment}`;
}

export function untagged(url: string | null): string | null {
  if (url === null) return null;
  const hash = url.indexOf('#');
  return hash < 0 ? url.replace(TAG, '') : url.slice(0, hash).replace(TAG, '') + url.slice(hash);
}

// The built-in modules a rule reached: a rule can change what one exports, and the next rule of the same runner would import the change.
const reached = new Map<string, Shape>();
export function reach(id: string): void {
  const name = id.startsWith('node:') ? id : `node:${id}`;
  if (reached.has(name)) return;
  const module = builtin(name);
  if (module !== undefined) reached.set(name, shapeOf(module as object, true));
}

// Installed once the runner has closed the network and patched its timers, so the shapes it records are of the modules as every rule finds them.
export function watchBuiltins(): void {
  Object.defineProperty(process, 'getBuiltinModule', {
    value: function getBuiltinModule(id: string) {
      if (typeof id === 'string') reach(id);
      return builtin(id);
    },
    writable: true,
    configurable: true,
    enumerable: true,
  });
}

// A runner takes the next rule only when this one left nothing a later rule could meet: no work still running, no change to a global, to a built-in module it reached, to console, to process or to the functions of its two output streams and the prototypes they inherit from, no callback that takes uncaught exceptions, no other working directory, no listener on process, no CommonJS module loaded, and nothing printed, since a line it left unfinished would join the next rule's.
interface Trace {
  shapes: Shape[];
  streams: Map<string | symbol, unknown>[];
  cwd: string;
  env: number;
  listeners: string;
  modules: number;
  printed: number;
}
let before: Trace | null = null;

// Taken once, when the first rule loads: by then the runner has closed the network, patched its timers and opened its channel, so what it changed itself is not counted against a rule.
export function record(): void {
  before ??= trace();
}

// A stream changes its own numbers and flags as it works, so of a stream only its own properties by name and its own functions are compared: a rule that replaces write on standard output or standard error sets one.
function methodsOf(stream: object): Map<string | symbol, unknown> {
  const out = new Map<string | symbol, unknown>();
  for (const key of Reflect.ownKeys(stream)) {
    const value = Reflect.getOwnPropertyDescriptor(stream, key)?.value;
    out.set(key, typeof value === 'function' ? value : null);
  }
  return out;
}

function sameMethods(was: Map<string | symbol, unknown>, now: Map<string | symbol, unknown>): boolean {
  if (was.size !== now.size) return false;
  for (const [key, value] of was) if (!now.has(key) || now.get(key) !== value) return false;
  return true;
}

function listeners(): string {
  return process.eventNames().map((name) => `${String(name)} ${process.listenerCount(name)}`).join(',');
}

function modules(): number {
  return Object.keys((builtin('node:module') as unknown as { _cache: object })._cache).length;
}

function printed(): number {
  return process.stdout.bytesWritten + process.stderr.bytesWritten;
}

// The prototypes a stream inherits from hold no state of the stream, so they are compared whole: a rule that replaces write there reaches every stream of that class.
function inherited(stream: object): Shape {
  const shape: Shape = new Map();
  for (let at = Reflect.getPrototypeOf(stream); at !== null && at !== Object.prototype; at = Reflect.getPrototypeOf(at)) shape.set(at, props(at));
  return shape;
}

function trace(): Trace {
  return { shapes: [shapeOf(globalThis, true), shapeOf(process, true), shapeOf(console, false), inherited(process.stdout), inherited(process.stderr)], streams: [methodsOf(process.stdout), methodsOf(process.stderr)], cwd: process.cwd(), env: Object.keys(process.env).length, listeners: listeners(), modules: modules(), printed: printed() };
}

export function clean(): boolean {
  try {
    if (before === null || process.cwd() !== before.cwd || Object.keys(process.env).length !== before.env || listeners() !== before.listeners || modules() !== before.modules || printed() !== before.printed) return false;
    if (process.hasUncaughtExceptionCaptureCallback()) return false;
    for (const shape of [...before.shapes, ...reached.values()]) if (!sameShape(shape)) return false;
    for (const [at, stream] of [process.stdout, process.stderr].entries()) if (!sameMethods(before.streams[at]!, methodsOf(stream))) return false;
    return true;
  } catch {
    return false;
  }
}

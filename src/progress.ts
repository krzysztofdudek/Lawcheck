// Room for the longest path Windows allows, 32,767 UTF-16 units, each of which takes at most three bytes of UTF-8.
const TEXT_UNITS = 33_000;
const TEXT_BYTES = TEXT_UNITS * 3;
const WHAT = 16;
const FILE = WHAT + TEXT_BYTES;
const POOL = FILE + TEXT_BYTES;
const SIZE = POOL + 8;

let beat: Float64Array | null = null;
let pool: Int32Array | null = null;
let buffer: SharedArrayBuffer | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// A longer text keeps its start and its end, where a step names the rule it reads for.
function fit(text: string): string {
  if (text.length <= TEXT_UNITS) return text;
  const half = (TEXT_UNITS - 1) / 2;
  return `${text.slice(0, Math.floor(half))}…${text.slice(text.length - Math.ceil(half))}`;
}

function write(into: SharedArrayBuffer, what: string, file: string): void {
  const sizes = new Int32Array(into, 8, 2);
  sizes[0] = encoder.encodeInto(fit(what), new Uint8Array(into, WHAT, TEXT_BYTES)).written;
  sizes[1] = encoder.encodeInto(fit(file), new Uint8Array(into, FILE, TEXT_BYTES)).written;
}

// The main thread starts the watch when it starts the worker, which on a starved processor may take seconds to run its first line.
export function progressBuffer(): SharedArrayBuffer {
  const made = new SharedArrayBuffer(SIZE);
  new Float64Array(made, 0, 1)[0] = Date.now();
  write(made, 'starting the command', '');
  return made;
}

export function attach(shared: SharedArrayBuffer): void {
  buffer = shared;
  beat = new Float64Array(shared, 0, 1);
  beat[0] = Date.now();
  pool = new Int32Array(shared, POOL, 1);
}

// The pool of threads that parses trees (src/trees.ts) says here whether it works: 0 when it does not, 1 while it does, and 2 once the thread that watches the run has asked it to end. That thread reads the memory of the whole process and cannot tell which of several files parsed at once grows it, so while the pool works it asks for its end and ends the run only after the pool has stopped, or has not in time.
let watching = false;

export function poolBusy(end: () => Promise<void>): void {
  if (pool === null) return;
  const cell = pool;
  if (Atomics.compareExchange(cell, 0, 0, 1) === 2) return void end().then(() => Atomics.store(cell, 0, 0));
  if (watching) return;
  watching = true;
  const watch = (): void => {
    const waited = Atomics.waitAsync(cell, 0, 1);
    const then = () => {
      const now = Atomics.load(cell, 0);
      if (now === 1) return watch();
      watching = false;
      if (now === 2) void end().then(() => Atomics.store(cell, 0, 0));
    };
    if (waited.async) void waited.value.then(then);
    else then();
  };
  watch();
}

export function poolIdle(): void {
  if (pool === null) return;
  if (Atomics.compareExchange(pool, 0, 1, 0) === 1) Atomics.notify(pool, 0);
}

// For the thread that watches: 'asked' when this call asked the pool to end, 'ending' while an earlier ask stands, 'none' when no pool works.
export function askPoolToEnd(shared: SharedArrayBuffer): 'asked' | 'ending' | 'none' {
  const cell = new Int32Array(shared, POOL, 1);
  const was = Atomics.compareExchange(cell, 0, 1, 2);
  if (was === 1) {
    Atomics.notify(cell, 0);
    return 'asked';
  }
  return was === 2 ? 'ending' : 'none';
}

// The command marks each step that may take long without yielding, and the file it is about, so the thread that watches it can name the step that never ended or that took too much memory.
export function step(what: string, file = ''): void {
  if (beat === null) return;
  beat[0] = Date.now();
  write(buffer!, what, file);
}

export function alive(): void {
  if (beat !== null) beat[0] = Date.now();
}

export function lastStep(shared: SharedArrayBuffer): { at: number; what: string; file: string | null } {
  const at = new Float64Array(shared, 0, 1)[0]!;
  const [what, file] = new Int32Array(shared, 8, 2);
  const text = (from: number, size: number) => decoder.decode(new Uint8Array(shared, from, TEXT_BYTES).slice(0, size));
  return { at, what: text(WHAT, what!), file: file === 0 ? null : text(FILE, file!) };
}

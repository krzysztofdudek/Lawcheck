const WHERE_BYTES = 1024;

let beat: Float64Array | null = null;
let length: Int32Array | null = null;
let where: Uint8Array | null = null;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

// The main thread starts the watch when it starts the worker, which on a starved processor may take seconds to run its first line.
export function progressBuffer(): SharedArrayBuffer {
  const buffer = new SharedArrayBuffer(8 + 8 + WHERE_BYTES);
  new Float64Array(buffer, 0, 1)[0] = Date.now();
  new Int32Array(buffer, 8, 1)[0] = encoder.encodeInto('starting the command', new Uint8Array(buffer, 16, WHERE_BYTES)).written;
  return buffer;
}

function views(buffer: SharedArrayBuffer): void {
  beat = new Float64Array(buffer, 0, 1);
  length = new Int32Array(buffer, 8, 1);
  where = new Uint8Array(buffer, 16, WHERE_BYTES);
}

export function attach(buffer: SharedArrayBuffer): void {
  views(buffer);
  beat![0] = Date.now();
}

// The command marks each step that may take long without yielding, so the thread that watches it can name the step that never ended.
export function step(what: string): void {
  if (beat === null) return;
  beat[0] = Date.now();
  length![0] = encoder.encodeInto(what.slice(0, WHERE_BYTES / 4), where!).written;
}

export function alive(): void {
  if (beat !== null) beat[0] = Date.now();
}

export function lastStep(buffer: SharedArrayBuffer): { at: number; what: string } {
  const at = new Float64Array(buffer, 0, 1)[0]!;
  const size = new Int32Array(buffer, 8, 1)[0]!;
  return { at, what: decoder.decode(new Uint8Array(buffer, 16, WHERE_BYTES).slice(0, size)) };
}

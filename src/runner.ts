import { pathToFileURL } from 'node:url';

interface CallFile {
  path: string;
  type: string;
  text: string;
  lines: string[];
}

type Incoming =
  | { kind: 'load'; file: string; filesOf: Map<string, string[]> }
  | { kind: 'call'; file: CallFile };

type Check = (input: { files: CallFile[]; repo: { filesOf(typeId: string): string[] } }) => unknown;

let check: Check | null = null;
let repo: { filesOf(typeId: string): string[] } | null = null;

function text(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split(/\r?\n/)[0] ?? '';
}

function send(message: unknown): void {
  try {
    process.send!(message);
  } catch (error) {
    process.send!({ kind: 'uncloneable', message: text(error) });
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
  if (typeof module.check !== 'function') {
    send({ kind: 'load-failed', message: 'the module exports no function check' });
    return;
  }
  check = module.check as Check;
  send({ kind: 'loaded' });
}

async function call(file: CallFile): Promise<void> {
  let value: unknown;
  try {
    value = await check!({ files: [file], repo: repo! });
  } catch (error) {
    send({ kind: 'threw', message: text(error) });
    return;
  }
  send({ kind: 'result', value });
}

process.on('message', (message: Incoming) => {
  if (message.kind === 'load') void load(message.file, message.filesOf);
  else void call(message.file);
});

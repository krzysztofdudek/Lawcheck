import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { memoryError } from '../../dist/cli.js';
import { askPoolToEnd, attach, lastStep, progressBuffer } from '../../dist/progress.js';
import { RUNNER, runRule, runRules } from '../../dist/rules.js';

function file(path: string, lines: string[]) {
  return { path, type: { id: 'source' }, rules: [], text: lines.join('\n') + '\n', lines } as never;
}

async function withRule(source: string, body: (root: string, ruleFile: string) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-runner-')));
  try {
    mkdirSync(join(root, '.lawcheck/rules'), { recursive: true });
    const ruleFile = join(root, '.lawcheck/rules/r.mjs');
    writeFileSync(ruleFile, source);
    await body(root, ruleFile);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const filesOf = new Map([['source', ['a.ts', 'b.ts']]]);

async function outcomeOf(source: string, run: { entry?: 'check' | 'companion'; files?: string[] } = {}): Promise<unknown> {
  let outcome: unknown;
  await withRule(source, async (root, ruleFile) => {
    outcome = await runRule({ root, rule: 'r', ruleFile, files: (run.files ?? ['a.ts']).map((path) => file(path, ['x'])), filesOf, entry: run.entry });
  });
  return outcome;
}

test('check-slice §3: the runner makes one call per file, in order, and passes repo.filesOf', async () => {
  await withRule(
    "export function check({ files, repo }) { return [{ message: files.length + ' ' + files[0].path + ' ' + files[0].type + ' ' + repo.filesOf('source').join(',') }]; }\n",
    async (root, ruleFile) => {
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf });
      assert.deepEqual(outcome, {
        findings: [
          { rule: 'r', file: 'a.ts', message: '1 a.ts source a.ts,b.ts' },
          { rule: 'r', file: 'b.ts', message: '1 b.ts source a.ts,b.ts' },
        ],
      });
    },
  );
});

test('check-slice §3: a call past the time limit crashes the rule', async () => {
  await withRule('export function check() { while (true) {} }\n', async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000 });
    assert.deepEqual(outcome, { crash: 'passes 1 seconds on a.ts' });
  });
});

test('check-slice §3: a load past the time limit crashes the rule', async () => {
  await withRule('await new Promise(() => {});\nexport function check() { return []; }\n', async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000 });
    assert.deepEqual(outcome, { crash: 'passes 1 seconds in its load' });
  });
});

test('check-slice §3: a module that does not load', async () => {
  await withRule("import './missing.mjs';\nexport function check() { return []; }\n", async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
    assert.ok('crash' in outcome && outcome.crash.startsWith('fails to load: '), JSON.stringify(outcome));
  });
});

test('check-slice §3: process.env is empty in a rule, and an unknown type throws', async () => {
  await withRule(
    "export function check() { return [{ message: Object.keys(process.env).length + '' }]; }\n",
    async (root, ruleFile) => {
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: '0' }] });
    },
  );
  await withRule("export function check({ repo }) { return repo.filesOf('nope'); }\n", async (root, ruleFile) => {
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf });
    assert.deepEqual(outcome, { crash: "throws on a.ts: unknown type 'nope'" });
  });
});

test('check-slice §3: the time limit holds for the load and for each call, not for the rule as a whole', async () => {
  await withRule(
    'const wait = () => new Promise((done) => setTimeout(done, 700));\nawait wait();\nexport async function check({ files }) { await wait(); return [{ message: files[0].path }]; }\n',
    async (root, ruleFile) => {
      const files = [file('a.ts', ['x']), file('b.ts', ['y']), file('c.ts', ['z'])];
      const outcome = await runRule({ root, rule: 'r', ruleFile, files, filesOf, timeoutMs: 1000 });
      assert.deepEqual(outcome, {
        findings: [
          { rule: 'r', file: 'a.ts', message: 'a.ts' },
          { rule: 'r', file: 'b.ts', message: 'b.ts' },
          { rule: 'r', file: 'c.ts', message: 'c.ts' },
        ],
      });
    },
  );
});

function serving(answer: (what: string, path: string) => unknown, waitMs = 0) {
  const asked: string[] = [];
  const serve = async (what: 'tree' | 'uses', asking: { path: string }) => {
    asked.push(`${what} ${asking.path}`);
    if (waitMs > 0) await new Promise((done) => setTimeout(done, waitMs));
    return answer(what, asking.path) as never;
  };
  return { asked, serve };
}

const FLAT = { language: 'typescript', tree: { types: ['program', 'identifier'], fields: ['name'], nodes: Int32Array.of(-1, 0, -1, 1, 0, 2, 1, 0, 0, 1, 0, 1, 0, 1, 1, 0) }, absent: null };

test('test 773: a rule that does not ask for the tree or the uses makes the tool read neither', async () => {
  await withRule("export function check({ files }) { return [{ message: typeof files[0].tree + ' ' + typeof files[0].uses }]; }\n", async (root, ruleFile) => {
    const { asked, serve } = serving(() => FLAT);
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
    assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: 'function function' }, { rule: 'r', file: 'b.ts', message: 'function function' }] });
    assert.deepEqual(asked, []);
  });
});

test('test 773: tree() and uses() ask the tool once per call, for the file of that call, and a tree arrives as nested nodes', async () => {
  await withRule(
    'export async function check({ files: [file] }) {\n  const [one, two, uses] = await Promise.all([file.tree(), file.tree(), file.uses()]);\n  return [{ message: (one === two) + " " + JSON.stringify(one) + " " + JSON.stringify(uses) }];\n}\n',
    async (root, ruleFile) => {
      const { asked, serve } = serving((what) => (what === 'tree' ? FLAT : { uses: [], absent: null }));
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
      const tree = { language: 'typescript', root: { type: 'program', named: true, field: null, start: 0, end: 2, line: 1, column: 0, children: [{ type: 'identifier', named: true, field: 'name', start: 0, end: 1, line: 1, column: 0, children: [] }] }, absent: null };
      const message = `true ${JSON.stringify(tree)} {"uses":[],"absent":null}`;
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message }, { rule: 'r', file: 'b.ts', message }] });
      assert.deepEqual(asked, ['tree a.ts', 'uses a.ts', 'tree b.ts', 'uses b.ts']);
    },
  );
});

test('test 773: the time the tool takes to read what a rule asks for does not count toward the time of the call', async () => {
  await withRule('export async function check({ files: [file] }) { const tree = await file.tree(); return [{ message: tree.absent }]; }\n', async (root, ruleFile) => {
    const { serve } = serving(() => ({ language: null, tree: null, absent: 'no-reader' }), 1500);
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000, serve });
    assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: 'no-reader' }] });
  });
});

test("R-123: a call of one rule does not pass its time limit while the tool, busy reading for another rule, cannot take that call's ask", async () => {
  await withRule("export async function check({ files: [file] }) { await file.uses(); return [{ message: 'one' }]; }\n", async (root, oneFile) => {
    const otherFile = join(root, '.lawcheck/rules/other.mjs');
    writeFileSync(otherFile, "export async function check({ files: [file] }) { await file.tree(); await new Promise((done) => setTimeout(done, 200)); await file.uses(); return [{ message: 'other' }]; }\n");
    let answered = false;
    const uses = { uses: [], absent: null } as never;
    const blocking = async () => {
      const turn = () => new Promise((done) => setImmediate(done));
      while (!answered) await turn();
      for (const until = Date.now() + 50; Date.now() < until; ) await turn();
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1500);
      return uses;
    };
    const other = async (what: 'tree' | 'uses') => {
      if (what === 'uses') return uses;
      answered = true;
      return FLAT as never;
    };
    const [one, two] = await Promise.all([
      runRule({ root, rule: 'one', ruleFile: oneFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 1000, serve: blocking }),
      runRule({ root, rule: 'other', ruleFile: otherFile, files: [file('b.ts', ['y'])], filesOf, timeoutMs: 1000, serve: other }),
    ]);
    assert.deepEqual([one, two], [{ findings: [{ rule: 'one', file: 'a.ts', message: 'one' }] }, { findings: [{ rule: 'other', file: 'b.ts', message: 'other' }] }]);
  });
});

test('test 773: a file kept from an earlier call answers tree() with an error, and the tool is not asked', async () => {
  await withRule(
    'let last = null;\nexport async function check({ files: [file] }) {\n  const before = last;\n  last = file;\n  if (before === null) return [];\n  try { await before.tree(); return []; } catch (error) { return [{ message: error.message }]; }\n}\n',
    async (root, ruleFile) => {
      const { asked, serve } = serving(() => FLAT);
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x']), file('b.ts', ['y'])], filesOf, serve });
      assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'b.ts', message: 'tree() was called after its call of check ended' }] });
      assert.deepEqual(asked, []);
    },
  );
});

test("R-119: a rule that asks the tool again through the channel for what its call already asked crashes as that rule, and the tool reads once", async () => {
  await withRule(
    "export async function check({ files: [file] }) {\n  await file.tree();\n  process._send({ kind: 'ask', id: -1, what: 'tree' }, undefined, {}, () => {});\n  return new Promise(() => {});\n}\n",
    async (root, ruleFile) => {
      const { asked, serve } = serving(() => FLAT);
      const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, timeoutMs: 5000, serve });
      assert.deepEqual(outcome, { crash: "writes to the runner's channel on a.ts" });
      assert.deepEqual(asked, ['tree a.ts']);
    },
  );
});

test('S2-6: an immediate that the runner still has pending when the first message arrives does not hide the background failure of a rule', async () => {
  await withRule(
    "export function check() { setTimeout(() => { const until = Date.now() + 100; const again = () => { if (Date.now() < until) setImmediate(again); else throw new Error('later'); }; again(); }, 200); return []; }\n",
    async (root, ruleFile) => {
      const pending = join(root, 'pending.mjs');
      writeFileSync(pending, "let spin = true;\nconst again = () => { if (spin) setImmediate(again); };\nagain();\nprocess.once('message', () => { spin = false; });\n");
      const child = fork(RUNNER, [], { execArgv: ['--import', pathToFileURL(pending).href], env: {}, cwd: root, serialization: 'advanced', stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
      const exited = new Promise<void>((done) => child.once('exit', () => done()));
      try {
        const queue: unknown[] = [];
        let wake = () => {};
        child.on('message', (message) => {
          queue.push(message);
          wake();
        });
        const next = async () => {
          while (queue.length === 0) await new Promise<void>((done) => (wake = done));
          return queue.shift() as { kind: string };
        };
        assert.equal((await next()).kind, 'ready');
        child.send({ kind: 'load', file: ruleFile, filesOf: new Map(), limits: { messageChars: 4096, findings: 200_000, chars: 16 * 1024 * 1024 } });
        assert.equal((await next()).kind, 'loaded');
        child.send({ kind: 'call', file: { path: 'a.ts', type: null, text: 'x\n', lines: ['x'] } });
        assert.equal((await next()).kind, 'result');
        child.send({ kind: 'finish' });
        assert.deepEqual(await next(), { kind: 'background', message: 'later', load: false });
      } finally {
        child.kill('SIGKILL');
        // Windows ends a killed process a moment after the kill and keeps its working folder until then, so the folder is removed once the runner has ended.
        await exited;
      }
    },
  );
});

test('R-42: started with no channel, the runner ends with no output and the status 0, which is how the tool learns why one did not start', () => {
  const run = spawnSync(process.execPath, [RUNNER], { env: {}, encoding: 'utf8', timeout: 20_000 });
  assert.deepEqual([run.status, run.stdout, run.stderr], [0, '', '']);
});

test('R-42: what a rule throws is told in the words of the runner, by the permission the error names', async () => {
  const said: [string, Record<string, unknown>, string][] = [
    ['a read', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemRead', resource: '/etc/passwd' }, "reads /etc/passwd outside the root and Lawcheck's folder, and a rule may read nothing else"],
    ['a read with no path', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemRead' }, "reads a path outside the root and Lawcheck's folder, and a rule may read nothing else"],
    ['a read with an empty path', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemRead', resource: '' }, "reads a path outside the root and Lawcheck's folder, and a rule may read nothing else"],
    ['a read with a path that is no text', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemRead', resource: 42 }, "reads a path outside the root and Lawcheck's folder, and a rule may read nothing else"],
    ['a write', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemWrite', resource: '/x/out.txt' }, 'writes /x/out.txt, and a rule may write no file'],
    ['a write with no path', { code: 'ERR_ACCESS_DENIED', permission: 'FileSystemWrite' }, 'writes a file, and a rule may write no file'],
    ['a program', { code: 'ERR_ACCESS_DENIED', permission: 'ChildProcess' }, 'starts a program, and a rule may start none'],
    ['a worker', { code: 'ERR_ACCESS_DENIED', permission: 'WorkerThreads' }, 'starts a worker thread, and a rule may start none'],
    ['an add-on', { code: 'ERR_ACCESS_DENIED', permission: 'Addon' }, 'loads a native add-on, and a rule may load none'],
    ['WASI', { code: 'ERR_ACCESS_DENIED', permission: 'WASI' }, 'starts WASI, and a rule may not'],
    ['the network', { code: 'ERR_ACCESS_DENIED', permission: 'Net' }, 'uses the network, which is closed to script rules'],
    ['a permission the runner does not know', { code: 'ERR_ACCESS_DENIED', permission: 'Camera' }, 'does what the runner does not allow (Camera)'],
    ['sqlite', { code: 'ERR_UNKNOWN_BUILTIN_MODULE', message: 'No such built-in module: node:sqlite' }, 'imports node:sqlite, and a rule may not'],
    ['another built-in module', { code: 'ERR_UNKNOWN_BUILTIN_MODULE', message: 'No such built-in module: node:nothing' }, 'No such built-in module: node:nothing'],
    ['a message that ends like sqlite under another code', { code: 'ERR_OTHER', message: 'cannot load node:sqlite' }, 'cannot load node:sqlite'],
    ['a plain error', {}, 'plain'],
  ];
  const outcomes = await Promise.all(said.map(([, fields]) => outcomeOf(`export function check() { throw Object.assign(new Error(${JSON.stringify(fields.message ?? 'plain')}), ${JSON.stringify(fields)}); }\n`)));
  said.forEach(([what], index) => assert.deepEqual(outcomes[index], { crash: `throws on a.ts: ${said[index]![2]}` }, what));
});

test('R-42: a module that lacks the function asked of it fails to load, whichever of check and companion that is, and a companion answers with paths', async () => {
  const checkOnly = 'export function check() { return []; }\n';
  const companionOnly = "export function companion({ file }) { return [file.path + '.d.ts', 'other.ts']; }\n";
  assert.deepEqual(await outcomeOf(checkOnly, { entry: 'companion' }), { crash: 'fails to load: the module exports no function companion' });
  assert.deepEqual(await outcomeOf(companionOnly), { crash: 'fails to load: the module exports no function check' });
  assert.deepEqual(await outcomeOf(companionOnly, { entry: 'check' }), { crash: 'fails to load: the module exports no function check' });
  const answered = (await outcomeOf(companionOnly, { entry: 'companion', files: ['a.ts', 'b.ts'] })) as { findings: unknown[]; paths: Map<string, string[]> };
  assert.deepEqual(answered.findings, []);
  assert.deepEqual([...answered.paths], [['a.ts', ['a.ts.d.ts', 'other.ts']], ['b.ts', ['b.ts.d.ts', 'other.ts']]]);
  assert.deepEqual(await outcomeOf('export function companion() { return 5; }\nexport function check() { return []; }\n', { entry: 'companion' }), { crash: 'returns no list of paths for a.ts' });
  assert.deepEqual(await outcomeOf("export function companion() { return ['a', 7]; }\n", { entry: 'companion' }), { crash: 'returns a path that is no string for a.ts' });
});

test('R-42: what a check returns that is no list of findings is named, and so is an item that is no finding', async () => {
  const returned = async (value: string) => ((await outcomeOf(`export function check() { return ${value}; }\n`)) as { crash?: string; findings?: unknown[] }).crash;
  for (const value of ['{}', '5', 'null', 'undefined', "'abc'"]) assert.equal(await returned(value), 'returns no list for a.ts', value);
  assert.equal(await returned('[null]'), 'returns a finding that is no object for a.ts');
  assert.equal(await returned('[5]'), 'returns a finding that is no object for a.ts');
  assert.equal(await returned('[{ message: 5 }]'), 'returns a finding whose message is the number 5, not a string for a.ts');
  assert.equal(await returned("[{ message: 'a', line: 'x' }]"), 'returns a finding whose line is the string "x", not an integer for a.ts');
  assert.equal(await returned("[{ message: 'a' }]"), undefined);
});

test('R-42: a tree with several nodes below one comes back with its children in the order of the file', async () => {
  await withRule("export async function check({ files: [file] }) { const { root } = await file.tree(); return [{ message: root.children.map((c) => c.type + ':' + c.start).join(',') }]; }\n", async (root, ruleFile) => {
    const { serve } = serving(() => ({ language: 'typescript', tree: { types: ['program', 'a', 'b', 'c'], fields: [], nodes: Int32Array.of(-1, 0, -1, 1, 0, 9, 1, 0, 0, 1, -1, 1, 0, 3, 1, 0, 0, 2, -1, 1, 3, 6, 1, 3, 0, 3, -1, 1, 6, 9, 1, 6) }, absent: null }));
    const outcome = await runRule({ root, rule: 'r', ruleFile, files: [file('a.ts', ['x'])], filesOf, serve });
    assert.deepEqual(outcome, { findings: [{ rule: 'r', file: 'a.ts', message: 'a:0,b:3,c:6' }] });
  });
});

test('R-42: a rule reaches the network by none of the doors the runner shuts, and the error it meets says so', async () => {
  const source = `const net = process.getBuiltinModule('node:net');
const tls = process.getBuiltinModule('node:tls');
const http = process.getBuiltinModule('node:http');
const dgram = process.getBuiltinModule('node:dgram');
const dns = process.getBuiltinModule('node:dns');
const met = (run) => {
  try {
    run();
    return 'open';
  } catch (error) {
    return [error.message, error.code, error.permission].join('|');
  }
};
export function check() {
  const lines = [];
  const socket = new tls.TLSSocket(null);
  const tcp = socket._handle._parent;
  for (const name of ['open', 'bind', 'bind6', 'listen', 'connect', 'connect6']) lines.push('tcp ' + name + ' ' + met(() => Object.getPrototypeOf(tcp)[name].call(tcp)));
  socket.destroy();
  const pipe = process.stdout._handle;
  for (const name of ['bind', 'listen', 'connect']) lines.push('pipe ' + name + ' ' + met(() => Object.getPrototypeOf(pipe)[name].call(pipe)));
  lines.push('net.connect ' + met(() => net.connect(1)));
  lines.push('net.createConnection ' + met(() => net.createConnection(1)));
  lines.push('net._createServerHandle ' + met(() => net._createServerHandle('127.0.0.1', 0)));
  lines.push('BoundSocket ' + ('BoundSocket' in net ? met(() => new net.BoundSocket()) : 'absent'));
  lines.push('_TransferredBoundSocket ' + ('_TransferredBoundSocket' in net ? met(() => new net._TransferredBoundSocket()) : 'absent'));
  lines.push('Socket connect ' + met(() => new net.Socket().connect(1)));
  lines.push('Server listen ' + met(() => new net.Server().listen(0)));
  lines.push('Server _listen2 ' + met(() => net.Server.prototype._listen2.call({})));
  lines.push('dgram ' + met(() => dgram.createSocket('udp4')));
  lines.push('dns ' + met(() => dns.lookup('localhost', () => {})));
  lines.push('http.WebSocket ' + ('WebSocket' in http ? met(() => new http.WebSocket('ws://127.0.0.1:1')) : 'absent'));
  lines.push('fetch ' + met(() => fetch('http://127.0.0.1:1')));
  lines.push('WebSocket ' + met(() => new WebSocket('ws://127.0.0.1:1')));
  lines.push('EventSource ' + ('EventSource' in globalThis ? met(() => new EventSource('http://127.0.0.1:1')) : 'absent'));
  return [{ message: lines.join(' # ') }];
}
`;
  const outcome = (await outcomeOf(source)) as { findings: { message: string }[] };
  assert.ok('findings' in outcome, JSON.stringify(outcome));
  const closed = 'the network is closed to script rules|ERR_ACCESS_DENIED|Net';
  const net = (await import('node:net')) as unknown as Record<string, unknown>;
  const expected = [
    ...['open', 'bind', 'bind6', 'listen', 'connect', 'connect6'].map((name) => `tcp ${name} ${closed}`),
    ...['bind', 'listen', 'connect'].map((name) => `pipe ${name} ${closed}`),
    `net.connect ${closed}`,
    `net.createConnection ${closed}`,
    `net._createServerHandle ${closed}`,
    `BoundSocket ${'BoundSocket' in net ? closed : 'absent'}`,
    `_TransferredBoundSocket ${'_TransferredBoundSocket' in net ? closed : 'absent'}`,
    `Socket connect ${closed}`,
    `Server listen ${closed}`,
    `Server _listen2 ${closed}`,
    `dgram ${closed}`,
    `dns ${closed}`,
    `http.WebSocket ${'WebSocket' in (await import('node:http')) ? closed : 'absent'}`,
    `fetch ${closed}`,
    `WebSocket ${closed}`,
    `EventSource ${'EventSource' in globalThis ? closed : 'absent'}`,
  ];
  assert.deepEqual(outcome.findings[0]!.message.split(' # '), expected);
});

test('R-42: a rule may replace the timer functions the runner patched, and set what it likes on them', async () => {
  const source = `const timers = process.getBuiltinModule('node:timers/promises');
export function check() {
  const timer = setTimeout(() => {}, 0);
  const proto = Object.getPrototypeOf(timer);
  clearTimeout(timer);
  const names = [];
  for (const [owner, name] of [[proto, 'unref'], [timers, 'setTimeout'], [timers, 'setImmediate'], [timers, 'setInterval'], [timers.scheduler, 'wait']]) {
    const original = owner[name];
    try {
      owner[name] = function assigned() {};
      owner[name] = original;
      Object.defineProperty(owner, name, { value: function replaced() {}, writable: true, configurable: true });
      owner[name] = original;
      names.push(name + ' ' + (owner[name] === original));
    } catch (error) {
      names.push(name + ' ' + error.message);
    }
  }
  return [{ message: names.join(', ') + '; ' + String(typeof EventSource) + ' ' + ('EventSource' in globalThis) }];
}
`;
  const outcome = (await outcomeOf(source)) as { findings: { message: string }[] };
  assert.ok('findings' in outcome, JSON.stringify(outcome));
  assert.equal(outcome.findings[0]!.message, `unref true, setTimeout true, setImmediate true, setInterval true, wait true; ${typeof EventSource} ${'EventSource' in globalThis}`);
});

test('R-108: the step of a run that judges files for a script rule names that rule, so memory-too-large names it with a next line that fits', async () => {
  const progress = progressBuffer();
  attach(progress);
  await withRule('export function check() { return []; }\n', async (root, ruleFile) => {
    await runRule({ root, rule: 'no-console', ruleFile, files: [file('a.ts', ['x'])], filesOf });
  });
  const last = lastStep(progress);
  assert.equal(last.what, 'judging the files for the script rule no-console');
  const error = memoryError('run', last.what, last.file, 'check');
  assert.equal(error.message, 'the run passed the 1536 MiB of memory it may hold while judging the files for the script rule no-console');
  assert.equal(error.next, 'narrow the types whose files the script rule no-console judges in .lawcheck/law.yaml, or run Lawcheck where it may hold more memory, then run lawcheck check again');
});

test('R-42: a message holds at most 4,096 code points, a pair of surrogates counts as one, and any other surrogate counts by itself', async () => {
  const cases: [string, string, number][] = [
    ['pairs of the lowest code point of the astral planes', "'\\u{10000}'.repeat(N)", 4096],
    ['pairs of the highest code point', "'\\u{10FFFF}'.repeat(N)", 4096],
    ['pairs of an emoji', "'\\u{1F600}'.repeat(N)", 4096],
    ['low surrogates on their own', "'\\udc00'.repeat(N)", 4096],
    ['a low surrogate after a letter', "'a\\udc00'.repeat(N / 2)", 4096],
    ['a high surrogate before a letter', "'\\ud800a'.repeat(N / 2)", 4096],
    ['letters', "'a'.repeat(N)", 4096],
  ];
  const message = (build: string, n: number) => outcomeOf(`export function check() { return [{ message: ${build.replace(/N/g, String(n))} }]; }\n`) as Promise<{ crash?: string; findings?: unknown[] }>;
  for (const [what, build, limit] of cases) {
    const fits = await message(build, limit);
    assert.equal(fits.crash, undefined, `${what} at ${limit}: ${fits.crash}`);
    assert.equal(fits.findings?.length, 1, what);
    const over = await message(build, limit + 2);
    assert.equal(over.crash, 'returns a message of 4,098 characters for a.ts, and a message holds at most 4,096', what);
  }
});

async function withRules(sources: Record<string, string>, body: (root: string, task: (rule: string, run?: { timeoutMs?: number; files?: string[] }) => { run: never }) => Promise<void>): Promise<void> {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-runners-')));
  try {
    for (const [path, source] of Object.entries(sources)) {
      mkdirSync(join(root, '.lawcheck/rules', path, '..'), { recursive: true });
      writeFileSync(join(root, '.lawcheck/rules', path), source);
    }
    await body(root, (rule, run = {}) => ({ run: { root, rule, ruleFile: join(root, `.lawcheck/rules/${rule}.mjs`), files: (run.files ?? ['a.ts']).map((path) => file(path, ['x'])), filesOf, ...(run.timeoutMs === undefined ? {} : { timeoutMs: run.timeoutMs }) } as never }));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const SAYS_PID = "export function check() { return [{ message: String(process.pid) }]; }\n";

function messages(outcome: unknown): string[] {
  return ((outcome as { findings?: { message: string }[] }).findings ?? []).map((finding) => finding.message);
}

test('test 1397: the rules of a run that leave nothing behind share one runner, each rule sees all its files in order, and the outcomes come in the order of the rules', async () => {
  const counting = "let calls = 0;\nexport function check({ files: [file] }) { return [{ message: `${process.pid} ${++calls} ${file.path}` }]; }\n";
  await withRules({ 'one.mjs': counting, 'two.mjs': counting, 'three.mjs': counting }, async (_root, task) => {
    const outcomes = await runRules(['one', 'two', 'three'].map((rule) => task(rule, { files: ['a.ts', 'b.ts'] })), 1);
    const said = outcomes.map((outcome) => messages(outcome));
    const pid = said[0]![0]!.split(' ')[0];
    assert.deepEqual(said, [1, 2, 3].map(() => [`${pid} 1 a.ts`, `${pid} 2 b.ts`]));
    assert.deepEqual(outcomes.map((outcome) => (outcome as any).findings.map((finding: any) => finding.rule)), [['one', 'one'], ['two', 'two'], ['three', 'three']]);
  });
});

test('test 1397: two rules that import the same helper each get their own copy of it, and the module of a rule has a URL that ends with its id and still names its file', async () => {
  const rule = "import { fileURLToPath } from 'node:url';\nimport { next } from './lib/count.mjs';\nexport function check() { return [{ message: `${process.pid} ${next()} ${import.meta.url.split('?')[1]} ${fileURLToPath(import.meta.url).endsWith(import.meta.url.split('?')[1].slice(5) + '.mjs')}` }]; }\n";
  await withRules({ 'one.mjs': rule, 'two.mjs': rule, 'lib/count.mjs': 'let count = 0;\nexport function next() { return ++count; }\n' }, async (_root, task) => {
    const outcomes = await runRules([task('one', { files: ['a.ts', 'b.ts'] }), task('two', { files: ['a.ts', 'b.ts'] })], 1);
    const said = outcomes.map((outcome) => messages(outcome));
    const pid = said[0]![0]!.split(' ')[0];
    assert.deepEqual(said, [
      [`${pid} 1 rule=one true`, `${pid} 2 rule=one true`],
      [`${pid} 1 rule=two true`, `${pid} 2 rule=two true`],
    ]);
  });
});

test('test 1397: after a rule that leaves something a later rule could meet, the next rule gets a fresh runner and meets none of it', async () => {
  const sees = "export function check() { return [{ message: [process.pid, typeof globalThis.left, [].left, process.env.LEFT, process.cwd().endsWith('rules'), JSON.left, process.listenerCount('exit')].join(' ') }]; }\n";
  const leaves: [string, string][] = [
    ['a global', 'globalThis.left = 1;'],
    ['a property of a built-in prototype', 'Array.prototype.left = 1;'],
    ['a variable of the environment', "process.env.LEFT = '1';"],
    ['another working directory', "process.chdir('.lawcheck/rules');"],
    ['a property of a built-in object', 'JSON.left = 1;'],
    ['a listener on process', "process.on('exit', () => {});"],
    ['a timer', 'setInterval(() => {}, 1000);'],
    ['a line it printed', "console.error('left');"],
    ['a changed export of a built-in module', "import fs from 'node:fs';\nfs.left = 1;"],
    ['a CommonJS module', "import { createRequire } from 'node:module';\ncreateRequire(import.meta.url)('./lib/state.cjs');"],
  ];
  for (const [what, code] of leaves) {
    await withRules({ 'before.mjs': SAYS_PID, 'leaves.mjs': `${code}\n${SAYS_PID}`, 'after.mjs': sees, 'lib/state.cjs': 'module.exports = {};\n' }, async (_root, task) => {
      const [before, leaving, after] = (await runRules([task('before'), task('leaves'), task('after')], 1)).map((outcome) => messages(outcome));
      assert.deepEqual(leaving, before, `${what}: the rule runs in the runner of the rule before it`);
      const [pid, ...seen] = after![0]!.split(' ');
      assert.notEqual(pid, before![0], `${what}: the next rule has a fresh runner`);
      assert.deepEqual(seen, ['undefined', '', '', 'false', '', '0'], what);
    });
  }
});

test('test 1398: a rule that hangs, ends its process, has its process killed as a system short of memory kills one, throws, returns no list or fails in the background is named alone, and the other rules of the run give their findings', async () => {
  const fine = "export function check({ files: [file] }) { return [{ message: 'fine ' + file.path }]; }\n";
  await withRules(
    {
      'first.mjs': fine,
      'hangs.mjs': 'export function check() { while (true) {} }\n',
      'second.mjs': fine,
      'exits.mjs': 'export function check() { process.exit(3); }\n',
      'killed.mjs': "export function check() { process.kill(process.pid, 'SIGKILL'); return new Promise(() => {}); }\n",
      'throws.mjs': "export function check() { throw new Error('broke'); }\n",
      'third.mjs': fine,
      'returns.mjs': 'export function check() { return 7; }\n',
      'rejects.mjs': "export function check() { Promise.reject(new Error('late')); return []; }\n",
      'last.mjs': fine,
    },
    async (_root, task) => {
      for (const limit of [1, 3]) {
        const outcomes = await runRules(['first', 'hangs', 'second', 'exits', 'killed', 'throws', 'third', 'returns', 'rejects', 'last'].map((rule) => task(rule, rule === 'hangs' ? { timeoutMs: 1000 } : {})), limit);
        const found = (rule: string) => ({ findings: [{ rule, file: 'a.ts', message: 'fine a.ts' }] });
        assert.deepEqual(outcomes, [
          found('first'),
          { crash: 'passes 1 seconds on a.ts' },
          found('second'),
          { crash: 'ends before answering on a.ts' },
          { crash: 'ends before answering on a.ts' },
          { crash: 'throws on a.ts: broke' },
          found('third'),
          { crash: 'returns no list for a.ts' },
          { crash: 'fails in the background: late' },
          found('last'),
        ]);
      }
    },
  );
});

test('test 1398: the findings of a rule count toward the run once, whether it ran in a shared runner or again alone', async () => {
  const two = "export function check() { return [{ message: 'one' }, { message: 'two' }]; }\n";
  await withRules({ 'fine.mjs': two, 'throws.mjs': "let calls = 0;\nexport function check() { if (++calls === 2) throw new Error('broke'); return [{ message: 'before the throw' }]; }\n" }, async (root, task) => {
    const { FindingBudget } = await import('../../dist/rules.js');
    const budget = new FindingBudget();
    const tasks = [task('fine'), task('throws', { files: ['a.ts', 'b.ts'] })].map(({ run }) => ({ run: { ...(run as object), budget } as never }));
    const outcomes = await runRules(tasks, 1);
    assert.deepEqual(outcomes[1], { crash: 'throws on b.ts: broke' });
    assert.deepEqual([budget.total, budget.chars, [...budget.byRule]], [3, 22, [['fine', { count: 2, chars: 6 }], ['throws', { count: 1, chars: 16 }]]]);
    void root;
  });
});

test('test 1402: a rule that replaces a method of console or the write of an output stream, or sets a callback for uncaught exceptions, is the last rule of its runner, and the next rule meets none of it', async () => {
  const sees = "export function check() { return [{ message: [process.pid, console.log.name, console.error.name, process.stdout.write.name, process.stderr.write.name, process.hasUncaughtExceptionCaptureCallback()].join(' ') }]; }\n";
  const leaves: [string, string][] = [
    ['a replaced console.log', 'console.log = function left() {};'],
    ['a replaced console.error', 'console.error = function left() {};'],
    ['a replaced write of standard output', 'process.stdout.write = function left() { return true; };'],
    ['a replaced write of standard error', 'process.stderr.write = function left() { return true; };'],
    ['a callback for uncaught exceptions', 'process.setUncaughtExceptionCaptureCallback(() => {});'],
  ];
  for (const [what, code] of leaves) {
    await withRules({ 'before.mjs': SAYS_PID, 'leaves.mjs': `export function check() { ${code} return [{ message: String(process.pid) }]; }\n`, 'after.mjs': sees }, async (_root, task) => {
      const [before, leaving, after] = (await runRules([task('before'), task('leaves'), task('after')], 1)).map((outcome) => messages(outcome));
      assert.deepEqual(leaving, before, `${what}: the rule runs in the runner of the rule before it`);
      const [pid, ...seen] = after![0]!.split(' ');
      assert.notEqual(pid, before![0], `${what}: the next rule has a fresh runner`);
      assert.deepEqual(seen, ['log', 'error', '', '', 'false'], what);
    });
  }
});

test('test 1402: two rules that import the same helper by a URL with a query or a fragment each get their own copy of it', async () => {
  const rule = (specifier: string) => `import { next } from '${specifier}';\nexport function check() { return [{ message: \`\${process.pid} \${next()}\` }]; }\n`;
  for (const specifier of ['./lib/count.mjs?v=2', './lib/count.mjs#part', './lib/count.mjs?v=2#part']) {
    await withRules({ 'one.mjs': rule(specifier), 'two.mjs': rule(specifier), 'lib/count.mjs': "let count = 0;\nexport function next() { return `${++count} ${import.meta.url.slice(import.meta.url.indexOf('count.mjs') + 9)}`; }\n" }, async (_root, task) => {
      const outcomes = await runRules([task('one', { files: ['a.ts', 'b.ts'] }), task('two', { files: ['a.ts', 'b.ts'] })], 1);
      const said = outcomes.map((outcome) => messages(outcome));
      const pid = said[0]![0]!.split(' ')[0];
      const [query, fragment = ''] = specifier.slice('./lib/count.mjs'.length).split('#');
      const ending = (id: string) => `${query === '' ? '?' : `${query}&`}rule=${id}${fragment === '' ? '' : `#${fragment}`}`;
      assert.deepEqual(said, [[`${pid} 1 ${ending('one')}`, `${pid} 2 ${ending('one')}`], [`${pid} 1 ${ending('two')}`, `${pid} 2 ${ending('two')}`]], specifier);
    });
  }
});

test('test 1422: a rule that replaces write on a prototype that standard output or standard error inherits from is the last rule of its runner, and the next rule meets none of it', async () => {
  const sees = "export function check() { return [{ message: [process.pid, process.stdout.write.name, process.stderr.write.name].join(' ') }]; }\n";
  const leaves: [string, string][] = [
    ['the prototype of standard output', 'Object.getPrototypeOf(process.stdout).write = function left() { return true; };'],
    ['the prototype of standard error', 'Object.getPrototypeOf(process.stderr).write = function left() { return true; };'],
    ['a prototype further up the chain of standard output', 'Object.getPrototypeOf(Object.getPrototypeOf(process.stdout)).write = function left() { return true; };'],
  ];
  for (const [what, code] of leaves) {
    await withRules({ 'before.mjs': SAYS_PID, 'leaves.mjs': `export function check() { ${code} return [{ message: String(process.pid) }]; }\n`, 'after.mjs': sees }, async (_root, task) => {
      const [before, leaving, after] = (await runRules([task('before'), task('leaves'), task('after')], 1)).map((outcome) => messages(outcome));
      assert.deepEqual(leaving, before, `${what}: the rule runs in the runner of the rule before it`);
      const [pid, ...seen] = after![0]!.split(' ');
      assert.notEqual(pid, before![0], `${what}: the next rule has a fresh runner`);
      assert.deepEqual(seen, ['', ''], what);
    });
  }
});

test("test 1423: a rule that imports another rule's module by that rule's ending gets a copy of its own, not the other rule's live module", async () => {
  const source = "export let value = 'none';\nexport function check() { value = 'set'; return [{ message: String(process.pid) }]; }\n";
  const reader = (specifier: string) => `export async function check() { const { value } = await import('${specifier}'); return [{ message: \`\${process.pid} \${value}\` }]; }\n`;
  await withRules({ 'source.mjs': source, 'reader.mjs': reader('./source.mjs?rule=source') }, async (_root, task) => {
    const [set, read] = (await runRules([task('source'), task('reader')], 1)).map((outcome) => messages(outcome));
    assert.deepEqual(read, [`${set![0]} none`]);
  });
});

test('test 1403: a rule that crashes as the first rule of a fresh runner runs once, and a rule that crashes after another rule of its runner runs again alone', async () => {
  const crashes = "console.error('loaded in ' + process.pid);\nexport function check() { throw new Error('broke in ' + process.pid); }\n";
  const fine = "export function check() { return []; }\n";
  const write = process.stderr.write;
  const printed: string[] = [];
  process.stderr.write = ((chunk: string | Uint8Array) => {
    printed.push(String(chunk));
    return true;
  }) as typeof process.stderr.write;
  try {
    await withRules({ 'crashes.mjs': crashes, 'fine.mjs': fine }, async (_root, task) => {
      const [first] = (await runRules([task('crashes')], 1)) as { crash: string }[];
      const loaded = /^loaded in (\d+)\n$/.exec(printed.join(''))?.[1];
      assert.equal(first!.crash, `throws on a.ts: broke in ${loaded}`);
      printed.length = 0;
      const [, second] = (await runRules([task('fine'), task('crashes')], 1)) as { crash: string }[];
      const shared = /^loaded in (\d+)\n$/.exec(printed.join(''))?.[1];
      const alone = /^throws on a\.ts: broke in (\d+)$/.exec(second!.crash)?.[1];
      assert.ok(shared !== undefined && alone !== undefined && shared !== alone, `printed ${printed.join('')}, crashed ${second!.crash}`);
    });
  } finally {
    process.stderr.write = write;
  }
});

test('test 1404: asked for memory by the thread that watches, the rules of a run go on one at a time, each in a runner that ends with it, and every rule still gives its findings once', async () => {
  const buffer = progressBuffer();
  attach(buffer);
  const slow = "let calls = 0;\nexport async function check({ files: [file] }) { await new Promise((done) => setTimeout(done, 150)); return [{ message: `${process.pid} ${++calls} ${file.path}` }]; }\n";
  const ids = ['r1', 'r2', 'r3', 'r4', 'r5', 'r6'];
  await withRules(Object.fromEntries(ids.map((id) => [`${id}.mjs`, slow])), async (_root, task) => {
    const running = runRules(ids.map((id) => task(id, { files: ['a.ts', 'b.ts'] })), 3);
    await new Promise((done) => setTimeout(done, 400));
    assert.equal(askPoolToEnd(buffer), 'asked');
    const outcomes = await running;
    const said = outcomes.map((outcome) => messages(outcome));
    assert.deepEqual(said.map((own) => own.map((message) => message.split(' ').slice(1).join(' '))), ids.map(() => ['1 a.ts', '2 b.ts']));
    assert.deepEqual(outcomes.map((outcome) => (outcome as any).findings.map((finding: any) => finding.rule)), ids.map((id) => [id, id]));
    const runners = said.map((own) => own[0]!.split(' ')[0]);
    assert.ok(new Set(runners.slice(3)).size === 3, `the rules that started after the ask ran in ${runners.slice(3).join(', ')}`);
    assert.equal(askPoolToEnd(buffer), 'none');
  });
});

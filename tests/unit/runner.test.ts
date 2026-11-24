import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fork, spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { RUNNER, runRule } from '../../dist/rules.js';

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
        child.send({ kind: 'load', file: ruleFile, filesOf: new Map() });
        assert.equal((await next()).kind, 'loaded');
        child.send({ kind: 'call', file: { path: 'a.ts', type: null, text: 'x\n', lines: ['x'] } });
        assert.equal((await next()).kind, 'result');
        child.send({ kind: 'finish' });
        assert.deepEqual(await next(), { kind: 'background', message: 'later', load: false });
      } finally {
        child.kill('SIGKILL');
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
  assert.equal(await returned('[{ message: 5 }]'), 'returns a finding without a message for a.ts');
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

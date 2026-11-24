import { test } from 'node:test';
import { platformSkip } from '../harness/tool.ts';
import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createdIn, descendantsIn, findProgram, killTree, startProgram, stillListed, ticksAt, toEnd } from '../../dist/programs.js';

function inDir(body: (dir: string) => void | Promise<void>): Promise<void> {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'lawcheck-programs-')));
  return Promise.resolve(body(dir)).finally(() => rmSync(dir, { recursive: true, force: true, maxRetries: 5 }));
}

function executable(path: string, text: string): void {
  writeFileSync(path, text);
  chmodSync(path, 0o755);
}

function argvProgram(dir: string): string {
  const script = join(dir, 'argv.mjs');
  writeFileSync(script, 'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n');
  if (process.platform === 'win32') {
    executable(join(dir, 'argv.cmd'), `@"${process.execPath}" "${script}" %*\r\n`);
    return join(dir, 'argv.cmd');
  }
  executable(join(dir, 'argv'), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`);
  return join(dir, 'argv');
}

test('reviewer-slice §6: a program is found on PATH, and on Windows by the endings of PATHEXT', async () => {
  await inDir((dir) => {
    executable(join(dir, 'tool'), '#!/bin/sh\n');
    if (platformSkip('the lookup with the rules of Linux') === null) {
      assert.equal(findProgram('tool', { PATH: ['/nonexistent', '', dir].join(':') }, 'linux'), join(dir, 'tool'));
      assert.equal(findProgram('none', { PATH: dir }, 'linux'), null);
    }
    assert.equal(findProgram('tool', { Path: dir, PATHEXT: '.EXE;.CMD' }, 'win32'), null);
    executable(join(dir, 'tool.cmd'), '@echo off\r\n');
    assert.equal(findProgram('tool', { Path: `C:\\nonexistent;${dir}`, PATHEXT: '.EXE;.CMD' }, 'win32'), join(dir, 'tool.cmd'));
    assert.equal(findProgram('tool', { PATH: dir }, 'win32'), join(dir, 'tool.cmd'));
  });
});

test('reviewer-slice §6: every argument and the output pass through a program started as the callers start it, a .cmd file on Windows too', async () => {
  await inDir(async (dir) => {
    argvProgram(dir);
    const program = findProgram('argv', { PATH: dir, PATHEXT: '.CMD' })!;
    const args = ['', 'plain', 'two words', '{"mcpServers":{}}', 'a&b|c<d>e^f', '50% (%PATH%) !x!', 'back\\slash\\', 'quote"inside', './src/core/discount.ts'];
    const child = startProgram(program, args, { cwd: dir, env: process.env, detached: true, stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout!.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    const code = await new Promise<number | null>((done) => child.on('close', done));
    assert.equal(code, 0);
    assert.deepEqual(JSON.parse(out), args);
  });
});

test('reviewer-slice §6: killTree ends a program and the programs it started', async () => {
  await inDir(async (dir) => {
    const script = join(dir, 'parent.mjs');
    writeFileSync(script, "import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nprocess.stdout.write(String(c.pid) + '\\n');\nsetInterval(() => {}, 1000);\n");
    const parent = startProgram(process.execPath, [script], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    const grandchild = await new Promise<number>((done) => parent.stdout!.setEncoding('utf8').once('data', (line: string) => done(Number(line.trim()))));
    const closed = new Promise((done) => parent.on('close', done));
    assert.equal(killTree(parent.pid!, 'SIGKILL'), true);
    await closed;
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(grandchild, 0);
        await new Promise((done) => setTimeout(done, 100));
      } catch {
        alive = false;
      }
    }
    assert.equal(alive, false);
  });
});

test('reviewer-slice §6: killTree with orphans ends the programs left by a program that has already ended', async () => {
  await inDir(async (dir) => {
    const script = join(dir, 'leave.mjs');
    // Node on Windows ends the programs it started undetached when it exits; cmd.exe does not, which a detached child stands in for here.
    const detached = process.platform === 'win32';
    writeFileSync(script, `import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: ${detached} });\nc.unref();\nprocess.stdout.write(String(c.pid) + '\\n');\n`);
    const parent = startProgram(process.execPath, [script], { cwd: dir, detached: true, stdio: ['ignore', 'pipe', 'ignore'] });
    let out = '';
    parent.stdout!.setEncoding('utf8').on('data', (chunk: string) => (out += chunk));
    await new Promise((done) => parent.on('close', done));
    const orphan = Number(out.trim());
    process.kill(orphan, 0);
    killTree(parent.pid!, 'SIGKILL', true);
    let alive = true;
    for (let i = 0; i < 50 && alive; i++) {
      try {
        process.kill(orphan, 0);
        await new Promise((done) => setTimeout(done, 100));
      } catch {
        alive = false;
      }
    }
    if (alive) process.kill(orphan, 'SIGKILL');
    assert.equal(alive, false);
  });
});

test('reviewer-slice §6: the descendants of a process are read from the list of processes, its own id never among them', () => {
  const table = ['10 1 5', '11 10 6', '12 11 7', '13 10 8', '20 1 9', '21 20 10', '30 30 11', ''].join('\r\n');
  assert.deepEqual(descendantsIn(table, 10).sort((a, b) => a - b), [11, 12, 13]);
  assert.deepEqual(descendantsIn(table, 20), [21]);
  assert.deepEqual(descendantsIn(table, 30), []);
  assert.deepEqual(descendantsIn('', 10), []);
});

test('R-34: the time each process was made is read from the list of processes', () => {
  const table = ['10 1 638900000000000001', '11 10 638900000000000002', 'junk', '12 11', ''].join('\r\n');
  assert.deepEqual([...createdIn(table)], [[10, '638900000000000001'], [11, '638900000000000002']]);
});

test('R-34: below a root that ended with the tool, the guard ends what the list made after the end shows, and of the earlier list only what that list still shows', () => {
  const before = ['100 1 500', '101 100 501', '103 100 503', ''].join('\r\n');
  const after = ['101 100 501', '102 101 502', '103 7 903', '104 103 904', '200 1 600', ''].join('\r\n');
  assert.deepEqual(toEnd(before, after, [100]).sort((a, b) => a - b), [101, 102]);
  assert.deepEqual(toEnd('', after, [100]).sort((a, b) => a - b), [101, 102]);
  assert.deepEqual(toEnd(before, before, [100]).sort((a, b) => a - b), [100, 101, 103]);
  assert.deepEqual(toEnd(before, '', [100]), []);
});

test('R-34: below each root the guard ends only what the root made, matching the id and the time of making, and not what a process given a dead root\'s id has started', () => {
  const before = ['100 1 500', '101 100 501', '200 1 510', '201 200 511', '400 1 520', ''].join('\r\n');
  const after = ['100 9 900', '300 100 950', '101 100 501', '102 101 520', '201 200 511', '202 201 530', '203 200 540', '205 200 400', '400 1 520', '401 400 560', ''].join('\r\n');
  assert.deepEqual(toEnd(before, after, [100, 200, 400]).sort((a, b) => a - b), [101, 102, 201, 202, 203, 400, 401]);
  assert.deepEqual(toEnd(before, after, [200, 100]).sort((a, b) => a - b), [101, 102, 201, 202, 203]);
});

test('R-34: the guard kills from its list only a process whose id and time of making a later list still shows', () => {
  const before = ['100 1 500', '101 100 501', '102 101 502', '103 100 503', '200 1 600', ''].join('\r\n');
  const reused = ['101 7 901', '102 101 502', '103 100 503', '200 1 600', ''].join('\r\n');
  assert.deepEqual(stillListed(before, reused, [100]).sort((a, b) => a - b), [102, 103]);
  assert.deepEqual(stillListed(before, before, [100]).sort((a, b) => a - b), [100, 101, 102, 103]);
  assert.deepEqual(stillListed(before, '', [100]), []);
  assert.deepEqual(stillListed(before, reused, [200]), [200]);
});

test('R-68: below a root the earlier list does not show, the guard ends what was made after its own start and before the process that now holds the root\'s id, and nothing that process made', () => {
  const after = ['100 9 900', '300 100 950', '101 100 501', '102 101 502', '77 100 300', '50 1 400', ''].join('\r\n');
  assert.deepEqual(toEnd('', after, [100], '400').sort((a, b) => a - b), [101, 102]);
  assert.deepEqual(toEnd(['50 1 400', ''].join('\r\n'), after, [100], '400').sort((a, b) => a - b), [101, 102]);
  assert.deepEqual(toEnd('', ['101 100 501', '77 100 300', ''].join('\r\n'), [100], '400'), [101]);
  assert.deepEqual(stillListed(['101 100 501', '77 100 300', ''].join('\r\n'), ['101 100 501', '77 100 300', ''].join('\r\n'), [100], '400'), [101]);
});

test('R-64: of the earlier list the guard kills below a root only what was made after the process above it, never the children of an older process that held the root\'s id', () => {
  const before = ['100 1 500', '101 100 501', '102 101 502', '400 100 300', '401 400 310', '103 101 499', ''].join('\r\n');
  assert.deepEqual(stillListed(before, before, [100]).sort((a, b) => a - b), [100, 101, 102]);
  assert.deepEqual(toEnd(before, before, [100]).sort((a, b) => a - b), [100, 101, 102]);
});

test('test 1047: below a root whose start the tool gave, the guard ends nothing made before that start, and a process an earlier list shows with the root\'s id made before it is an earlier holder of that id', () => {
  const since = new Map([[100, '480']]);
  assert.deepEqual(toEnd('', ['50 1 400', '70 100 460', '101 100 501', ''].join('\r\n'), [100], '400', since), [101]);
  const holder = ['100 1 300', '70 100 350', ''].join('\r\n');
  const after = ['70 100 350', '101 100 501', ''].join('\r\n');
  assert.deepEqual(toEnd(holder, after, [100], '400', since), [101]);
  assert.deepEqual(stillListed(holder, holder, [100], '400', since), []);
  const own = ['100 1 500', '101 100 501', ''].join('\r\n');
  assert.deepEqual(toEnd(own, own, [100], '400', since).sort((a, b) => a - b), [100, 101]);
  assert.equal(ticksAt(0), '621355968000000000');
  // new DateTime(2000, 1, 1, 0, 0, 0, DateTimeKind.Utc).Ticks in .NET.
  assert.equal(ticksAt(Date.UTC(2000, 0, 1)), '630822816000000000');
});

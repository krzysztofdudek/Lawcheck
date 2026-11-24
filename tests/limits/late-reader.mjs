// Starts Lawcheck as a caller that is late to take its standard error, and passes on both streams and the exit code. `result` takes standard error one second after standard output holds the whole JSON result, `exit` once Lawcheck has ended, and `line` takes it up to the first line break, then no more until Lawcheck has ended. A signal it gets goes on to Lawcheck.
import { spawn } from 'node:child_process';
import { writeSync } from 'node:fs';

const [cli, takes, ...args] = process.argv.slice(2);
const child = spawn(process.execPath, [cli, ...args], { stdio: ['ignore', 'pipe', 'pipe'] });

// Written at once and tried again while the pipe to the test is full, so nothing waits in this program when it ends.
const nap = new Int32Array(new SharedArrayBuffer(4));
const pass = (fd, chunk) => {
  for (let at = 0; at < chunk.length; ) {
    try {
      at += writeSync(fd, chunk, at);
    } catch (error) {
      if (error.code !== 'EAGAIN') throw error;
      Atomics.wait(nap, 0, 0, 1);
    }
  }
};

const take = () => child.stderr.resume();
if (takes !== 'line') child.stderr.pause();
child.stderr.on('data', (chunk) => {
  pass(2, chunk);
  if (takes === 'line' && child.exitCode === null && child.signalCode === null && chunk.includes(10)) child.stderr.pause();
});
child.once('exit', take);

let result = '';
child.stdout.on('data', (chunk) => {
  pass(1, chunk);
  if (takes !== 'result') return;
  result += chunk;
  try {
    JSON.parse(result);
  } catch {
    return;
  }
  setTimeout(take, 1000);
});
// On Windows Node writes to a pipe in the writer's own time, so Lawcheck gets to its result only once its standard error is taken, and a hold until the result or the end would never end.
if (takes !== 'line' && process.platform === 'win32') take();

for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.on(signal, () => child.kill(signal));
child.once('close', (code, signal) => process.exit(signal === null ? code : 70));

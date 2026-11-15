import * as real from 'node:test';

export * from 'node:test';

const queue = [];
let state = Number(process.env.LAWCHECK_SHUFFLE) >>> 0;

function next() {
  state = (state + 0x6d2b79f5) >>> 0;
  let t = state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

function flush() {
  for (let i = queue.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [queue[i], queue[j]] = [queue[j], queue[i]];
  }
  for (const args of queue.splice(0)) real.test(...args);
}

export const test = Object.assign(function shuffledTest(...args) {
  if (queue.length === 0) setImmediate(flush);
  queue.push(args);
  return Promise.resolve();
}, real.test);

export const it = test;
export default test;

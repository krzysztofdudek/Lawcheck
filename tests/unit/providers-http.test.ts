import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { cause, noAnswer, post } from '../../dist/providers/http.js';

async function serve(handler: Parameters<typeof createServer>[1], body: (url: string) => Promise<void>) {
  const server = createServer(handler);
  const sockets = new Set<import('node:net').Socket>();
  server.on('connection', (socket) => sockets.add(socket));
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', () => done()));
  try {
    await body(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((done) => server.close(done));
  }
}

test('reviewer-slice §6: a 2xx JSON body is returned as it came', async () => {
  await serve((req, res) => {
    let text = '';
    req.on('data', (c) => (text += c)).on('end', () => res.end(JSON.stringify({ got: JSON.parse(text), type: req.headers['content-type'], extra: req.headers['x-extra'] })));
  }, async (url) => {
    assert.deepEqual(await post(url, { 'x-extra': 'y' }, { a: 1 }, 5), { body: { got: { a: 1 }, type: 'application/json', extra: 'y' } });
  });
});

test('test 403: statuses, a body that is no JSON, a redirect and an error message', async () => {
  await serve((req, res) => {
    if (req.url === '/429') return res.writeHead(429).end();
    if (req.url === '/401') return res.writeHead(401).end(JSON.stringify({ error: { message: 'bad key\nsecond line' } }));
    if (req.url === '/403') return res.writeHead(403).end(JSON.stringify({ error: { message: 'y'.repeat(300) } }));
    if (req.url === '/404') return res.writeHead(404).end(JSON.stringify({ error: "model 'm' not found\nsecond line" }));
    if (req.url === '/400') return res.writeHead(400).end(JSON.stringify({ error: '  ' }));
    if (req.url === '/307') return res.writeHead(307, { location: '/elsewhere' }).end();
    if (req.url === '/html') return res.end('<html></html>');
    res.writeHead(500).end('{}');
  }, async (url) => {
    assert.deepEqual(await post(`${url}/429`, {}, {}, 5), { failure: 'HTTP 429 Too Many Requests', resend: 'after-2s', fix: "wait until the provider's rate limit allows another call" });
    const denied = await post(`${url}/401`, {}, {}, 5);
    assert.ok('failure' in denied && denied.failure.startsWith('HTTP 401 Unauthorized: bad key') && !denied.failure.includes('second'));
    assert.deepEqual(await post(`${url}/403`, {}, {}, 5, { keyName: 'OPENAI_API_KEY' }), { failure: `HTTP 403 Forbidden: ${'y'.repeat(200)}`, resend: false, fix: 'check the key in OPENAI_API_KEY' });
    assert.deepEqual(await post(`${url}/404`, {}, {}, 5, { base: 'B' }), { failure: "HTTP 404 Not Found: model 'm' not found", resend: false, fix: 'check that B is the right address, or ask the user to check reviewer.model in .lawcheck/config.yaml' });
    assert.deepEqual(await post(`${url}/400`, {}, {}, 5, { base: 'B' }), { failure: 'HTTP 400 Bad Request', resend: false, fix: 'fix what the reviewer at B says' });
    assert.deepEqual(await post(`${url}/307`, {}, {}, 5), { failure: 'HTTP 307 Temporary Redirect', resend: false, fix: 'set LAWCHECK_REVIEWER_ENDPOINT to the address that answers without a redirect' });
    assert.deepEqual(await post(`${url}/500`, {}, {}, 5, { base: 'B' }), { failure: 'HTTP 500 Internal Server Error', resend: false, fix: 'wait until the reviewer at B works again' });
    const keyless = await post(`${url}/401`, {}, {}, 5, { base: 'B', keyName: null });
    assert.ok('failure' in keyless && keyless.fix === 'the server at B wants a key, which this provider never sends; reach it as openai-compatible with LAWCHECK_REVIEWER_KEY');
    const html = await post(`${url}/html`, {}, {}, 5);
    assert.ok('failure' in html && html.resend === false);
  });
});

test('test 403: a request that cannot be sent names the cause of its failure', async () => {
  assert.deepEqual(await post('http://127.0.0.1:9/v1/chat/completions', {}, {}, 5, { base: 'http://127.0.0.1:9/v1' }), {
    failure: 'http://127.0.0.1:9/v1 names a port that fetch refuses to call (bad port)',
    resend: 'at-once',
    fix: 'start the reviewer at http://127.0.0.1:9/v1, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs',
  });
});

test('test 403: each cause of no answer is a sentence that names the address', () => {
  assert.equal(noAnswer('ECONNREFUSED', 'http://h:1/v1'), 'nothing answers at http://h:1/v1: the connection was refused (ECONNREFUSED)');
  assert.equal(noAnswer('ENOTFOUND', 'http://h:1/v1'), 'the host of http://h:1/v1 is not found (ENOTFOUND)');
  assert.equal(noAnswer('EHOSTUNREACH', 'http://h:1/v1'), 'http://h:1/v1 cannot be reached from this machine (EHOSTUNREACH)');
  assert.equal(noAnswer('ECONNRESET', 'http://h:1/v1'), 'the connection to http://h:1/v1 ended before the reply did (ECONNRESET)');
  assert.equal(noAnswer('EPROTO', 'http://h:1/v1'), 'the connection to http://h:1/v1 gave no answer (EPROTO)');
});

test('test 403: a reply over 4 MiB is not read', async () => {
  await serve((_req, res) => {
    res.end(JSON.stringify({ choices: [{ message: { content: 'x'.repeat(4 * 1024 * 1024) } }] }));
  }, async (url) => {
    assert.deepEqual(await post(`${url}/big`, {}, {}, 5, { base: 'B' }), { failure: 'the reply holds more than 4 MiB, so it is not read', resend: false, fix: "check that B is the address of the provider's API" });
  });
});

test('test 403: what a connection that gave no answer names', () => {
  assert.equal(cause(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:1'), { code: 'ECONNREFUSED' }) })), 'ECONNREFUSED');
  assert.equal(cause(Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('bad port\nmore'), { code: 'bad-port' }) })), 'bad port');
  assert.equal(cause(Object.assign(new TypeError('fetch failed'), { cause: new Error('') })), 'fetch failed');
  assert.equal(cause(new TypeError('the socket closed\nmore')), 'the socket closed');
  assert.equal(cause(new TypeError('')), 'an unknown error');
  assert.equal(cause(Object.assign(new TypeError(''), { cause: {} })), 'an unknown error');
  assert.equal(cause(new Error('x'.repeat(300))), 'x'.repeat(200));
});

test('test 403: no answer: at once for a dropped connection, never after a timeout', async () => {
  await serve((req) => {
    if (req.url === '/drop') req.socket.destroy();
  }, async (url) => {
    const dropped = await post(`${url}/drop`, {}, {}, 5);
    assert.ok('failure' in dropped && dropped.resend === 'at-once');
    const started = Date.now();
    const slow = await post(`${url}/hang`, {}, {}, 1);
    assert.ok('failure' in slow && slow.resend === false && /1 seconds/.test(slow.failure));
    assert.ok(Date.now() - started < 3000);
    const short = Date.now();
    const left = await post(`${url}/hang`, {}, {}, 30, { seconds: 0.3 });
    assert.ok('failure' in left && left.failure === 'the reviewer gave no answer within 30 seconds', JSON.stringify(left));
    assert.ok(Date.now() - short < 2000);
  });
});

test('reviewer-slice §6: post refuses, before any request, an address with a user or a password and a header a request cannot carry, and quotes neither', async () => {
  for (const url of ['http://user:s3cr3t@127.0.0.1:9/v1/chat/completions', 'http://s3cr3t@127.0.0.1:9/v1', 'http://:s3cr3t@127.0.0.1:9/v1']) {
    const failed = await post(url, {}, {}, 5);
    assert.deepEqual(failed, { failure: 'the address of the reviewer holds a user or a password, so no request is sent', resend: false, fix: 'take the user and the password out of the address' }, url);
  }
  for (const value of ['Bearer se\ncret-s3cr3t', 'Bearer se\rcret-s3cr3t', 'Bearer se\tcret-s3cr3t', 'Bearer słcr3t', 'Bearer s\u0001cr3t']) {
    const failed = await post('http://127.0.0.1:9/v1', { authorization: value }, {}, 5);
    assert.deepEqual(failed, { failure: 'a header of the request holds a character a header cannot carry, so no request is sent', resend: false, fix: 'set LAWCHECK_REVIEWER_KEY to the key alone, with no space or line break' }, JSON.stringify(value));
  }
});

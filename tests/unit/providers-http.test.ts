import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { post } from '../../dist/providers/http.js';

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

test('a 2xx JSON body is returned as it came', async () => {
  await serve((req, res) => {
    let text = '';
    req.on('data', (c) => (text += c)).on('end', () => res.end(JSON.stringify({ got: JSON.parse(text), type: req.headers['content-type'], extra: req.headers['x-extra'] })));
  }, async (url) => {
    assert.deepEqual(await post(url, { 'x-extra': 'y' }, { a: 1 }, 5), { body: { got: { a: 1 }, type: 'application/json', extra: 'y' } });
  });
});

test('statuses, a body that is no JSON, a redirect and an error message', async () => {
  await serve((req, res) => {
    if (req.url === '/429') return res.writeHead(429).end();
    if (req.url === '/401') return res.writeHead(401).end(JSON.stringify({ error: { message: 'bad key\nsecond line' } }));
    if (req.url === '/403') return res.writeHead(403).end(JSON.stringify({ error: { message: 'y'.repeat(300) } }));
    if (req.url === '/307') return res.writeHead(307, { location: '/elsewhere' }).end();
    if (req.url === '/html') return res.end('<html></html>');
    res.writeHead(500).end('{}');
  }, async (url) => {
    assert.deepEqual(await post(`${url}/429`, {}, {}, 5), { failure: 'HTTP 429 Too Many Requests', resend: 'after-2s' });
    const denied = await post(`${url}/401`, {}, {}, 5);
    assert.ok('failure' in denied && denied.failure.startsWith('HTTP 401 Unauthorized: bad key') && !denied.failure.includes('second'));
    assert.deepEqual(await post(`${url}/403`, {}, {}, 5), { failure: `HTTP 403 Forbidden: ${'y'.repeat(200)}`, resend: false });
    assert.deepEqual(await post(`${url}/307`, {}, {}, 5), { failure: 'HTTP 307 Temporary Redirect', resend: false });
    assert.deepEqual(await post(`${url}/500`, {}, {}, 5), { failure: 'HTTP 500 Internal Server Error', resend: false });
    const html = await post(`${url}/html`, {}, {}, 5);
    assert.ok('failure' in html && html.resend === false);
  });
});

test('no answer: at once for a dropped connection, never after a timeout', async () => {
  await serve((req) => {
    if (req.url === '/drop') req.socket.destroy();
  }, async (url) => {
    const dropped = await post(`${url}/drop`, {}, {}, 5);
    assert.ok('failure' in dropped && dropped.resend === 'at-once');
    const started = Date.now();
    const slow = await post(`${url}/hang`, {}, {}, 1);
    assert.ok('failure' in slow && slow.resend === false && /1 seconds/.test(slow.failure));
    assert.ok(Date.now() - started < 3000);
  });
});

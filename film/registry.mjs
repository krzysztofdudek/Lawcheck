import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';

const UPSTREAM = 'https://registry.npmjs.org';

// An npm registry on this machine for a recording: it answers for lawcheck with the packed candidate under the tags alpha and latest,
// so that the command a reader types after the release installs, in the recording, the build that becomes that release; every other package comes from npm.
export function serveCandidate(pack, port) {
  const manifest = JSON.parse(spawnSync('tar', ['-xzOf', pack, 'package/package.json'], { encoding: 'utf8' }).stdout);
  const bytes = readFileSync(pack);
  const file = `lawcheck-${manifest.version}.tgz`;
  const tarball = `http://127.0.0.1:${port}/lawcheck/-/${file}`;
  const packument = {
    name: 'lawcheck',
    'dist-tags': { alpha: manifest.version, latest: manifest.version },
    versions: {
      [manifest.version]: {
        ...manifest,
        _id: `lawcheck@${manifest.version}`,
        dist: { tarball, shasum: createHash('sha1').update(bytes).digest('hex'), integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}` },
      },
    },
  };
  const server = createServer(async (request, response) => {
    const path = decodeURIComponent(request.url.split('?')[0]);
    if (path === '/lawcheck') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(packument));
      return;
    }
    if (path === `/lawcheck/-/${file}`) {
      response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': bytes.length });
      response.end(bytes);
      return;
    }
    try {
      const answer = await fetch(`${UPSTREAM}${request.url}`, { headers: { accept: request.headers.accept ?? 'application/json' } });
      response.writeHead(answer.status, { 'content-type': answer.headers.get('content-type') ?? 'application/json' });
      response.end(Buffer.from(await answer.arrayBuffer()));
    } catch (error) {
      response.writeHead(502);
      response.end(String(error));
    }
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${port}/`, version: manifest.version, close: () => server.close() })));
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [pack, port] = process.argv.slice(2);
  const served = await serveCandidate(pack, Number(port));
  process.stdout.write(`${served.url} ${served.version}\n`);
}

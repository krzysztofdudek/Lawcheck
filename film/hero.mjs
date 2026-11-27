import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { css } from '../brand/css.mjs';

// The hero is laid out at LAYOUT css pixels, wide enough for its desktop layout, and drawn at WIDTH device pixels, so the GIF needs no scaling and its text stays sharp.
export const GIF = { width: 800, layout: 840, fps: 20, limitBytes: 8 * 1000 * 1000 };

const FONTS = {
  inter: 'site/node_modules/vitepress/dist/client/theme-default/fonts/inter-roman-latin.woff2',
  mono: 'site/node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
};

export function heroPage(root) {
  for (const path of Object.values(FONTS)) if (!existsSync(join(root, path))) throw new Error(`${path} is missing: npm --prefix site ci installs the fonts of the site`);
  const tokens = JSON.parse(readFileSync(join(root, 'brand', 'tokens.json'), 'utf8'));
  const style = [
    `@font-face { font-family: "Inter"; font-weight: 100 900; src: url("/fonts/inter.woff2") format("woff2"); }`,
    `@font-face { font-family: "JetBrains Mono"; font-weight: 100 800; src: url("/fonts/mono.woff2") format("woff2"); }`,
    css(tokens),
    '*, *::before, *::after { box-sizing: border-box; }',
    'body { margin: 0; background: var(--lc-ground); }',
    readFileSync(join(root, 'site', 'landing', 'hero', 'hero.css'), 'utf8'),
  ].join('\n');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Lawcheck hero</title>
<style>
${style}
</style>
</head>
<body>
<section class="hero" aria-label="What Lawcheck does"></section>
<script type="module">
import { hero, startHero } from '/hero.mjs';
const mark = await (await fetch('/mark.svg')).text();
const model = hero(mark.trim().replace('<svg xmlns="http://www.w3.org/2000/svg" ', '<svg aria-hidden="true" '), { docs: 'https://docs.lawcheck.dev/', github: 'https://github.com/krzysztofdudek/Lawcheck' });
const root = document.querySelector('.hero');
root.innerHTML = model.markup();
startHero(root, model, new URLSearchParams(location.search));
await document.fonts.ready;
window.heroReady = true;
</script>
</body>
</html>
`;
}

function serve(root) {
  const files = {
    '/': [() => heroPage(root), 'text/html'],
    '/hero.mjs': [() => readFileSync(join(root, 'site', 'landing', 'hero', 'hero.mjs')), 'text/javascript'],
    '/mark.svg': [() => readFileSync(join(root, 'brand', 'mark.svg')), 'image/svg+xml'],
    '/fonts/inter.woff2': [() => readFileSync(join(root, FONTS.inter)), 'font/woff2'],
    '/fonts/mono.woff2': [() => readFileSync(join(root, FONTS.mono)), 'font/woff2'],
  };
  const server = createServer((request, response) => {
    const file = files[new URL(request.url, 'http://x').pathname];
    if (!file) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, { 'content-type': file[1] });
    response.end(file[0]());
  });
  return new Promise((done) => server.listen(0, '127.0.0.1', () => done(server)));
}

async function devtools(chromium, profile) {
  const browser = spawn(chromium, ['--headless=new', '--no-sandbox', '--disable-gpu', '--hide-scrollbars', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], { stdio: 'ignore' });
  const portFile = join(profile, 'DevToolsActivePort');
  for (let waited = 0; !existsSync(portFile) || readFileSync(portFile, 'utf8').split('\n').length < 2; waited += 50) {
    if (waited > 20000) throw new Error(`${chromium} gave no DevTools port in 20 seconds`);
    await new Promise((done) => setTimeout(done, 50));
  }
  const [port, path] = readFileSync(portFile, 'utf8').split('\n');
  const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`);
  await new Promise((done, fail) => {
    socket.onopen = done;
    socket.onerror = () => fail(new Error('the DevTools connection of Chromium failed'));
  });
  let next = 0;
  const waiting = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const call = waiting.get(message.id);
    if (!call) return;
    waiting.delete(message.id);
    if (message.error) call.fail(new Error(`${call.method}: ${message.error.message}`));
    else call.done(message.result);
  };
  const send = (method, params = {}, sessionId = undefined) =>
    new Promise((done, fail) => {
      const id = ++next;
      waiting.set(id, { done, fail, method });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
  return { send, close: () => (socket.close(), browser.kill()) };
}

// Renders every frame of the hero, seeking it to each time, and encodes them to one GIF with a palette made from all frames.
export async function renderHeroGif(root, out, { chromium = process.env.HYPERFRAMES_BROWSER_PATH ?? 'chromium', ffmpeg = 'ffmpeg', gif = GIF } = {}) {
  const work = mkdtempSync(join(tmpdir(), 'lawcheck-hero-'));
  const server = await serve(root);
  const browser = await devtools(chromium, join(work, 'profile'));
  try {
    const { targetId } = await browser.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await browser.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => browser.send(method, params, sessionId);
    const scale = gif.width / gif.layout;
    const metrics = (height) => page('Emulation.setDeviceMetricsOverride', { width: gif.layout, height, deviceScaleFactor: scale, mobile: false });
    const value = async (expression) => (await page('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })).result.value;
    await metrics(1000);
    await page('Page.navigate', { url: `http://127.0.0.1:${server.address().port}/?embed&t=0` });
    for (let waited = 0; (await value('window.heroReady === true')) !== true; waited += 100) {
      if (waited > 20000) throw new Error('the hero did not start in 20 seconds');
      await new Promise((done) => setTimeout(done, 100));
    }
    const height = Math.ceil((await value('window.heroTallest()')) / 2) * 2;
    await metrics(height);
    const length = await value('window.heroLength');
    const frames = join(work, 'frames');
    mkdirSync(frames);
    const count = Math.round(length * gif.fps);
    for (let at = 0; at < count; at++) {
      await value(`window.heroSeek(${at / gif.fps})`);
      const { data } = await page('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
      writeFileSync(join(frames, `${String(at).padStart(5, '0')}.png`), Buffer.from(data, 'base64'));
    }
    mkdirSync(out, { recursive: true });
    const file = join(out, 'hero.gif');
    const encoded = spawnSync(ffmpeg, ['-v', 'error', '-y', '-framerate', String(gif.fps), '-i', join(frames, '%05d.png'), '-lavfi', 'split[a][b];[a]palettegen=max_colors=256:stats_mode=full[p];[b][p]paletteuse=dither=none', '-loop', '0', file], { stdio: 'inherit' });
    if (encoded.status !== 0) throw new Error(`${ffmpeg} ended with ${encoded.status ?? encoded.signal}`);
    const size = statSync(file).size;
    if (size > gif.limitBytes) throw new Error(`${file} is ${size} bytes, over ${gif.limitBytes}: lower the frame rate in GIF of film/hero.mjs`);
    return { file, seconds: Math.round(length * 10) / 10, size, width: gif.width, height: Math.round(height * scale), frames: count };
  } finally {
    browser.close();
    server.close();
    rmSync(work, { recursive: true, force: true });
  }
}

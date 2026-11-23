import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from './build.mjs';
import { FILM, readEdit, ROOT } from './edit.mjs';

// The release of HyperFrames this film was built and checked with.
const HYPERFRAMES = ['npx', '--yes', 'hyperframes@0.9.85'];
const GIF = { width: 1200, fps: 12, limitBytes: 5 * 1000 * 1000 };
const SHADES = 7;
const SURFACES = ['ground', 'surface', 'code'];

function fail(message) {
  process.stderr.write(`film/render.mjs: ${message}\n`);
  process.exit(2);
}

function run(command, args, cwd) {
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', env: { ...process.env, HYPERFRAMES_NO_TELEMETRY: '1' } });
  if (result.status !== 0) fail(`${command} ${args.join(' ')} ended with ${result.status ?? result.signal}`);
}

const channels = (hex) => [1, 3, 5].map((at) => parseInt(hex.slice(at, at + 2), 16));

export function palette(tokens) {
  const dusk = tokens.colors.dusk;
  const colors = new Map(Object.values(dusk).map((hex) => [hex.toLowerCase(), channels(hex)]));
  for (const role of Object.keys(dusk).filter((name) => !SURFACES.includes(name))) {
    for (const surface of SURFACES) {
      const [front, back] = [channels(dusk[role]), channels(dusk[surface])];
      for (let step = 1; step <= SHADES; step++) {
        const mix = front.map((value, index) => Math.round(back[index] + ((value - back[index]) * step) / (SHADES + 1)));
        colors.set(mix.join(','), mix);
      }
    }
  }
  const all = [...colors.values()].slice(0, 256);
  while (all.length < 256) all.push(all[0]);
  return Buffer.concat([Buffer.from('P6\n16 16\n255\n'), Buffer.from(all.flat())]);
}

export function render(out, quality) {
  const edit = readEdit(ROOT);
  const tokens = JSON.parse(readFileSync(join(ROOT, 'brand', 'tokens.json'), 'utf8'));
  const cli = process.env.HYPERFRAMES_CLI?.split(' ') ?? HYPERFRAMES;
  run(process.execPath, [join(FILM, 'check.mjs')], ROOT);
  mkdirSync(out, { recursive: true });
  const [loop] = build(join(FILM, 'dist'), ROOT).filter((made) => made.name === 'loop');
  const mp4 = join(out, 'loop.mp4');
  const webm = join(out, 'loop.webm');
  const gif = join(out, 'loop.gif');
  run(cli[0], [...cli.slice(1), 'render', '--quality', quality, '--fps', String(edit.frame.fps), '-o', mp4], loop.project);
  run(cli[0], [...cli.slice(1), 'render', '--quality', quality, '--fps', String(edit.frame.fps), '--format', 'webm', '-o', webm], loop.project);
  const colors = join(FILM, 'dist', 'palette.ppm');
  writeFileSync(colors, palette(tokens));
  run('ffmpeg', ['-v', 'error', '-y', '-i', mp4, '-i', colors, '-lavfi', `fps=${GIF.fps},scale=${GIF.width}:-1:flags=lanczos[frames];[frames][1:v]paletteuse=dither=none`, '-loop', '0', gif], out);
  const size = statSync(gif).size;
  if (size > GIF.limitBytes) fail(`${gif} is ${size} bytes, over ${GIF.limitBytes}`);
  return { mp4, webm, gif, seconds: loop.seconds, size };
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const quality = args.includes('--draft') ? 'draft' : 'delivery';
  if (at < 0 || args[at + 1] === undefined || args.some((arg, index) => arg.startsWith('--') && arg !== '--out' && arg !== '--draft' && index !== at + 1)) fail('usage: node film/render.mjs --out <folder outside the repository> [--draft]');
  const made = render(resolve(args[at + 1]), quality);
  process.stdout.write(`film/render.mjs: the loop of ${made.seconds} s in ${made.mp4}, ${made.webm} and ${made.gif} (${(made.size / 1e6).toFixed(2)} MB)\n`);
}

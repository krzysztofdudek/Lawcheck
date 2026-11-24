import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
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

const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function renderLoop(loop, out, quality, edit, tokens, cli) {
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
  return { name: 'loop', files: [mp4, webm, gif], seconds: loop.seconds, size };
}

// A chapter is a video, its subtitles and a still for the moment before it plays; the still is the middle of its first screen.
function renderChapter(chapter, out, quality, edit, cli) {
  const mp4 = join(out, `${chapter.name}.mp4`);
  const vtt = join(out, `${chapter.name}.vtt`);
  const poster = join(out, `${chapter.name}.jpg`);
  run(cli[0], [...cli.slice(1), 'render', '--quality', quality, '--fps', String(edit.frame.fps), '-o', mp4], chapter.project);
  copyFileSync(join(chapter.project, `${chapter.name}.vtt`), vtt);
  const timeline = edit.chapters.find((entry) => entry.page === chapter.name).timeline;
  const first = timeline[0].screens.length > 1 ? timeline[0].start + timeline[0].screens[1].at : timeline[0].end;
  run('ffmpeg', ['-v', 'error', '-y', '-ss', String(first / 2), '-i', mp4, '-frames:v', '1', '-q:v', '3', poster], out);
  return { name: chapter.name, files: [mp4, vtt, poster], seconds: chapter.seconds };
}

export function render(out, quality, only = ['loop', 'chapters'], voice = undefined) {
  const edit = readEdit(ROOT);
  const chapters = (edit.chapters ?? []).filter((chapter) => only.includes('chapters') || only.includes(chapter.page));
  if (voice === undefined && chapters.some((chapter) => chapter.timeline.some((segment) => (segment.narration ?? []).length > 0))) fail('the chapters are narrated: node film/voice.mjs --out <folder> speaks the narration, and --voice <folder> mixes it in');
  const tokens = JSON.parse(readFileSync(join(ROOT, 'brand', 'tokens.json'), 'utf8'));
  const cli = process.env.HYPERFRAMES_CLI?.split(' ') ?? HYPERFRAMES;
  run(process.execPath, [join(FILM, 'check.mjs')], ROOT);
  mkdirSync(out, { recursive: true });
  let projects;
  try {
    projects = build(join(FILM, 'dist'), ROOT, voice, chapters.map((chapter) => chapter.page));
  } catch (error) {
    fail(error.message);
  }
  const made = [];
  for (const project of projects) {
    if (project.chapter ? only.includes('chapters') || only.includes(project.name) : only.includes('loop')) {
      made.push(project.chapter ? renderChapter(project, out, quality, edit, cli) : renderLoop(project, out, quality, edit, tokens, cli));
    }
  }
  const rendered = made.filter((item) => item.name !== 'loop').map((item) => ({
    page: item.name,
    number: edit.chapters.findIndex((chapter) => chapter.page === item.name) + 1,
    seconds: item.seconds,
    transcript: edit.chapters.find((chapter) => chapter.page === item.name).timeline.flatMap((segment) => (segment.narration ?? []).map((line) => line.text)),
    files: Object.fromEntries(item.files.map((path) => [path.split('.').pop(), { name: path.split('/').pop(), sha256: sha256(path), bytes: statSync(path).size }])),
  }));
  if (rendered.length > 0) writeFileSync(join(out, 'chapters.json'), `${JSON.stringify({ chapters: rendered }, null, 2)}\n`);
  return made;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const at = args.indexOf('--out');
  const pick = args.indexOf('--only');
  const sound = args.indexOf('--voice');
  const quality = args.includes('--draft') ? 'draft' : 'delivery';
  const known = new Set(['--out', '--draft', '--only', '--voice']);
  if (at < 0 || args[at + 1] === undefined || (pick >= 0 && args[pick + 1] === undefined) || (sound >= 0 && args[sound + 1] === undefined) || args.some((arg, index) => arg.startsWith('--') && !known.has(arg) && index !== at + 1 && index !== pick + 1 && index !== sound + 1)) fail('usage: node film/render.mjs --out <folder outside the repository> [--draft] [--only loop|chapters|<page>,...] [--voice <folder that film/voice.mjs wrote>]');
  const only = pick >= 0 ? args[pick + 1].split(',') : ['loop', 'chapters'];
  for (const made of render(resolve(args[at + 1]), quality, only, sound >= 0 ? resolve(args[sound + 1]) : undefined)) {
    process.stdout.write(`film/render.mjs: ${made.name === 'loop' ? 'the loop' : `the chapter ${made.name}`} of ${made.seconds} s in ${made.files.join(', ')}${made.size === undefined ? '' : ` (${(made.size / 1e6).toFixed(2)} MB)`}\n`);
  }
}

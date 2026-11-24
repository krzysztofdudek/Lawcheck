import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { css } from '../brand/css.mjs';
import { FILM, lengthOf, piecesOf, readEdit, ROOT, screensOf, timelinesOf } from './edit.mjs';
import { sentenceSpans, voiceClips, voiceProblems, wavSeconds, windowOf } from './voice.mjs';
const GSAP = 'https://cdn.jsdelivr.net/npm/gsap@3.15.0/dist/gsap.min.js';

const escape = (text) => text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
const kebab = (name) => name.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

function codeFlags(text) {
  const flags = [];
  let inside = false;
  for (const char of text) {
    if (char === '`') inside = !inside;
    else flags.push(inside);
  }
  return flags;
}

function styled(piece, flags, start) {
  let out = '';
  let i = 0;
  while (i < piece.length) {
    const code = flags[start + i] === true;
    let j = i;
    while (j < piece.length && (flags[start + j] === true) === code) j++;
    const part = escape(piece.slice(i, j));
    out += code ? `<span class="code-span">${part}</span>` : part;
    i = j;
  }
  return out;
}

function rowsOf(block, line, columns, tokens) {
  if (line.more) return ['<div class="row more">⋯</div>'];
  const prefix = line.prompt ? '$ ' : '';
  const flags = [...prefix].map(() => false).concat(codeFlags(line.text));
  const whole = `${prefix}${line.text.replaceAll('`', '')}`;
  const numbered = block.lines.some((other) => other.number !== undefined);
  const color = line.color === undefined ? '' : ` style="color: var(--lc-${kebab(tokens.terminal[line.color])})"`;
  let at = 0;
  return piecesOf(block, line, columns).map((piece, index) => {
    const start = whole.indexOf(piece, at);
    at = start + piece.length;
    const gutter = numbered ? `<span class="gutter">${index === 0 && line.number !== undefined ? line.number : ''}</span>` : '';
    const body = line.prompt && index === 0 ? `<span class="prompt">$ </span>${styled(piece.slice(2), flags, start + 2)}` : styled(piece, flags, start);
    return `<div class="row"${color}>${gutter}${body}</div>`;
  });
}

function blockHtml(block, id, columns, tokens, mark) {
  if (block.kind === 'lockup') return `<div class="lockup" id="${id}">${mark}<span>Lawcheck</span></div>`;
  if (block.kind === 'card') {
    const small = block.small === undefined ? '' : `<p class="small">${escape(block.small.text)}</p>`;
    return `<div class="card" id="${id}"><div class="bar"></div>${block.lines.map((line) => `<p class="main">${escape(line.text)}</p>`).join('')}${small}</div>`;
  }
  const label = block.label === undefined ? '' : `<p class="label"><span class="tick">▮</span>${escape(typeof block.label === 'string' ? block.label : block.label.text)}</p>`;
  const rows = block.lines.map((line, index) => {
    const inner = rowsOf(block, line, columns, tokens).join('');
    return line.mark ? `<div class="marked">${inner}<div class="outline"></div></div>` : inner;
  });
  return `<div class="block ${block.kind}" id="${id}">${label}${rows.join('')}</div>`;
}

function sceneHtml(screen, edit, tokens, mark) {
  const id = screen.id;
  const blocks = screen.screen.blocks.map((block, index) => blockHtml(block, `${id}-b${index + 1}`, edit.frame.columns, tokens, mark));
  return `<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }
  </style>
  <div id="root" data-composition-id="${id}" data-width="${edit.frame.width}" data-height="${edit.frame.height}">
    <div class="stage" data-hold="true">
      ${blocks.join('\n      ')}
    </div>
  </div>
  <script>
    window.__timelines["${id}"] = gsap.timeline({ paused: true });
  </script>
</template>
`;
}

function captionsHtml(timeline, edit) {
  const captions = timeline.filter((segment) => segment.caption !== undefined);
  const clips = captions.map((segment) => `<p id="cap-${segment.id}" class="clip caption" data-start="${segment.start}" data-duration="${(segment.end - segment.start).toFixed(2)}" data-track-index="2">${escape(segment.caption)}</p>`);
  return `<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }
  </style>
  <div id="root" data-composition-id="captions" data-width="${edit.frame.width}" data-height="${edit.frame.height}">
    ${clips.join('\n    ')}
  </div>
  <script>
    window.__timelines["captions"] = gsap.timeline({ paused: true });
  </script>
</template>
`;
}

function cornerHtml(edit, mark) {
  return `<template>
  <style>
    #root {
      position: absolute;
      inset: 0;
    }
  </style>
  <div id="root" data-composition-id="corner" data-width="${edit.frame.width}" data-height="${edit.frame.height}">
    ${mark.replace('<svg ', '<svg class="corner" ')}
  </div>
  <script>
    window.__timelines["corner"] = gsap.timeline({ paused: true });
  </script>
</template>
`;
}

function stamp(seconds) {
  const millis = Math.round(seconds * 1000);
  const part = (value, size) => String(value).padStart(size, '0');
  return `${part(Math.floor(millis / 3600000), 2)}:${part(Math.floor(millis / 60000) % 60, 2)}:${part(Math.floor(millis / 1000) % 60, 2)}.${part(millis % 1000, 3)}`;
}

export function vttOf(segments) {
  const cues = segments.filter((segment) => segment.subtitle !== undefined).map((segment) => `${stamp(segment.start)} --> ${stamp(segment.end)}\n${segment.subtitle}\n`);
  return `WEBVTT\n\n${cues.join('\n')}`;
}

// The subtitles are the narrated sentences themselves. With the voice, each cue runs where its sentence is spoken; without it, or when the file does not split into its sentences, the frame's room for the voice is shared by the length of the sentences.
export function cuesOf(edit, chapter, voice) {
  const cues = [];
  for (const segment of chapter.timeline) {
    const sentences = (segment.narration ?? []).map((line) => line.text);
    if (sentences.length === 0) continue;
    const lead = segment.start + edit.voice.lead;
    let spans;
    let room = windowOf(edit, segment);
    if (voice !== undefined) {
      const buffer = readFileSync(join(voice, chapter.page, `${segment.id}.wav`));
      spans = sentenceSpans(buffer, sentences.length, edit.voice.pause);
      room = wavSeconds(buffer);
    }
    const total = sentences.reduce((sum, text) => sum + text.length, 0);
    let used = 0;
    sentences.forEach((text, index) => {
      const share = spans?.[index] ?? { start: (used / total) * room, end: ((used + text.length) / total) * room };
      used += text.length;
      cues.push({ start: lead + share.start, end: lead + share.end, subtitle: text });
    });
  }
  return cues;
}

function indexHtml(name, screens, edit, seconds, style, chapter, clips) {
  const frame = `data-width="${edit.frame.width}" data-height="${edit.frame.height}"`;
  const hosts = screens.map((screen) => `<div id="${screen.id}" data-composition-id="${screen.id}" data-composition-src="compositions/${screen.id}.html" data-start="${screen.start}" data-duration="${(screen.end - screen.start).toFixed(2)}" data-track-index="1" data-track-kind="graphics" ${frame}></div>`);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=${edit.frame.width}, height=${edit.frame.height}" />
    <title>Lawcheck ${name}</title>
    <script src="${GSAP}"></script>
    <style>
${style}
    </style>
  </head>
  <body${chapter ? ' class="chapter"' : ''}>
    <div id="root" data-composition-id="main" data-start="0" data-duration="${seconds}" ${frame}>
      <div class="ground"></div>
      ${hosts.join('\n      ')}
      <div id="captions" data-composition-id="captions" data-composition-src="compositions/captions.html" data-start="0" data-duration="${seconds}" data-track-index="2" data-track-kind="captions" ${frame}></div>
      <div id="corner" data-composition-id="corner" data-composition-src="compositions/corner.html" data-start="0" data-duration="${seconds}" data-track-index="3" data-track-kind="graphics" ${frame}></div>
${clips.map((clip) => `      <audio id="voice-${clip.id}" class="clip" src="assets/voice/${clip.id}.wav" data-start="${clip.start}" data-duration="${clip.seconds.toFixed(2)}" data-track-index="4" data-volume="1"></audio>\n`).join('')}    </div>
    <script>
      window.__timelines["main"] = gsap.timeline({ paused: true });
    </script>
  </body>
</html>
`;
}

export function build(out, root = ROOT, voice = undefined) {
  const edit = readEdit(root);
  if (voice !== undefined) {
    const problems = voiceProblems(edit, voice);
    if (problems.length > 0) throw new Error(problems.join('\n'));
  }
  const tokens = JSON.parse(readFileSync(join(root, 'brand', 'tokens.json'), 'utf8'));
  const mark = readFileSync(join(root, 'brand', 'mark.svg'), 'utf8').trim();
  const style = `${css(tokens)}\n${readFileSync(join(FILM, 'hyperframes', 'film.css'), 'utf8')}`.split('\n').map((line) => (line === '' ? '' : `      ${line}`)).join('\n');
  rmSync(out, { recursive: true, force: true });
  const made = [];
  for (const timeline of timelinesOf(edit)) {
    const name = timeline.name;
    const project = join(out, name);
    mkdirSync(join(project, 'compositions'), { recursive: true });
    const screens = screensOf(timeline.segments);
    for (const screen of screens) writeFileSync(join(project, 'compositions', `${screen.id}.html`), sceneHtml(screen, edit, tokens, mark));
    writeFileSync(join(project, 'compositions', 'captions.html'), captionsHtml(timeline.segments, edit));
    writeFileSync(join(project, 'compositions', 'corner.html'), cornerHtml(edit, mark));
    const clips = voice === undefined || timeline.chapter === undefined ? [] : voiceClips(edit, name, voice);
    if (clips.length > 0) mkdirSync(join(project, 'assets', 'voice'), { recursive: true });
    for (const clip of clips) cpSync(clip.file, join(project, 'assets', 'voice', `${clip.id}.wav`));
    writeFileSync(join(project, 'index.html'), indexHtml(name, screens, edit, lengthOf(timeline.segments), style, timeline.chapter !== undefined, clips));
    if (timeline.chapter !== undefined) writeFileSync(join(project, `${name}.vtt`), vttOf(cuesOf(edit, timeline.chapter, voice)));
    cpSync(join(FILM, 'hyperframes', 'SPEC.md'), join(project, 'SPEC.md'));
    made.push({ name, project, seconds: lengthOf(timeline.segments), screens: screens.length, chapter: timeline.chapter !== undefined, voiced: clips.length });
  }
  return made;
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === process.argv[1]) {
  const args = process.argv.slice(2);
  const value = (flag) => (args.includes(flag) ? args[args.indexOf(flag) + 1] : undefined);
  if (args.length % 2 !== 0 || args.some((arg, index) => index % 2 === 0 && arg !== '--out' && arg !== '--voice') || args.some((arg, index) => index % 2 === 1 && arg.startsWith('--'))) {
    process.stderr.write('usage: node film/build.mjs [--out <folder>] [--voice <folder that film/voice.mjs wrote>]\n');
    process.exit(2);
  }
  const out = resolve(value('--out') ?? join(FILM, 'dist'));
  const voice = value('--voice') === undefined ? undefined : resolve(value('--voice'));
  for (const made of build(out, ROOT, voice)) process.stdout.write(`film/build.mjs: ${made.name}: ${made.screens} screens, ${made.seconds} s${made.voiced > 0 ? `, ${made.voiced} narrated frames` : ''}, in ${made.project}\n`);
}

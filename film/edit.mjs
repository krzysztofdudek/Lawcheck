import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const FILM = dirname(fileURLToPath(import.meta.url));
export const ROOT = dirname(FILM);

export function readEdit(root = ROOT) {
  return JSON.parse(readFileSync(join(root, 'film', 'edit.json'), 'utf8'));
}

export function plain(text) {
  return text.replaceAll('`', '');
}

export function wrap(text, columns) {
  const pieces = [];
  let rest = text;
  while (rest.length > columns) {
    const wide = rest.lastIndexOf('  ', columns);
    let cut = wide >= columns / 2 ? wide : rest.lastIndexOf(' ', columns);
    while (cut > 0 && rest[cut - 1] === ' ') cut--;
    if (cut < columns / 4) cut = columns;
    pieces.push(rest.slice(0, cut));
    rest = rest.slice(cut).replace(/^ +/, '');
  }
  pieces.push(rest);
  return pieces;
}

export function words(text) {
  return (text.toLowerCase().replaceAll('ℹ', ' ').match(/[\p{L}\p{N}]+(?:'[\p{L}\p{N}]+)*/gu) ?? []);
}

export function stringsOf(block) {
  if (block.kind === 'lockup') return ['Lawcheck'];
  const strings = [];
  if (typeof block.label === 'string') strings.push(block.label);
  else if (block.label !== undefined) strings.push(block.label.text);
  for (const line of block.lines ?? []) {
    if (line.more) continue;
    if (line.number !== undefined) strings.push(String(line.number));
    strings.push(plain(line.text));
  }
  if (block.small !== undefined) strings.push(block.small.text);
  return strings;
}

export function screensOf(timeline) {
  const screens = [];
  for (const segment of timeline) {
    segment.screens.forEach((screen, index) => {
      const start = segment.start + screen.at;
      const end = index + 1 < segment.screens.length ? segment.start + segment.screens[index + 1].at : segment.end;
      const text = [...screen.blocks.flatMap(stringsOf), ...(segment.caption ? [segment.caption] : []), ...(segment.subtitle ? [segment.subtitle] : [])];
      screens.push({ id: `${segment.id}-${index + 1}`, segment, screen, start, end, text });
    });
  }
  return screens;
}

export function timelinesOf(edit) {
  return [{ name: 'loop', segments: edit.loop }, ...(edit.chapters ?? []).map((chapter) => ({ name: chapter.page, segments: chapter.timeline, chapter }))];
}

export function lengthOf(timeline) {
  return timeline.length === 0 ? 0 : timeline[timeline.length - 1].end;
}

export const GUTTER = 3;

export function widthOf(block, columns) {
  return block.kind === 'file' && block.lines.some((line) => line.number !== undefined) ? columns - GUTTER : columns;
}

export function piecesOf(block, line, columns) {
  return wrap(plain(`${line.prompt ? '$ ' : ''}${line.text}`), widthOf(block, columns));
}

const COLORS = ['black', 'red', 'green', 'yellow', 'blue', 'magenta', 'cyan', 'white'];

export function decodeTerminal(jsonl) {
  const [, ...events] = jsonl.split('\n').filter((line) => line !== '');
  const stream = events.map((line) => JSON.parse(line)[1]).join('').replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '');
  const lines = [];
  let line = [];
  let color = null;
  for (let i = 0; i < stream.length; i++) {
    const char = stream[i];
    if (char === '\x1b') {
      const csi = /^\x1b\[([0-9;?]*)([@-~])/.exec(stream.slice(i, i + 32));
      if (csi === null) {
        i += 1;
        continue;
      }
      if (csi[2] === 'm') {
        for (const code of (csi[1] === '' ? '0' : csi[1]).split(';').map(Number)) {
          if (code === 0 || code === 39) color = null;
          else if (code >= 30 && code <= 37) color = COLORS[code - 30];
          else if (code >= 90 && code <= 97) color = COLORS[code - 90];
        }
      }
      i += csi[0].length - 1;
    } else if (char === '\n') {
      lines.push(line);
      line = [];
    } else if (char === '\r') {
      if (stream[i + 1] !== '\n') line = [];
    } else if (char === '\b') line.pop();
    else if (char >= ' ') line.push({ char, color });
  }
  lines.push(line);
  return lines.map((cells) => ({ text: cells.map((cell) => cell.char).join(''), colors: cells.map((cell) => cell.color) }));
}

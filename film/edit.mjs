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
      const text = [...screen.blocks.flatMap(stringsOf), ...(segment.caption ? [segment.caption] : [])];
      screens.push({ id: `${segment.id}-${index + 1}`, segment, screen, start, end, text });
    });
  }
  return screens;
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

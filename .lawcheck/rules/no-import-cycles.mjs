import { existsSync, readFileSync } from 'node:fs';
import { posix } from 'node:path';
import { importsOf, isOutside } from './lib/code.mjs';

const texts = new Map();

function valueImports(path, text) {
  const out = [];
  for (const found of importsOf(text)) {
    if (found.typeOnly || isOutside(found.module)) continue;
    const joined = posix.join(posix.dirname(path), found.module);
    const target = [joined, joined.replace(/\.js$/, '.ts'), joined.replace(/\.mjs$/, '.mts')].find((candidate) => existsSync(candidate));
    if (target !== undefined) out.push({ line: found.line, target });
  }
  return out;
}

function importsFrom(path) {
  if (!texts.has(path)) texts.set(path, valueImports(path, readFileSync(path, 'utf8')));
  return texts.get(path);
}

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    for (const first of valueImports(file.path, file.text)) {
      const seen = new Set([first.target]);
      const queue = [[first.target]];
      let back = null;
      while (queue.length > 0 && back === null) {
        const trail = queue.shift();
        for (const next of importsFrom(trail[trail.length - 1])) {
          if (next.target === file.path) {
            back = trail;
            break;
          }
          if (seen.has(next.target)) continue;
          seen.add(next.target);
          queue.push([...trail, next.target]);
        }
      }
      if (back !== null) findings.push({ line: first.line, message: `imports ${back.join(', which imports ')}, which imports this file back; move what both need into a module that imports neither` });
    }
  }
  return findings;
}

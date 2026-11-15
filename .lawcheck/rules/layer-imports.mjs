import { importsOf, isOutside } from './lib/code.mjs';

const NODE = 'node:*';
const ROWS = {
  source: [],
  cli: ['node:fs', 'node:path', 'node:url'],
  'rule-runner': ['node:url'],
  guard: ['node:fs'],
  core: ['yaml', 'node:crypto'],
  output: [],
  adapters: [NODE],
  'own-files': [NODE],
  processes: [NODE],
  providers: ['node:fs', 'node:os', 'node:path'],
  steps: ['node:path', 'node:timers/promises'],
  commands: ['node:path'],
  plugin: [NODE],
  'plugin-entry': [NODE],
  'build-scripts': [NODE, '@chrisdudek/runes/grammars'],
  'law-rules': ['node:fs', 'node:path'],
};
const SOURCE = ['source', 'cli', 'rule-runner', 'guard', 'core', 'output', 'adapters', 'own-files', 'processes', 'providers', 'steps', 'commands'];
const ONE_DOOR = {
  'node:child_process': 'src/adapters/processes.ts',
  'node:worker_threads': null,
  'node:cluster': null,
  'node:process': null,
  'node:console': null,
  '@chrisdudek/runes/': 'src/adapters/readers.ts',
  'web-tree-sitter': 'src/adapters/readers.ts',
};

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    const row = ROWS[file.type];
    if (row === undefined) {
      findings.push({ message: `the type ${file.type} has no row in .lawcheck/rules/layer-imports.mjs; add one that names what it may import from outside` });
      continue;
    }
    for (const found of importsOf(file.text)) {
      if (!isOutside(found.module)) continue;
      const door = SOURCE.includes(file.type) ? Object.keys(ONE_DOOR).find((name) => found.module === name || (name.endsWith('/') && found.module.startsWith(name))) : undefined;
      if (door !== undefined) {
        const home = ONE_DOOR[door];
        if (home !== file.path) findings.push({ line: found.line, message: `imports ${found.module}${found.typeOnly ? ' for a type' : ''}; ${home === null ? 'no module of src does' : `only ${home} does, so go through it`}` });
        continue;
      }
      const allowed = row.includes(found.module) || (row.includes(NODE) && found.module.startsWith('node:'));
      if (!allowed) findings.push({ line: found.line, message: `imports ${found.module}, which ${file.type} may not; it may import from outside: ${row.length === 0 ? 'nothing' : row.join(', ')}` });
    }
  }
  return findings;
}

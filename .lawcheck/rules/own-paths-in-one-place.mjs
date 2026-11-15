import { bare } from './lib/code.mjs';

const HOME = 'src/adapters/package.ts';
const ALSO = ['cli', 'own-files'];

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    if (ALSO.includes(file.type)) continue;
    file.lines.forEach((text, index) => {
      if (/(?<![\w$.])import\s*\.\s*meta(?![\w$])/.test(bare(text))) findings.push({ line: index + 1, message: `reads import.meta; ${HOME} computes every path into Lawcheck's own folder, so ask it` });
    });
  }
  return findings;
}

import { bare } from './lib/code.mjs';

const PROGRAMS = ['cli', 'rule-runner', 'guard', 'plugin-entry'];
const MEMBERS = /(?:(?<![\w$.])|(?<=\.\.\.))process\s*\??\.\s*(stdout|stderr|stdin|argv|exit|exitCode|cwd|chdir|env|on|once|off|send)(?![\w$])/g;
const CONSOLE = /(?<![\w$.])console\s*\??\.\s*\w+/;

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    if (PROGRAMS.includes(file.type)) continue;
    file.lines.forEach((text, index) => {
      const code = bare(text);
      for (const match of code.matchAll(MEMBERS)) {
        const fix = match[1] === 'env' || match[1] === 'cwd' || match[1] === 'argv' ? 'take it from the context the program passes' : match[1] === 'stdout' || match[1] === 'stderr' ? "return the text in the command's result" : 'leave it to src/cli.ts';
        findings.push({ line: index + 1, message: `uses process.${match[1]} outside the programs; ${fix}` });
      }
      if (CONSOLE.test(code)) findings.push({ line: index + 1, message: "uses console outside the programs; return the text in the command's result" });
    });
  }
  return findings;
}

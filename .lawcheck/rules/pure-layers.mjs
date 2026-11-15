import { bare } from './lib/code.mjs';

const AMBIENT = [
  [/(?:(?<![\w$.])|(?<=\.\.\.))process(?![\w$])/, 'reads process'],
  [/(?<![\w$.])globalThis(?![\w$])/, 'reads globalThis'],
  [/(?<![\w$.])console(?![\w$])/, 'uses console'],
  [/(?<![\w$.])fetch\s*\(/, 'calls fetch'],
  [/(?<![\w$.])Date\s*\.\s*now\s*\(|(?<![\w$.])new\s+Date\s*\(/, 'reads the clock'],
  [/(?<![\w$.])Math\s*\.\s*random\s*\(/, 'draws a random number'],
  [/(?<![\w$.])set(?:Timeout|Interval|Immediate)\s*\(/, 'starts a timer'],
];

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    file.lines.forEach((text, index) => {
      const code = bare(text);
      for (const [pattern, what] of AMBIENT) {
        if (pattern.test(code)) findings.push({ line: index + 1, message: `${what}; ${/^[aeiou]/.test(file.type) ? 'an' : 'a'} ${file.type} module takes what it needs as an argument` });
      }
    });
  }
  return findings;
}

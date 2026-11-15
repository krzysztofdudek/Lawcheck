import { bare } from './lib/code.mjs';

const PROGRAMS = ['cli', 'rule-runner', 'guard', 'plugin-entry'];
const STATEMENT = /^(?:if|for|while|do|try|switch|await|new|void|throw)\b|^[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*\s*(?:\(|\[|=(?!=)|\+\+|--)/;
const DECLARES = /^(?:import|export|const|let|var|function|async|class|interface|type|enum|declare|abstract)\b/;
const STATE = /^(?:export\s+)?(?:let|var)\s+([\w$]+)/;
const EMPTY_STORE = /^(?:export\s+)?const\s+([\w$]+)[^=]*=\s*new\s+(Set|Map|WeakMap|WeakSet)\s*(?:<[^(]*>)?\(\s*\)/;
const READS_AT_LOAD = /^(?:export\s+)?const\s+([\w$]+)[^=]*=.*(?<![\w$])([\w$]+Sync)\s*\(/;

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    if (PROGRAMS.includes(file.type)) continue;
    file.lines.forEach((text, index) => {
      const code = bare(text);
      const line = index + 1;
      let match;
      if (!DECLARES.test(code) && STATEMENT.test(code)) findings.push({ line, message: 'runs a statement when the module loads; put it in a function that a program calls' });
      else if ((match = code.match(STATE)) !== null) findings.push({ line, message: `keeps the variable ${match[1]} between calls; pass the state in, or hold it in an object the caller creates` });
      else if ((match = code.match(EMPTY_STORE)) !== null) findings.push({ line, message: `keeps the ${match[2]} ${match[1]} between calls; pass the state in, or hold it in an object the caller creates` });
      else if ((match = code.match(READS_AT_LOAD)) !== null) findings.push({ line, message: `computes ${match[1]} with ${match[2]} when the module loads; make it a function` });
    });
  }
  return findings;
}

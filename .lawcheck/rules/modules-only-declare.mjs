import { bare } from './lib/code.mjs';

const PROGRAMS = ['cli', 'rule-runner', 'guard', 'plugin-entry'];
const STATEMENT = /^(?:if|for|while|do|try|switch|await|new|void|throw)\b|^[(\[!;]|^[A-Za-z_$][\w$]*(?:\s*\.\s*[\w$]+)*\s*(?:\(|\[|=(?!=)|\+\+|--)/;
const DECLARES = /^(?:import|export|const|let|var|function|async|class|interface|type|enum|declare|abstract)\b/;
const STATE = /^(?:export\s+)?(?:let|var)\s+([\w$]+)/;
const CONSTANT = /^(?:export\s+)?const\s+([\w$]+)[^=]*=\s*(.*)$/;
const FUNCTION = /^(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[\w$]+\s*=>)/;
const EMPTY_STORE = /^new\s+(Set|Map|WeakMap|WeakSet)\s*(?:<[^(]*>)?\(\s*\)/;
const EMPTY_LITERAL = /^(\{\s*\}|\[\s*\])\s*(?:as\s[^;]*)?;?\s*$/;
const READS_AT_LOAD = /(?<![\w$])([\w$]+Sync)\s*\(/;
const CREATES = /^(?:new\s+)?((?:create|make|start|open|register|init|spawn|connect)[A-Z\w$]*)\s*\(/;
const STATIC = /^\s*static\s+(readonly\s+)?(#?[\w$]+)[^=(]*=(?![=>])\s*(.*)$/;
const KEEP = '; pass the state in, or hold it in an object the caller creates';
const AT_LOAD = 'when the module loads; make it a function';

function constant(name, value) {
  let match;
  if ((match = value.match(EMPTY_STORE)) !== null) return `keeps the ${match[1]} ${name} between calls${KEEP}`;
  if ((match = value.match(EMPTY_LITERAL)) !== null) return `keeps the empty ${match[1].startsWith('{') ? 'object' : 'array'} ${name} between calls${KEEP}`;
  if (/^\(\s*(?:async\s+)?(?:function\b|\([^)]*\)\s*(?::[^=]*)?=>|[\w$]+\s*=>)/.test(value)) return `computes ${name} by running a function ${AT_LOAD}`;
  if (FUNCTION.test(value)) return null;
  if (/^await\b/.test(value)) return `computes ${name} with await ${AT_LOAD}`;
  if ((match = value.match(READS_AT_LOAD)) !== null) return `computes ${name} with ${match[1]} ${AT_LOAD}`;
  if ((match = value.match(CREATES)) !== null) return `creates ${name} with ${match[1]} ${AT_LOAD}`;
  return null;
}

export function check({ files }) {
  const findings = [];
  for (const file of files) {
    if (PROGRAMS.includes(file.type)) continue;
    file.lines.forEach((text, index) => {
      const code = bare(text);
      const line = index + 1;
      let match;
      if ((match = code.match(STATIC)) !== null) {
        if (match[1] === undefined || EMPTY_STORE.test(match[3]) || EMPTY_LITERAL.test(match[3])) {
          findings.push({ line, message: `keeps the static field ${match[2]} between calls${KEEP}` });
        }
        return;
      }
      if (!DECLARES.test(code) && STATEMENT.test(code)) findings.push({ line, message: 'runs a statement when the module loads; put it in a function that a program calls' });
      else if ((match = code.match(STATE)) !== null) findings.push({ line, message: `keeps the variable ${match[1]} between calls${KEEP}` });
      else if ((match = code.match(CONSTANT)) !== null) {
        const message = constant(match[1], match[2]);
        if (message !== null) findings.push({ line, message });
      }
    });
  }
  return findings;
}

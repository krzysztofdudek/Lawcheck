// A line without its string literals and its line comment. A template literal or a block comment that runs over several lines is read as code.
export function bare(line) {
  let out = '';
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quote !== null) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      quote = c;
      out += ' ';
      continue;
    }
    if (c === '/' && line[i + 1] === '/') break;
    out += c;
  }
  return out;
}

const FROM = /(?:^|\n)[ \t]*(import|export)\s+(type\s+)?(?:[^'";]*?\sfrom\s*)?['"]([^'"\n]+)['"]/g;
const CALLED = /\b(?:import|require)\s*\(\s*['"]([^'"\n]+)['"]\s*\)/g;

export function importsOf(text) {
  const found = [];
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  for (const match of text.matchAll(FROM)) {
    const at = match.index + match[0].lastIndexOf(match[3]);
    found.push({ line: lineAt(at), module: match[3], typeOnly: match[2] !== undefined });
  }
  for (const match of text.matchAll(CALLED)) {
    found.push({ line: lineAt(match.index), module: match[1], typeOnly: false });
  }
  return found;
}

export function isOutside(module) {
  return !module.startsWith('./') && !module.startsWith('../');
}

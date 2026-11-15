// A template literal or a block comment that runs over several lines is read as code on its later lines.
export function bare(line) {
  let out = '';
  const code = (from, inner) => {
    let depth = 0;
    for (let i = from; i < line.length; i++) {
      const c = line[i];
      if (inner && c === '{') depth++;
      if (inner && c === '}' && depth-- === 0) return i + 1;
      if (c === "'" || c === '"') {
        out += ' ';
        for (i++; i < line.length && line[i] !== c; i++) if (line[i] === '\\') i++;
        continue;
      }
      if (c === '`') {
        out += ' ';
        i = template(i + 1) - 1;
        continue;
      }
      if (c === '/' && line[i + 1] === '/') return line.length;
      out += c;
    }
    return line.length;
  };
  const template = (from) => {
    for (let i = from; i < line.length; i++) {
      if (line[i] === '\\') i++;
      else if (line[i] === '`') return i + 1;
      else if (line[i] === '$' && line[i + 1] === '{') {
        out += ' ';
        i = code(i + 2, true) - 1;
      }
    }
    return line.length;
  };
  code(0, false);
  return out;
}

const FROM = /(?:^\uFEFF?|[\n;])[ \t]*(import|export)(?=[\s{*'"])\s*(type(?=[\s{*])\s*)?(?:[^'";]*?(?<=[\s}*])from\s*)?['"]([^'"\n]+)['"]/g;
const CALLED = /\b(?:import|require)\s*\(\s*(['"`])([^'"`$\n]+)\1\s*\)/g;

export function importsOf(text) {
  const found = [];
  const lineAt = (index) => text.slice(0, index).split('\n').length;
  for (const match of text.matchAll(FROM)) {
    const at = match.index + match[0].lastIndexOf(match[3]);
    found.push({ line: lineAt(at), module: match[3], typeOnly: match[2] !== undefined });
  }
  for (const match of text.matchAll(CALLED)) {
    found.push({ line: lineAt(match.index), module: match[2], typeOnly: false });
  }
  return found;
}

export function isOutside(module) {
  return !module.startsWith('./') && !module.startsWith('../');
}

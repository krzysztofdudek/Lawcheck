export function patternProblem(pattern: string): string | null {
  if (pattern === '') return 'is empty';
  const body = pattern.startsWith('!') ? pattern.slice(1) : pattern;
  if (body === '') return "is '!' alone";
  let open = false;
  let length = 0;
  for (const ch of body) {
    if (ch === '{') {
      if (open) return 'nests a brace';
      open = true;
      length = 0;
    } else if (ch === '}') {
      if (!open) return 'closes a brace it never opened';
      if (length === 0) return 'holds an empty alternative';
      open = false;
    } else if (open && ch === ',') {
      if (length === 0) return 'holds an empty alternative';
      length = 0;
    } else if (open && ch === '/') {
      return "holds a '/' inside a brace";
    } else if (open) {
      length++;
    }
  }
  if (open) return 'leaves a brace unclosed';
  for (const segment of body.split('/')) {
    if (segment === '') return 'holds an empty segment';
    if (segment === '.' || segment === '..') return `holds the segment '${segment}'`;
    if (segment !== '**' && segment.includes('**')) return 'holds ** beside other characters in one segment';
  }
  return null;
}

const SPECIAL = new Set(['^', '$', '\\', '.', '*', '+', '?', '(', ')', '[', ']', '{', '}', '|', '/']);

function segmentSource(segment: string): string {
  let out = '';
  let open = false;
  for (const ch of segment) {
    if (ch === '*') out += '[^/]*';
    else if (ch === '?') out += '[^/]';
    else if (ch === '{') { out += '(?:'; open = true; }
    else if (ch === '}') { out += ')'; open = false; }
    else if (ch === ',' && open) out += '|';
    else out += SPECIAL.has(ch) ? '\\' + ch : ch;
  }
  return out;
}

export function compilePattern(pattern: string): RegExp {
  const segments = pattern.split('/');
  let source = '^';
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**') source += last ? '[\\s\\S]+' : '(?:[^/]+/)*';
    else source += segmentSource(segment) + (last ? '' : '/');
  });
  return new RegExp(source + '$', 'u');
}

export function compileList(patterns: string[]): (path: string) => boolean {
  const plain: RegExp[] = [];
  const excluded: RegExp[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) excluded.push(compilePattern(pattern.slice(1)));
    else plain.push(compilePattern(pattern));
  }
  return (path) => plain.some((re) => re.test(path)) && !excluded.some((re) => re.test(path));
}

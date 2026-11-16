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

const EPSILON = 0;
const CHARACTER = 1;
const NOT_SLASH = 2;
const ANY = 3;
const MATCH = 4;
const SLASH = 0x2f;
// The states a matcher keeps between paths; past this many it starts afresh, so memory stays bounded whatever the paths.
const MOST_STATES = 4096;

class Automaton {
  readonly kinds: number[] = [];
  readonly points: number[] = [];
  readonly outs: number[][] = [];

  add(kind: number, point = 0): number {
    this.kinds.push(kind);
    this.points.push(point);
    this.outs.push([]);
    return this.kinds.length - 1;
  }

  link(from: number, to: number): void {
    this.outs[from]!.push(to);
  }

  step(tail: number, kind: number, point = 0): number {
    const state = this.add(kind, point);
    this.link(tail, state);
    const next = this.add(EPSILON);
    this.link(state, next);
    return next;
  }
}

function segmentStates(nfa: Automaton, tail: number, segment: string): number {
  let open = false;
  let branchStart = tail;
  let end = -1;
  for (const ch of segment) {
    if (ch === '{') {
      open = true;
      branchStart = tail;
      end = nfa.add(EPSILON);
    } else if (ch === '}' && open) {
      nfa.link(tail, end);
      tail = end;
      open = false;
    } else if (ch === ',' && open) {
      nfa.link(tail, end);
      tail = branchStart;
    } else if (ch === '*') {
      const loop = nfa.add(EPSILON);
      nfa.link(tail, loop);
      const any = nfa.add(NOT_SLASH);
      nfa.link(loop, any);
      nfa.link(any, loop);
      tail = loop;
    } else if (ch === '?') {
      tail = nfa.step(tail, NOT_SLASH);
    } else {
      tail = nfa.step(tail, CHARACTER, ch.codePointAt(0)!);
    }
  }
  return tail;
}

function build(pattern: string): Automaton {
  const nfa = new Automaton();
  let tail = nfa.add(EPSILON);
  const segments = pattern.split('/');
  segments.forEach((segment, index) => {
    const last = index === segments.length - 1;
    if (segment === '**' && last) {
      const any = nfa.add(ANY);
      nfa.link(tail, any);
      const after = nfa.add(EPSILON);
      nfa.link(any, after);
      nfa.link(after, any);
      tail = after;
    } else if (segment === '**') {
      const start = nfa.add(EPSILON);
      nfa.link(tail, start);
      const first = nfa.add(NOT_SLASH);
      nfa.link(start, first);
      const inName = nfa.add(EPSILON);
      nfa.link(first, inName);
      const more = nfa.add(NOT_SLASH);
      nfa.link(inName, more);
      nfa.link(more, inName);
      const slash = nfa.add(CHARACTER, SLASH);
      nfa.link(inName, slash);
      nfa.link(slash, start);
      tail = start;
    } else {
      tail = segmentStates(nfa, tail, segment);
      if (!last) tail = nfa.step(tail, CHARACTER, SLASH);
    }
  });
  nfa.link(tail, nfa.add(MATCH));
  return nfa;
}

export interface Pattern {
  test(path: string): boolean;
  // Whether some path that starts with this prefix matches.
  reaches(prefix: string): boolean;
}

// A pattern runs as an automaton over the path's code points, built into a deterministic one as paths need it, so a match costs time linear in the path whatever the pattern holds; a backtracking regular expression costs a power of the path's length for a segment like *a*a*a*b.
export function compilePattern(pattern: string): Pattern {
  const nfa = build(pattern);
  const count = nfa.kinds.length;
  const classes = new Map<number, number>([[SLASH, 1]]);
  for (let state = 0; state < count; state++) {
    if (nfa.kinds[state] === CHARACTER && !classes.has(nfa.points[state]!)) classes.set(nfa.points[state]!, classes.size + 1);
  }
  const width = classes.size + 1;
  const mark = new Int32Array(count);
  let generation = 0;

  const close = (seeds: number[]): number[] => {
    generation++;
    const out: number[] = [];
    const stack = [...seeds];
    while (stack.length > 0) {
      const state = stack.pop()!;
      if (mark[state] === generation) continue;
      mark[state] = generation;
      if (nfa.kinds[state] === EPSILON) for (const next of nfa.outs[state]!) stack.push(next);
      else out.push(state);
    }
    return out.sort((a, b) => a - b);
  };

  let sets: number[][] = [];
  let accepting: boolean[] = [];
  let ids = new Map<string, number>();
  let moves: Int32Array[] = [];
  const intern = (set: number[]): number => {
    const key = set.join(',');
    let id = ids.get(key);
    if (id === undefined) {
      id = sets.length;
      ids.set(key, id);
      sets.push(set);
      accepting.push(set.some((state) => nfa.kinds[state] === MATCH));
      moves.push(new Int32Array(width).fill(-1));
    }
    return id;
  };
  const reset = () => {
    sets = [];
    accepting = [];
    ids = new Map();
    moves = [];
    intern(close([0]));
  };
  reset();

  const leads = new Uint8Array(count);
  const back: number[][] = Array.from({ length: count }, () => []);
  for (let state = 0; state < count; state++) for (const next of nfa.outs[state]!) back[next]!.push(state);
  const queue = nfa.kinds.flatMap((kind, state) => (kind === MATCH ? [state] : []));
  for (const state of queue) leads[state] = 1;
  while (queue.length > 0) {
    for (const before of back[queue.pop()!]!) {
      if (leads[before] === 0) {
        leads[before] = 1;
        queue.push(before);
      }
    }
  }

  const move = (from: number, point: number, cls: number): number => {
    const seeds: number[] = [];
    for (const state of sets[from]!) {
      const kind = nfa.kinds[state];
      const takes =
        kind === ANY ||
        (kind === NOT_SLASH && point !== SLASH) ||
        (kind === CHARACTER && nfa.points[state] === point);
      if (takes) seeds.push(...nfa.outs[state]!);
    }
    const to = intern(close(seeds));
    moves[from]![cls] = to;
    return to;
  };

  const run = (path: string): number | null => {
    if (sets.length > MOST_STATES) reset();
    let at = 0;
    for (const ch of path) {
      const point = ch.codePointAt(0)!;
      const cls = classes.get(point) ?? 0;
      const known = moves[at]![cls]!;
      at = known >= 0 ? known : move(at, point, cls);
      if (sets[at]!.length === 0) return null;
    }
    return at;
  };

  return {
    test(path: string): boolean {
      const at = run(path);
      return at !== null && accepting[at]!;
    },
    reaches(prefix: string): boolean {
      const at = run(prefix);
      return at !== null && sets[at]!.some((state) => leads[state] === 1);
    },
  };
}

export function compileList(patterns: string[]): (path: string) => boolean {
  const plain: Pattern[] = [];
  const excluded: Pattern[] = [];
  for (const pattern of patterns) {
    if (pattern.startsWith('!')) excluded.push(compilePattern(pattern.slice(1)));
    else plain.push(compilePattern(pattern));
  }
  return (path) => plain.some((p) => p.test(path)) && !excluded.some((p) => p.test(path));
}

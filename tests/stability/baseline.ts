const ERROR_STRING = /(?:Error\(|error:\s*)(['"`])((?:(?!\1).)*)\1/g;

const FAILS: Record<string, (text: string) => boolean> = {
  'handlers-are-thin': (text) => /\bfor \(|\bdb\.|\d{4,}/.test(text),
  'clear-errors': (text) => [...text.matchAll(ERROR_STRING)].some((match) => !match[2]!.includes(';')),
  'pure-domain': (text) => /new Date\(\)|Math\.random/.test(text),
  'comments-say-why': (text) => /^\s*\/\/\s*[a-z]/m.test(text),
};

export function baselineVerdict(rule: string, text: string): 'pass' | 'fail' {
  const fails = FAILS[rule];
  if (fails === undefined) throw new Error(`the baseline has no pattern for ${rule}`);
  return fails(text) ? 'fail' : 'pass';
}

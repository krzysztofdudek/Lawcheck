export type Severity = 'error' | 'warning';

export interface ErrorItem {
  code: string;
  file: string | null;
  line: number | null;
  message: string;
  next?: string;
}

export interface Finding {
  code: string;
  rule: string | null;
  severity: Severity;
  debt: boolean;
  file: string;
  line?: number;
  type: string;
  message: string;
  why: string;
}

export interface WaiverEntry {
  file: string;
  line: number;
  rule: string;
  debt: boolean;
  waived: number;
  reason: string;
}

export interface Reviews {
  missing: number;
  calls_made: number;
  passes_recorded: number;
}

export interface Unresolved {
  file: string;
  line: number;
  what: string;
  answer: 'ambiguous' | 'none';
  reason: 'unfollowed' | 'unowned' | null;
  candidates: string[];
  debt: boolean;
}

export interface Next {
  command: string | null;
  text: string;
}

export interface Report {
  mode: 'change' | 'full' | 'paths';
  base: string | null;
  changed: number;
  findings: Finding[];
  debt: Finding[];
  waivers: WaiverEntry[];
  unresolved?: Unresolved[];
  reviews?: Reviews;
  next?: Next | null;
  lawChanged?: boolean;
  note?: string | null;
}

export const WHY: Record<string, string> = {
  'waiver-unknown-rule': 'a waiver that names no rule of the law waives nothing',
  'waiver-without-reason': 'a waiver without a reason cannot be weighed later',
  'waiver-unused': 'a waiver that drops nothing would hide the next finding on its line',
  usage: 'the tool does only what its usage line says',
  'not-initialized': 'without a law there is nothing to check the code against',
  'no-git': 'the files and the change come from git',
  'law-invalid': 'a misspelled key changes the law without a word',
  'rule-missing-file': 'a rule without its file would never be checked',
  'rule-file-without-entry': 'a rule file that the law does not name never runs',
  'file-unreadable': 'a file that cannot be read cannot be typed or judged',
  'type-overlap': 'a file has one type, so the rules that bind it are never in doubt',
  'base-unreachable': 'without its base a change cannot be told from debt',
  'rule-crashed': 'a broken rule says nothing about the code',
  internal: 'a fault of Lawcheck says nothing about the code',
  'not-reviewed': 'a reviewer rule says nothing about content it has not judged',
  'too-large-to-review': 'the reviewer is never sent more than reviewer.max_chars characters',
  'config-invalid': 'a misspelled setting changes the reviewer without a word',
  'reviewer-not-configured': 'reviewer rules need a reviewer to judge them',
  'too-many-reviews': 'reviewer.max_calls bounds what one run spends',
  'reviewer-unreachable': "without the reviewer's answer a reviewer rule says nothing",
  'reviewer-bad-answer': 'an answer that is no verdict cannot be recorded',
  'forbidden-use': "a type's may_use names every type its files may use",
  'uses-not-read': 'a restriction that cannot be checked is not shown as kept',
  'parser-failed': 'a file whose uses were not read is not taken to use nothing',
  'already-initialized': 'a second law would split one repository\'s rules between two files',
};

export const CODES = new Set([...Object.keys(WHY)]);

export function forCommand(text: string, command: string): string {
  if (command === 'check') return text;
  const at = text.indexOf('then run lawcheck check');
  return at < 0 ? text : `${text.slice(0, at)}then run lawcheck ${command} again`;
}

function nextFor(error: ErrorItem, command: string | null): string {
  if (error.next !== undefined) return forCommand(error.next, command ?? 'check');
  if (error.code === 'usage') {
    return command === null ? 'run lawcheck as its usage line says: lawcheck --help' : `run lawcheck ${command} as its usage line says: lawcheck ${command} --help`;
  }
  if (error.code === 'no-git') return `run lawcheck ${command ?? 'check'} inside a git work tree, with git on the PATH`;
  return forCommand(fixedNext(error, command ?? 'check'), command ?? 'check');
}

function fixedNext(error: ErrorItem, command: string): string {
  switch (error.code) {
    case 'not-initialized':
      return 'write .lawcheck/law.yaml at the root of the code to check, then run lawcheck check';
    case 'law-invalid':
      return 'fix .lawcheck/law.yaml, then run lawcheck check';
    case 'config-invalid':
      return 'fix .lawcheck/config.yaml, then run lawcheck check';
    case 'rule-missing-file':
      return 'write the rule files the law names, or take their rules out of the law, then run lawcheck check';
    case 'rule-file-without-entry':
      return `add a rule for ${error.file} to the law, or move the file to .lawcheck/rules/lib/, then run lawcheck check`;
    case 'file-unreadable':
      return `make ${error.file} readable, then run lawcheck check`;
    case 'type-overlap':
      return 'narrow the paths or content of the types that overlap in .lawcheck/law.yaml, then run lawcheck check';
    case 'base-unreachable':
      return 'pass --base with a branch or a commit that exists here';
    case 'rule-crashed':
      return `fix ${error.file}, then run lawcheck check`;
    case 'reviewer-unreachable':
    case 'reviewer-bad-answer':
      return 'run the same command again; what was answered is kept, so it asks only the rest';
    default:
      return `run lawcheck ${command} again, and report the error if it stays`;
  }
}

// spec/check-slice.md, section 6: no text output holds these, and no JSON document holds them raw.
const FORBIDDEN = /[\x00-\x09\x0b-\x1f\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
const RAW_IN_JSON = /[\x7f-\x9f\u2028\u2029\u202a-\u202e\u2066-\u2069]/g;
// A line that starts like a command of GitHub Actions or Azure Pipelines; GitHub reads a command after leading white space, and Azure reads ##vso[ anywhere in a line.
const FORGED = /^(\s*)(::|##\[)/;
const AZURE = /##vso\[/g;
const NAMED: Record<string, string> = { '\n': '\\n', '\r': '\\r', '\t': '\\t' };

function escaped(c: string): string {
  const code = c.charCodeAt(0);
  return NAMED[c] ?? (code < 0x80 ? `\\x${code.toString(16).padStart(2, '0')}` : `\\u${code.toString(16).padStart(4, '0')}`);
}

export function shown(text: string): string {
  return text.replace(/\n/g, escaped).replace(FORBIDDEN, escaped);
}

export function safeText(output: string): string {
  return output
    .split('\n')
    .map((line) =>
      line
        .replace(FORBIDDEN, escaped)
        .replace(AZURE, '\\x23#vso[')
        .replace(FORGED, (_, space: string, start: string) => space + escaped(start[0]!) + start.slice(1)),
    )
    .join('\n');
}

export function safeJson(output: string): string {
  return output.replace(RAW_IN_JSON, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
}

export function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? '' : 's'}`;
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function sortErrors(errors: ErrorItem[]): ErrorItem[] {
  return [...errors].sort(
    (a, b) => compare(a.file ?? '', b.file ?? '') || (a.line ?? 0) - (b.line ?? 0) || compare(a.code, b.code),
  );
}

export function sortFindings(findings: Finding[]): Finding[] {
  return [...findings].sort((a, b) => compare(a.file, b.file) || (a.line ?? 0) - (b.line ?? 0) || compare(a.code, b.code));
}

export function placeOf(file: string | null, line: number | null | undefined): string | null {
  if (file === null) return null;
  return line === null || line === undefined ? file : `${file}:${line}`;
}

export function nextOfErrors(input: ErrorItem[], command: string | null = 'check'): string {
  return nextFor(sortErrors(input)[0]!, command);
}

export function errorLines(errors: ErrorItem[], limit = Infinity): string[] {
  const lines: string[] = [];
  const seen = new Set<string>();
  let printed = 0;
  for (const error of errors) {
    if (printed === limit) break;
    printed++;
    const place = placeOf(error.file, error.line);
    lines.push(`${place === null ? '' : shown(place) + '  '}error[${error.code}]  ${shown(error.message)}`);
    if (!seen.has(error.code)) {
      seen.add(error.code);
      lines.push(`  why:  ${WHY[error.code] ?? ''}`);
    }
  }
  if (errors.length > printed) lines.push(`... and ${plural(errors.length - printed, 'more error')} (lawcheck check lists all)`);
  return lines;
}

export function renderErrors(input: ErrorItem[], json: boolean, command: string | null = 'check', limit = Infinity): string {
  const errors = sortErrors(input);
  const next = nextFor(errors[0]!, command);
  if (json) {
    const document = {
      schema: 'lawcheck-error/1',
      errors: errors.map((e) => ({ code: e.code, file: e.file, line: e.line, message: e.message, why: WHY[e.code] ?? '' })),
      next: { command: null, text: next },
    };
    return JSON.stringify(document, null, 2) + '\n';
  }
  const lines = [`lawcheck: ERROR  ${plural(errors.length, 'error')}`, '', ...errorLines(errors, limit)];
  lines.push('', `next: ${shown(next)}`);
  return lines.join('\n') + '\n';
}

function waiverPart(count: number): string {
  return count === 0 ? '' : `, ${plural(count, 'waiver')}`;
}

function unresolvedPart(count: number): string {
  return count === 0 ? '' : `, ${plural(count, 'unresolved use')}`;
}

export function firstError(report: Report): Finding | undefined {
  return report.findings.find((f) => f.severity === 'error');
}

export function fixNext(finding: Finding): string {
  return `fix ${placeOf(finding.file, finding.line)}`;
}

export function renderReport(report: Report, json: boolean): string {
  const errors = report.findings.filter((f) => f.severity === 'error').length;
  const warnings = report.findings.length - errors;
  const failing = errors > 0;
  const blocking = firstError(report);
  const nextOf: Next | null =
    report.next !== undefined ? report.next : blocking ? { command: null, text: fixNext(blocking) } : null;
  const next = nextOf === null ? null : nextOf.text;
  const reviews = report.reviews ?? { missing: 0, calls_made: 0, passes_recorded: 0 };
  const calls = reviews.calls_made === 0 ? '' : `, ${plural(reviews.calls_made, 'reviewer call')}`;
  const changeWaivers = report.waivers.filter((w) => !w.debt).length;
  const debtWaivers = report.waivers.length - changeWaivers;
  const unresolved = report.unresolved ?? [];
  const changeUnresolved = unresolved.filter((u) => !u.debt).length;
  const debtUnresolved = unresolved.length - changeUnresolved;

  if (json) {
    const shape = (f: Finding) => {
      const out: Record<string, unknown> = {
        code: f.code,
        rule: f.rule,
        severity: f.severity,
        blocking: f.severity === 'error',
        debt: f.debt,
        file: f.file,
      };
      if (f.line !== undefined) out.line = f.line;
      out.type = f.type;
      out.message = f.message;
      out.why = f.why;
      return out;
    };
    const document = {
      schema: 'lawcheck-check/0',
      result: failing ? 'fail' : 'pass',
      scope: { mode: report.mode, base: report.base, files: report.changed, law_changed: report.lawChanged ?? false },
      summary: { errors, warnings, debt: report.debt.length, waivers: changeWaivers, unresolved: changeUnresolved },
      findings: [...report.findings, ...report.debt].map(shape),
      waivers: report.waivers.map((w) => ({ file: w.file, line: w.line, rule: w.rule, debt: w.debt, waived: w.waived, reason: w.reason })),
      unresolved: unresolved.map((u) => ({ file: u.file, line: u.line, what: u.what, answer: u.answer, reason: u.reason, candidates: u.candidates, debt: u.debt })),
      reviews: { missing: reviews.missing, calls_made: reviews.calls_made, passes_recorded: reviews.passes_recorded },
      next: nextOf === null ? null : { command: nextOf.command, text: nextOf.text },
    };
    return JSON.stringify(document, null, 2) + '\n';
  }

  const verdict = failing ? 'FAIL' : 'PASS';
  const lines: string[] = [];
  if (report.mode !== 'paths' && report.base !== null && report.changed === 0) {
    lines.push(`lawcheck: ${verdict}  nothing changed against ${shown(report.base)}${calls}`);
  } else {
    const counts = [errors > 0 ? plural(errors, 'error') : '', warnings > 0 ? plural(warnings, 'warning') : '']
      .filter(Boolean)
      .join(', ');
    const scope =
      report.mode === 'paths'
        ? plural(report.changed, 'named file')
        : report.base === null
        ? `${plural(report.changed, 'file')} (no base: every file counts as changed)`
        : `${plural(report.changed, 'changed file')} (against ${shown(report.base)})`;
    lines.push(`lawcheck: ${verdict}  ${counts === '' ? '' : counts + ' in '}${scope}${waiverPart(changeWaivers)}${unresolvedPart(changeUnresolved)}${calls}`);
  }
  if (report.note) lines.push(report.note);

  const limit = 50;
  const total = report.findings.length + report.debt.length;
  const more = `... ${plural(total - limit, 'more finding')} (--json lists all)`;
  const seen = new Set<string>();
  let printed = 0;
  const print = (finding: Finding) => {
    lines.push(`${shown(placeOf(finding.file, finding.line)!)}  ${finding.severity}[${finding.code}]  ${shown(finding.message)}`);
    printed++;
    if (!seen.has(finding.code)) {
      seen.add(finding.code);
      lines.push(`  why:  ${finding.why}`);
    }
  };

  if (report.findings.length > 0) {
    lines.push('');
    for (const finding of report.findings) if (printed < limit) print(finding);
    if (report.findings.length > limit) lines.push(more);
  }
  if (report.mode === 'full') {
    lines.push('');
    const files = new Set(report.debt.map((f) => f.file)).size;
    const heading = report.debt.length === 0 ? 'none' : `${plural(report.debt.length, 'finding')} in ${plural(files, 'file')}`;
    lines.push(`debt (outside this change): ${heading}${waiverPart(debtWaivers)}${unresolvedPart(debtUnresolved)}`);
    for (const finding of report.debt) if (printed < limit) print(finding);
    if (report.findings.length <= limit && total > limit) lines.push(more);
  }
  if (next !== null) lines.push('', `next: ${shown(next)}`);
  return lines.join('\n') + '\n';
}

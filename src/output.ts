export type Severity = 'error' | 'warning';

export interface ErrorItem {
  code: string;
  file: string | null;
  line: number | null;
  message: string;
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

export interface Report {
  mode: 'change' | 'full';
  base: string | null;
  changed: number;
  findings: Finding[];
  debt: Finding[];
  waivers: WaiverEntry[];
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
};

export const CODES = new Set([...Object.keys(WHY)]);

export const USAGE = [
  'usage: lawcheck check [--full] [--base <ref>] [--json]',
  '',
  'Checks the files of this change against .lawcheck/law.yaml.',
  '',
  '  --full          also judge the files outside the change, as debt',
  '  --base <ref>    the base of the change; else LAWCHECK_BASE, else origin/HEAD',
  '  --json          print one JSON document',
  '',
  'Exit 0: no error. Exit 1: the code breaks the law. Exit 2: no conclusion.',
  '',
].join('\n');

function nextFor(error: ErrorItem): string {
  switch (error.code) {
    case 'usage':
      return 'run lawcheck check, with --full, --base <ref> or --json as needed';
    case 'not-initialized':
      return 'write .lawcheck/law.yaml at the root of the code to check, then run lawcheck check';
    case 'no-git':
      return 'run lawcheck check inside a git work tree, with git on the PATH';
    case 'law-invalid':
      return 'fix .lawcheck/law.yaml, then run lawcheck check';
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
    default:
      return 'run lawcheck check again, and report the error if it stays';
  }
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

function placeOf(file: string | null, line: number | null | undefined): string | null {
  if (file === null) return null;
  return line === null || line === undefined ? file : `${file}:${line}`;
}

export function renderErrors(input: ErrorItem[], json: boolean): string {
  const errors = sortErrors(input);
  const next = nextFor(errors[0]!);
  if (json) {
    const document = {
      schema: 'lawcheck-error/1',
      errors: errors.map((e) => ({ code: e.code, file: e.file, line: e.line, message: e.message, why: WHY[e.code] ?? '' })),
      next: { command: null, text: next },
    };
    return JSON.stringify(document, null, 2) + '\n';
  }
  const lines = [`lawcheck: ERROR  ${plural(errors.length, 'error')}`, ''];
  const seen = new Set<string>();
  for (const error of errors) {
    const place = placeOf(error.file, error.line);
    lines.push(`${place === null ? '' : place + '  '}error[${error.code}]  ${error.message}`);
    if (!seen.has(error.code)) {
      seen.add(error.code);
      lines.push(`  why:  ${WHY[error.code] ?? ''}`);
    }
  }
  lines.push('', `next: ${next}`);
  return lines.join('\n') + '\n';
}

function waiverPart(count: number): string {
  return count === 0 ? '' : `, ${plural(count, 'waiver')}`;
}

export function firstError(report: Report): Finding | undefined {
  return report.findings.find((f) => f.severity === 'error');
}

export function renderReport(report: Report, json: boolean): string {
  const errors = report.findings.filter((f) => f.severity === 'error').length;
  const warnings = report.findings.length - errors;
  const failing = errors > 0;
  const blocking = firstError(report);
  const next = blocking ? `fix ${placeOf(blocking.file, blocking.line)}` : null;
  const changeWaivers = report.waivers.filter((w) => !w.debt).length;
  const debtWaivers = report.waivers.length - changeWaivers;

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
      scope: { mode: report.mode, base: report.base, files: report.changed },
      summary: { errors, warnings, debt: report.debt.length, waivers: changeWaivers },
      findings: [...report.findings, ...report.debt].map(shape),
      waivers: report.waivers.map((w) => ({ file: w.file, line: w.line, rule: w.rule, debt: w.debt, waived: w.waived, reason: w.reason })),
      next: next === null ? null : { command: null, text: next },
    };
    return JSON.stringify(document, null, 2) + '\n';
  }

  const verdict = failing ? 'FAIL' : 'PASS';
  const lines: string[] = [];
  if (report.base !== null && report.changed === 0) {
    lines.push(`lawcheck: ${verdict}  nothing changed against ${report.base}`);
  } else {
    const counts = [errors > 0 ? plural(errors, 'error') : '', warnings > 0 ? plural(warnings, 'warning') : '']
      .filter(Boolean)
      .join(', ');
    const scope =
      report.base === null
        ? `${plural(report.changed, 'file')} (no base: every file counts as changed)`
        : `${plural(report.changed, 'changed file')} (against ${report.base})`;
    lines.push(`lawcheck: ${verdict}  ${counts === '' ? '' : counts + ' in '}${scope}${waiverPart(changeWaivers)}`);
  }

  const limit = 50;
  const total = report.findings.length + report.debt.length;
  const more = `... ${plural(total - limit, 'more finding')} (--json lists all)`;
  const seen = new Set<string>();
  let printed = 0;
  const print = (finding: Finding) => {
    lines.push(`${placeOf(finding.file, finding.line)}  ${finding.severity}[${finding.code}]  ${finding.message}`);
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
    lines.push(`debt (outside this change): ${heading}${waiverPart(debtWaivers)}`);
    for (const finding of report.debt) if (printed < limit) print(finding);
    if (report.findings.length <= limit && total > limit) lines.push(more);
  }
  if (next !== null) lines.push('', `next: ${next}`);
  return lines.join('\n') + '\n';
}

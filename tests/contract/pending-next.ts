// Next lines that do not get the user further today. Each names a finding of tests/findings.md that is not closed. An entry goes when its line gets further; none is added without a finding.
export const PENDING: { id: string; finding: string }[] = [
  { id: 'not-initialized, doctor, law.yaml is a directory', finding: 'S5-5' },
  { id: 'base-unreachable, shallow clone, base fetched at depth 1 and passed', finding: 'S7-5' },
  { id: 'rule-crashed, rule imports from above the root', finding: 'S2-2' },
  { id: 'no-git, git cannot read the work tree', finding: 'R-1' },
];

type Step = { name?: string; uses?: string; run?: string; 'continue-on-error'?: unknown };
type Job = { 'continue-on-error'?: unknown; steps?: Step[] };

const tolerated = (value: unknown): boolean => value !== undefined && value !== false;

// A job or step with continue-on-error counts as a success to GitHub whatever it did, so a red shard, merge, nightly run or required check behind it would pass.
export function continueOnErrorProblems(file: string, jobs: Record<string, Job>, names: string[]): string[] {
  const problems: string[] = [];
  for (const name of names) {
    const job = jobs[name];
    if (job === undefined) continue;
    if (tolerated(job['continue-on-error'])) problems.push(`${file}: ${name} has continue-on-error, so GitHub reports its red as a success`);
    (job.steps ?? []).forEach((step, i) => {
      if (tolerated(step['continue-on-error'])) problems.push(`${file}: step ${i + 1} of ${name} (${step.name ?? step.uses ?? step.run ?? 'unnamed'}) has continue-on-error, so GitHub reports its red as a success`);
    });
  }
  return problems;
}

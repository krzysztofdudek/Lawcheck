type Step = { name?: string; uses?: string; run?: string; 'continue-on-error'?: unknown };
type Job = { 'continue-on-error'?: unknown; steps?: Step[] };

const tolerated = (value: unknown): boolean => value !== undefined && value !== false;

// A job or step with continue-on-error counts as a success to GitHub whatever it did. Every job of a workflow is judged, as the one required check waits for all of them and a nightly or weekly job is the release's evidence; no job or step is excused.
export function continueOnErrorProblems(file: string, jobs: Record<string, Job>): string[] {
  const problems: string[] = [];
  for (const [name, job] of Object.entries(jobs)) {
    if (tolerated(job['continue-on-error'])) problems.push(`${file}: ${name} has continue-on-error, so GitHub reports its red as a success`);
    (job.steps ?? []).forEach((step, i) => {
      if (tolerated(step['continue-on-error'])) problems.push(`${file}: step ${i + 1} of ${name} (${step.name ?? step.uses ?? step.run ?? 'unnamed'}) has continue-on-error, so GitHub reports its red as a success`);
    });
  }
  return problems;
}

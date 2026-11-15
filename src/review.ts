import { setTimeout as sleep } from 'node:timers/promises';
import type { ReviewerConfig } from './config.js';
import type { ErrorItem } from './output.js';
import { checkAnswer } from './prompt.js';
import type { AnswerFinding } from './prompt.js';
import { hide } from './keys.js';
import type { Provider } from './providers/index.js';
export interface Recorder {
  pass(key: string, rule: string): Promise<void>;
  failure(key: string, rule: string, findings: AnswerFinding[]): Promise<void>;
  done(): Promise<unknown>;
}

export const NO_RECORD: Recorder = {
  pass: async () => undefined,
  failure: async () => undefined,
  done: async () => undefined,
};

export interface Ask {
  file: string;
  rule: string;
  key: string;
  prompt: string;
  lineCount: number;
  waived: Set<number>;
}

export interface Answered {
  ask: Ask;
  findings: AnswerFinding[];
  answer: string;
}

export interface Failed {
  ask: Ask;
  code: 'reviewer-unreachable' | 'reviewer-bad-answer';
  message: string;
}

export interface Calls {
  answered: Answered[];
  failed: Failed[];
  sent: number;
}

export interface CallOptions {
  cap: number;
  parallel: number;
  resendDelayMs?: number;
}

export function preflight(provider: Provider | null, config: ReviewerConfig, cap: number, count: number, review: string): ErrorItem[] {
  const errors: ErrorItem[] = [];
  if (provider === null) {
    errors.push({
      code: 'reviewer-not-configured',
      file: null,
      line: null,
      message: 'no reviewer.provider is set in .lawcheck/config.yaml',
      next: `set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run ${review}`,
    });
  }
  if (count > cap) {
    errors.push({
      code: 'too-many-reviews',
      file: null,
      line: null,
      message: `this run needs ${count} reviewer calls and may send ${cap}`,
      next: `${count} reviewer calls are needed and the limit is ${cap}; raising reviewer.max_calls or --max-calls is the user's decision`,
    });
  }
  if (provider !== null) {
    const problem = provider.ready();
    if (problem !== null) {
      errors.push({
        code: 'reviewer-unreachable',
        file: null,
        line: null,
        message: `${config.provider} cannot be called: ${problem}`,
        next: `make ${config.provider} reachable as the error says, then run ${review}`,
      });
    }
  }
  return errors;
}

export function remaining(findings: AnswerFinding[], waived: Set<number>): AnswerFinding[] {
  return findings.filter((finding) => finding.line === null || !waived.has(finding.line));
}

export async function call<A extends Ask>(asks: A[], provider: Provider, writer: Recorder, options: CallOptions): Promise<Calls> {
  const answered: Answered[] = [];
  const failed: Failed[] = [];
  const delay = options.resendDelayMs ?? 2000;
  let sent = 0;
  let started = 0;
  let stopped = false;

  const mayResend = () => sent + (stopped ? 0 : asks.length - started) < options.cap;

  const request = async (prompt: string) => {
    sent++;
    let asked = await provider.ask(prompt);
    if ('failure' in asked && asked.resend !== false && mayResend()) {
      if (asked.resend === 'after-2s') await sleep(delay);
      if (mayResend()) {
        sent++;
        asked = await provider.ask(prompt);
      }
    }
    return asked;
  };

  const review = async (ask: A): Promise<void> => {
    let firstProblem: string | null = null;
    for (;;) {
      const asked = await request(ask.prompt);
      if ('failure' in asked) {
        stopped = true;
        failed.push({ ask, code: 'reviewer-unreachable', message: `${ask.rule}: ${hide(asked.failure)}` });
        return;
      }
      const checked = checkAnswer(asked.answer, ask.lineCount);
      if ('problem' in checked) {
        if (firstProblem === null && mayResend()) {
          firstProblem = hide(checked.problem);
          continue;
        }
        stopped = true;
        const message =
          firstProblem === null
            ? `${ask.rule}: the answer is no verdict (${hide(checked.problem)}), and the limit of calls leaves none to ask again`
            : `${ask.rule}: the answer is no verdict twice (${firstProblem}; then ${hide(checked.problem)})`;
        failed.push({ ask, code: 'reviewer-bad-answer', message });
        return;
      }
      const findings = checked.findings.map((finding) => ({ ...finding, message: hide(finding.message) }));
      if (remaining(findings, ask.waived).length === 0) await writer.pass(ask.key, ask.rule);
      else await writer.failure(ask.key, ask.rule, findings);
      answered.push({ ask, findings, answer: hide(asked.answer) });
      return;
    }
  };

  let next = 0;
  const worker = async () => {
    while (!stopped && next < asks.length) {
      const ask = asks[next++]!;
      started++;
      await review(ask);
    }
  };
  await Promise.all(Array.from({ length: Math.min(options.parallel, asks.length) }, worker));
  await writer.done();
  return { answered, failed, sent };
}

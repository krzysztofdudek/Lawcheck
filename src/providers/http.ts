import type { Resend } from './index.js';

export type Posted = { body: unknown } | { failure: string; resend: Resend };

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/)[0] ?? '').slice(0, max);
}

function errorMessage(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } };
    const message = body?.error?.message;
    return typeof message === 'string' && message.trim() !== '' ? firstLine(message, 200) : null;
  } catch {
    return null;
  }
}

function cause(error: unknown): string {
  const err = error as { message?: string; cause?: { code?: string; message?: string } };
  return err?.cause?.code ?? err?.cause?.message ?? err?.message ?? String(error);
}

export async function post(url: string, headers: Record<string, string>, body: unknown, timeoutSeconds: number): Promise<Posted> {
  const signal = AbortSignal.timeout(timeoutSeconds * 1000);
  let response: Response;
  let text: string;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
      redirect: 'manual',
      signal,
    });
    text = await response.text();
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
      return { failure: `the reviewer gave no answer within ${timeoutSeconds} seconds`, resend: false };
    }
    return { failure: `the connection to the reviewer gave no answer (${firstLine(cause(error), 200)})`, resend: 'at-once' };
  }
  if (response.status < 200 || response.status > 299) {
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const message = errorMessage(text);
    return { failure: message === null ? status : `${status}: ${message}`, resend: response.status === 429 ? 'after-2s' : false };
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { failure: `HTTP ${response.status}, and the reply is no JSON`, resend: false };
  }
}

import type { Resend } from './index.js';
import { hide } from '../keys.js';

export type Posted = { body: unknown } | { failure: string; resend: Resend };

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/)[0] ?? '').slice(0, max);
}

function errorMessage(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } };
    const message = body?.error?.message;
    return typeof message === 'string' && message.trim() !== '' ? firstLine(hide(message), 200) : null;
  } catch {
    return null;
  }
}

function lineOf(message: unknown): string {
  return typeof message === 'string' ? (message.split(/\r?\n/)[0] ?? '') : '';
}

function hasCredentials(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.username !== '' || parsed.password !== '' || /^[^/?#]*\/\/[^/?#]*@/.test(url);
  } catch {
    return false;
  }
}

export function cause(error: unknown): string {
  const err = error as { message?: unknown; cause?: { code?: unknown; message?: unknown } | null } | null;
  const code = err?.cause?.code;
  const first =
    typeof code === 'string' && /^[A-Z0-9_]+$/.test(code)
      ? code
      : (err?.cause !== undefined && err?.cause !== null && lineOf(err.cause.message)) || lineOf(err?.message) || 'an unknown error';
  return first.slice(0, 200);
}

export async function post(url: string, headers: Record<string, string>, body: unknown, timeoutSeconds: number): Promise<Posted> {
  if (hasCredentials(url)) return { failure: 'the address of the reviewer holds a user or a password, so no request is sent', resend: false };
  if (Object.values(headers).some((value) => /[^ -~]/.test(value))) {
    return { failure: 'a header of the request holds a character a header cannot carry, so no request is sent', resend: false };
  }
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
    return { failure: `the connection to the reviewer gave no answer (${cause(error)})`, resend: 'at-once' };
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

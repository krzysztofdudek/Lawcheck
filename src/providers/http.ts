import type { Resend } from './index.js';
import { hide } from '../keys.js';

export type Posted = { body: unknown } | { failure: string; resend: Resend; fix: string };

export const MAX_REPLY_BYTES = 4 * 1024 * 1024;

export interface Where {
  base?: string;
  keyName?: string | null;
  seconds?: number;
}

function firstLine(text: string, max: number): string {
  return (text.split(/\r?\n/)[0] ?? '').slice(0, max);
}

function errorMessage(text: string): string | null {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string };
    const message = typeof body?.error === 'string' ? body.error : body?.error?.message;
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

export function noAnswer(why: string, base: string): string {
  if (why === 'ECONNREFUSED') return `nothing answers at ${base}: the connection was refused (${why})`;
  if (why === 'ENOTFOUND' || why === 'EAI_AGAIN') return `the host of ${base} is not found (${why})`;
  if (why === 'bad port') return `${base} names a port that fetch refuses to call (${why})`;
  if (why === 'ETIMEDOUT' || why === 'EHOSTUNREACH' || why === 'ENETUNREACH') return `${base} cannot be reached from this machine (${why})`;
  if (why === 'ECONNRESET' || why === 'UND_ERR_SOCKET' || why === 'terminated' || why === 'other side closed') return `the connection to ${base} ended before the reply did (${why})`;
  return `the connection to ${base} gave no answer (${why})`;
}

function statusFix(status: number, where: Required<Where>): string {
  if (status === 401 || status === 403) {
    return where.keyName === null ? `the server at ${where.base} wants a key, which this provider never sends; reach it as openai-compatible with LAWCHECK_REVIEWER_KEY` : `check the key in ${where.keyName}`;
  }
  if (status === 404) return `check reviewer.model in .lawcheck/config.yaml and the address ${where.base}`;
  if (status === 429) return "wait until the provider's rate limit allows another call";
  if (status >= 300 && status < 400) return 'set LAWCHECK_REVIEWER_ENDPOINT to the address that answers without a redirect';
  if (status >= 500) return `wait until the reviewer at ${where.base} works again`;
  return `fix what the reviewer at ${where.base} says`;
}

async function readCapped(response: Response): Promise<string | null> {
  if (response.body === null) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REPLY_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

async function send(url: string, init: RequestInit, timeoutSeconds: number, where: Required<Where>): Promise<{ response: Response; text: string } | { failure: string; resend: Resend; fix: string }> {
  if (hasCredentials(url)) return { failure: 'the address of the reviewer holds a user or a password, so no request is sent', resend: false, fix: 'take the user and the password out of the address' };
  const signal = AbortSignal.timeout(Math.max(1, Math.round(where.seconds * 1000)));
  try {
    const response = await fetch(url, { ...init, redirect: 'manual', signal });
    const text = await readCapped(response);
    if (text === null) {
      return { failure: `the reply holds more than ${MAX_REPLY_BYTES / 1024 / 1024} MiB, so it is not read`, resend: false, fix: `check that ${where.base} is the address of the provider's API` };
    }
    return { response, text };
  } catch (error) {
    const name = (error as { name?: string })?.name;
    if (name === 'TimeoutError' || name === 'AbortError' || signal.aborted) {
      return {
        failure: `the reviewer gave no answer within ${timeoutSeconds} seconds`,
        resend: false,
        fix: `raise reviewer.timeout in .lawcheck/config.yaml, or check that the reviewer at ${where.base} works`,
      };
    }
    return { failure: noAnswer(cause(error), where.base), resend: 'at-once', fix: `start the reviewer at ${where.base}, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs` };
  }
}

function fill(url: string, timeoutSeconds: number, where: Where): Required<Where> {
  return { base: where.base ?? url, keyName: where.keyName === undefined ? 'LAWCHECK_REVIEWER_KEY' : where.keyName, seconds: Math.min(timeoutSeconds, where.seconds ?? timeoutSeconds) };
}

export async function post(url: string, headers: Record<string, string>, body: unknown, timeoutSeconds: number, where: Where = {}): Promise<Posted> {
  const filled = fill(url, timeoutSeconds, where);
  if (Object.values(headers).some((value) => /[^ -~]/.test(value))) {
    return { failure: 'a header of the request holds a character a header cannot carry, so no request is sent', resend: false, fix: keyFixFor(filled.keyName) };
  }
  const sent = await send(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) }, timeoutSeconds, filled);
  if ('failure' in sent) return sent;
  const { response, text } = sent;
  if (response.status < 200 || response.status > 299) {
    const status = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`;
    const message = errorMessage(text);
    return { failure: message === null ? status : `${status}: ${message}`, resend: response.status === 429 ? 'after-2s' : false, fix: statusFix(response.status, filled) };
  }
  try {
    return { body: JSON.parse(text) as unknown };
  } catch {
    return { failure: `HTTP ${response.status}, and the reply is no JSON`, resend: false, fix: `check that ${filled.base} is the address of the provider's API` };
  }
}

export async function get(url: string, timeoutSeconds: number, base: string): Promise<{ failure: string; fix: string } | { status: number }> {
  const sent = await send(url, { method: 'GET' }, timeoutSeconds, { base, keyName: null, seconds: timeoutSeconds });
  if ('failure' in sent) return { failure: sent.failure, fix: `start the server at ${base}, or set LAWCHECK_REVIEWER_ENDPOINT to the address where it runs` };
  return { status: sent.response.status };
}

function keyFixFor(name: string | null): string {
  return name === null ? 'take the character out of the header' : `set ${name} to the key alone, with no space or line break`;
}

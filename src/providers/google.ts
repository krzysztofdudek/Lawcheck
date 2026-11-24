import type { ReviewerConfig } from '../config.js';
import { post } from './http.js';
import { ownKey } from './index.js';
import type { Env } from './index.js';
import type { Provider } from '../provider.js';

const OWN_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

type Part = { text?: unknown; thought?: unknown };

export function google(config: ReviewerConfig, env: Env): Provider {
  const owned = ownKey(env, 'google', OWN_ENDPOINT, 'GOOGLE_API_KEY');
  const { problem, keyed } = owned;
  return {
    keys: owned.key === null ? [] : [owned.key],
    ready: () => problem,
    fix: () => owned.fix,
    async ask(prompt, seconds) {
      if (keyed === null) return { failure: 'google has no valid endpoint and key', resend: false, fix: owned.fix };
      const body = {
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: { temperature: config.temperature, responseMimeType: 'application/json' },
      };
      const url = `${keyed.url}/models/${encodeURIComponent(config.model ?? '')}:generateContent`;
      const posted = await post(url, { 'x-goog-api-key': keyed.key }, body, config.timeout, { base: owned.base, keyName: owned.keyName, seconds });
      if ('failure' in posted) return posted;
      const parts = (posted.body as { candidates?: { content?: { parts?: unknown } }[] } | null)?.candidates?.[0]?.content?.parts;
      if (!Array.isArray(parts)) return { answer: '' };
      const texts = parts
        .filter((part: Part): part is { text: string } => typeof part === 'object' && part !== null && typeof part.text === 'string' && part.thought !== true)
        .map((part) => part.text);
      return { answer: texts.join('') };
    },
  };
}

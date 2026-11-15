import type { ReviewerConfig } from '../config.js';
import { ownKey } from './index.js';
import type { Env, Provider } from './index.js';
import { chatCompletion } from './openai-compatible.js';

const OWN_ENDPOINT = 'https://api.openai.com/v1';

export function openai(config: ReviewerConfig, env: Env): Provider {
  const owned = ownKey(env, 'openai', OWN_ENDPOINT, 'OPENAI_API_KEY');
  const { problem, keyed } = owned;
  return {
    ready: () => problem,
    fix: () => owned.fix,
    async ask(prompt, seconds) {
      if (keyed === null) return { failure: 'openai has no valid endpoint and key', resend: false, fix: owned.fix };
      return chatCompletion(keyed.url, keyed.key, config, prompt, { base: owned.base, keyName: owned.keyName, seconds });
    },
  };
}

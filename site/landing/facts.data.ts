import { defineLoader } from 'vitepress';
import { facts, watched } from './facts.ts';
import type { Facts } from './facts.ts';

declare const data: Facts;
export { data };

export default defineLoader({
  watch: watched,
  load: () => facts(),
});

import { test } from 'node:test';
import { deadlineScenario } from '../acceptance/plugin-bench.ts';

test('test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships', async () => {
  await deadlineScenario(null, 'after 2 seconds');
});

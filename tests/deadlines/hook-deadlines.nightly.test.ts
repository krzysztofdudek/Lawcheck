import { test } from 'node:test';
import { deadlineScenario, startAndPromptScenario } from '../acceptance/plugin-bench.ts';

test('test 163: the deadline, and a hook that is stopped, at the deadlines the plugin ships', async () => {
  await deadlineScenario(null, 'after 2 seconds');
});

test('section 5: the session-start and prompt hooks each end at their own deadline, at the deadlines the plugin ships', async () => {
  await startAndPromptScenario(null);
});

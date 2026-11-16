import { test } from 'node:test';
import { hangScenario } from '../acceptance/rule-bench.ts';

test('test 24: a rule that hangs is stopped, at the limit the tool ships', async () => {
  await hangScenario(null);
});

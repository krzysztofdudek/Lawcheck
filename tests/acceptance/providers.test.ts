import { test } from 'node:test';
import { fakeWrites, LIMITS_VARIABLE, platformSkip } from '../harness/tool.ts';
import { CLAUDE_TIMEOUT_RUN_MS, FAKE_STARTED_MS, KILLED_GRACE_MS, LEFTOVER_GRACE_MS, TEST_RULE_MS, WINDOWS_KILLED_GRACE_MS } from '../numbers.ts';
import { LIMITS } from '../../dist/rules.js';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, gitAlone, openai, startFake, withFake, writeFakeClaude } from './fake-reviewer.ts';
import { alive, append, F, F_PATH, findingLines, lawcheckAt, pathWith, PROMPT_F, read, REVIEWER_CONFIG, REVIEWER_LAW, run, SECOND, startLawcheck, withCopy, withR, write } from './helpers.ts';
import type { Copy } from './helpers.ts';

const UNREACHABLE = 'src/core/refund.ts  error[reviewer-unreachable]  ';

function config(text: string) {
  return { onMain: (r: string) => write(r, '.lawcheck/config.yaml', text) };
}

function errorLine(stdout: string, prefix: string): string | undefined {
  return stdout.split('\n').find((line) => line.startsWith(prefix));
}

test('test 57: what the HTTP reviewer answers', async () => {
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('500'), result.stdout);
        assert.equal(fake.requests.length, 1);
      });
    },
    () => ({ status: 500, body: 'oops' }),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.stdout, SECOND.replace('1 reviewer call', '2 reviewer calls'));
        assert.equal(result.code, 1);
        assert.equal(fake.requests.length, 2);
        assert.ok(fake.requests[1]!.start - fake.requests[0]!.start >= 2000, `${fake.requests[1]!.start - fake.requests[0]!.start} ms`);
      });
    },
    (request) => (request.index === 0 ? { status: 429, body: '{}' } : openai(defaultAnswer(request.prompt))),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 2);
        const line = errorLine(result.stdout, UNREACHABLE);
        assert.ok(line?.includes('401') && line.includes('bad key'), result.stdout);
        assert.ok(result.stdout.includes('\nnext: check the key in LAWCHECK_REVIEWER_KEY, then run the same command again'), result.stdout);
        assert.equal(fake.requests.length, 1);
      });
    },
    () => ({ status: 401, body: '{"error":{"message":"bad key"}}' }),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
        assert.equal(fake.requests.length, 1);
      });
    },
    () => ({ status: 200, headers: { 'content-type': 'text/html' }, body: '<html><body>Sign in</body></html>' }),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
        assert.equal(fake.requests.length, 2);
      });
    },
    () => ({ close: true }),
  );
});

test('test 58: a request that passes reviewer.timeout is not sent again', async () => {
  await withFake(
    async (fake) => {
      await withR(
        async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--review', '--base', 'main']);
          assert.equal(result.code, 2);
          assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
          assert.ok(result.ms < 10_000, `${result.ms} ms`);
          assert.equal(fake.requests.length, 1);
        },
        config(REVIEWER_CONFIG + '  timeout: 1\n'),
      );
    },
    () => ({ hang: true }),
  );
});

test('test 59: the first error starts no new review, and what was answered is kept', async () => {
  await withFake(
    async (fake) => {
      await withR(
        async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--full', '--review', '--base', 'main']);
          assert.equal(result.code, 2);
          const errors = result.stdout.split('\n').filter((line) => line.includes('error[reviewer-unreachable]'));
          assert.equal(errors.length, 1, result.stdout);
          assert.ok(errors[0]!.startsWith(UNREACHABLE));
          assert.deepEqual(
            fake.requests.map((request) => request.prompt.match(/\n<file path="([^"]+)">/)![1]),
            ['src/core/price.ts', 'src/core/refund.ts'],
          );
          assert.equal(read(r, '.lawcheck/verdicts'), '04359891722bcd49bac46a26fbb25f2a clear-errors\n');
        },
        config(REVIEWER_CONFIG + '  parallel: 1\n'),
      );
    },
    (request) => (request.index === 0 ? openai('{"verdict":"pass","findings":[]}') : { status: 500, body: '' }),
  );
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 1, result.stdout);
        assert.deepEqual(
          fake.requests.map((request) => request.prompt.match(/\n<why>\n([^\n]+)\n/)![1]),
          ['A rule that sorts before clear-errors.', 'An error a caller sees says what happened and what to do next.'],
        );
      },
      {
        onMain: (r) => {
          write(r, '.lawcheck/config.yaml', REVIEWER_CONFIG + '  parallel: 1\n');
          write(r, '.lawcheck/law.yaml', REVIEWER_LAW.replace('\ntypes:\n', '  a-rule:\n    why: A rule that sorts before clear-errors.\n\ntypes:\n').replace('rules: [no-console, clear-errors]', 'rules: [no-console, clear-errors, a-rule]'));
          write(r, '.lawcheck/rules/a-rule.md', 'Report nothing.\n');
        },
      },
    );
  });
});

test('test 60: at most reviewer.parallel requests are in flight', async () => {
  const slow = (request: { prompt: string }) => ({ ...openai(defaultAnswer(request.prompt)), delayMs: 300 }) as never;
  const five = (r: string) => {
    for (const name of ['a', 'b', 'c', 'd', 'e']) write(r, `src/core/${name}.ts`, 'export const x = 1;\n');
  };
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        five(r);
        const result = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(result.code, 0, result.stdout);
        assert.equal(fake.requests.length, 5);
        assert.equal(fake.maxInFlight(), 2);
      },
      config(REVIEWER_CONFIG + '  parallel: 2\n'),
    );
  }, slow);
  await withFake(async (fake) => {
    await withR(async (r) => {
      five(r);
      const result = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(result.code, 0, result.stdout);
      assert.equal(fake.requests.length, 5);
      assert.equal(fake.maxInFlight(), 4);
    });
  }, slow);
});

test('test 61: the cap on calls', async () => {
  const three = (r: string) => {
    write(r, F_PATH, F);
    write(r, 'src/core/a.ts', 'export const x = 1;\n');
    write(r, 'src/core/b.ts', 'export const x = 1;\n');
  };
  await withFake(async (fake) => {
    await withR(async (r) => {
      three(r);
      const capped = await run(r, fake, ['--review', '--max-calls', '2', '--base', 'main']);
      assert.equal(capped.code, 2);
      const line = errorLine(capped.stdout, 'error[too-many-reviews]  ');
      assert.ok(line && /\b3\b/.test(line) && /\b2\b/.test(line), capped.stdout);
      assert.equal(fake.requests.length, 0);
    });
    await withR(async (r) => {
      three(r);
      const enough = await run(r, fake, ['--review', '--max-calls', '3', '--base', 'main']);
      assert.equal(enough.code, 1, enough.stdout);
      assert.equal(fake.requests.length, 3);
    });
  });
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        three(r);
        const capped = await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(capped.code, 2);
        assert.ok(errorLine(capped.stdout, 'error[too-many-reviews]  '), capped.stdout);
        assert.equal(fake.requests.length, 0);
        const plain = await run(r, fake, ['--base', 'main', '--json']);
        const document = JSON.parse(plain.stdout);
        assert.deepEqual(document.next, {
          command: null,
          text: "3 reviewer calls are needed and reviewer.max_calls is 2; raising the limit is the user's decision",
        });
        const raised = await run(r, fake, ['--review', '--max-calls', '3', '--base', 'main']);
        assert.equal(raised.code, 1, raised.stdout);
        assert.equal(fake.requests.length, 3);
      },
      config(REVIEWER_CONFIG + '  max_calls: 2\n'),
    );
  });
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--max-calls', '1', '--base', 'main']);
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, 'src/core/refund.ts  error[reviewer-bad-answer]  clear-errors'), result.stdout);
        assert.equal(fake.requests.length, 1);
      });
    },
    () => openai('fine'),
  );
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--max-calls', '1', '--base', 'main']);
        assert.equal(result.code, 2);
        assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('429'), result.stdout);
        assert.equal(fake.requests.length, 1);
      });
    },
    () => ({ status: 429, body: '{}' }),
  );
});

test('test 62: a prompt larger than reviewer.max_chars is never sent', async () => {
  const line = 'src/core/refund.ts  error[too-large-to-review]  the prompt for clear-errors holds 2127 characters; reviewer.max_chars is 2126';
  await withFake(async (fake) => {
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        for (const args of [['--base', 'main'], ['--review', '--base', 'main']]) {
          const result = await run(r, fake, args);
          assert.ok(findingLines(result.stdout).includes(line), result.stdout);
          assert.equal(result.code, 1);
        }
        assert.equal(fake.requests.length, 0);
      },
      config(REVIEWER_CONFIG + '  max_chars: 2126\n'),
    );
    await withR(
      async (r) => {
        write(r, F_PATH, F);
        await run(r, fake, ['--review', '--base', 'main']);
        assert.equal(fake.requests.length, 1);
      },
      config(REVIEWER_CONFIG + '  max_chars: 2127\n'),
    );
  });
});

test('test 63: no reviewer set', async () => {
  const noConfig = { onMain: (r: string) => rmSync(join(r, '.lawcheck/config.yaml')) };
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const plain = await run(r, fake, ['--base', 'main']);
      assert.ok(plain.stdout.endsWith('\nnext: ask the user to set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck check --review --base main\n'), plain.stdout);
      assert.equal(plain.code, 1);
      const reviewed = await run(r, fake, ['--review', '--base', 'main']);
      assert.ok(reviewed.stdout.split('\n').some((line) => line.startsWith('error[reviewer-not-configured]  ')), reviewed.stdout);
      assert.equal(reviewed.code, 2);
    }, noConfig);
    await withR(async (r) => {
      append(r, 'src/cli/main.ts', '// end\n');
      const reviewed = await run(r, fake, ['--review', '--base', 'main']);
      assert.equal(reviewed.code, 0, reviewed.stdout);
    }, noConfig);
    assert.equal(fake.requests.length, 0);
  });
});

test('test 64: the endpoint and the key come from the environment', async () => {
  await withFake(async (fake) => {
    for (const endpoint of [undefined, 'not a url', 'ftp://127.0.0.1/v1', `http://user:s3cr3t@${fake.url.slice('http://'.length)}`]) {
      await withR(async (r) => {
        write(r, F_PATH, F);
        for (const json of [[], ['--json']]) {
          const result = await run(r, null, ['--review', '--base', 'main', ...json], { LAWCHECK_REVIEWER_ENDPOINT: endpoint });
          const out = json.length > 0 ? JSON.parse(result.stdout).errors.map((e: { code: string; file: string | null }) => `${e.code} ${e.file}`) : result.stdout.split('\n');
          assert.ok(json.length > 0 ? out.includes('reviewer-unreachable null') : out.some((line: string) => line.startsWith('error[reviewer-unreachable]  ')), `${endpoint}: ${result.stdout}`);
          assert.ok(!(result.stdout + result.stderr).includes('s3cr3t'), result.stdout + result.stderr);
          assert.equal(result.code, 2);
        }
      });
    }
    assert.equal(fake.requests.length, 0);
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', OPENAI_API_KEY: 'k2', ANTHROPIC_API_KEY: 'k3' });
      assert.equal(result.code, 1, result.stdout);
      const headers = fake.requests[0]!.headers;
      assert.equal(headers.authorization, 'Bearer k1');
      const all = JSON.stringify(headers);
      assert.ok(!all.includes('k2') && !all.includes('k3'), all);
    });
  });
});

test('test 65: anthropic', async () => {
  const anthropicConfig = config('reviewer:\n  provider: anthropic\n  model: test-model\n');
  const speaks = (request: { path: string; prompt: string }) =>
    request.path === '/v1/messages' ? anthropic(defaultAnswer(request.prompt)) : { status: 404, body: '' };
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', ANTHROPIC_API_KEY: 'k3' });
      assert.equal(result.stdout, SECOND);
      assert.equal(result.code, 1);
      const request = fake.requests[0]!;
      assert.equal(request.path, '/v1/messages');
      assert.equal(request.headers['x-api-key'], 'k1');
      assert.equal(request.headers['anthropic-version'], '2023-06-01');
      assert.equal(request.headers['content-type'], 'application/json');
      assert.deepEqual(Object.keys(request.json), ['model', 'max_tokens', 'temperature', 'messages']);
      assert.equal(request.json.model, 'test-model');
      assert.equal(request.json.max_tokens, 8192);
      assert.equal(request.json.temperature, 0);
      assert.deepEqual(request.json.messages, [{ role: 'user', content: PROMPT_F }]);
      assert.ok(!JSON.stringify(request.headers).includes('k3'));
    }, anthropicConfig);
  }, speaks);
  await withFake(
    async (fake) => {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', ANTHROPIC_API_KEY: 'k3' });
        assert.equal(result.stdout, SECOND);
        assert.equal(result.code, 1);
      }, anthropicConfig);
    },
    (request) => {
      const answer = defaultAnswer(request.prompt);
      const cut = answer.indexOf('neither') + 3;
      return anthropic(answer.slice(0, cut), answer.slice(cut));
    },
  );
  const second = await startFake();
  try {
    await withFake(
      async (fake) => {
        await withR(async (r) => {
          write(r, F_PATH, F);
          const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1', ANTHROPIC_API_KEY: 'k3' });
          assert.equal(result.code, 2);
          assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes('307'), result.stdout);
          assert.equal(second.requests.length, 0);
        }, anthropicConfig);
      },
      () => ({ status: 307, headers: { location: `${second.url}/messages` }, body: '' }),
    );
  } finally {
    await second.close();
  }
  await withFake(async (fake) => {
    for (const env of [{ ANTHROPIC_API_KEY: 'k3' }, { LAWCHECK_REVIEWER_ENDPOINT: undefined }]) {
      await withR(async (r) => {
        write(r, F_PATH, F);
        const result = await run(r, fake, ['--review', '--base', 'main'], env);
        assert.ok(result.stdout.split('\n').some((line) => line.startsWith('error[reviewer-unreachable]  ')), result.stdout);
        assert.equal(result.code, 2);
      }, anthropicConfig);
    }
    assert.equal(fake.requests.length, 0);
  }, speaks);
});

const CLAUDE_ARGS = ['--print', '--output-format', 'json', '--model', 'test-model', '--tools', '', '--disable-slash-commands', '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--no-session-persistence'];

// A folder holding git and nothing else, so that no claude installed beside git is found: a link to git where links work, and git's own folder on Windows, where git needs its folder and claude installs elsewhere.
function claudeEnv(dir: string, mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const bin = writeFakeClaude(join(dir, 'bin'));
  fakeWrites(dir, ['record.json']);
  return { PATH: pathWith(bin), FAKE_CLAUDE_MODE: mode, FAKE_CLAUDE_RECORD: join(dir, 'record.json'), ...extra };
}

function record(dir: string) {
  return JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { args: string[]; cwd: string; listing: string[]; stdin: string; pid: number; child?: number };
}

const CLAUDE_CONFIG = 'reviewer:\n  provider: claude-code\n  model: test-model\n';

test('test 66: claude-code', async () => {
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'answer'));
    assert.equal(result.stdout, SECOND);
    assert.equal(result.code, 1);
    const seen = record(dir);
    assert.deepEqual(seen.args, CLAUDE_ARGS);
    assert.equal(seen.stdin, PROMPT_F);
    assert.deepEqual(seen.listing, []);
    assert.ok(!existsSync(seen.cwd), seen.cwd);
  }, config(CLAUDE_CONFIG));
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'answer'));
    assert.equal(result.code, 1, result.stdout);
    assert.deepEqual(record(dir).args, CLAUDE_ARGS.filter((arg) => arg !== '--model' && arg !== 'test-model'));
  }, config('reviewer:\n  provider: claude-code\n'));
  const failing: [string, string][] = [
    ['error', 'Not logged in'],
    ['boom', 'boom'],
  ];
  for (const [mode, text] of failing) {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, mode));
      assert.equal(result.code, 2);
      assert.ok(errorLine(result.stdout, UNREACHABLE)?.includes(text), `${mode}: ${result.stdout}`);
    }, config(CLAUDE_CONFIG));
  }
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'raw'));
    assert.equal(result.stdout, SECOND);
    assert.equal(result.code, 1);
  }, config(CLAUDE_CONFIG));
  await withR(async (r, dir) => {
    write(r, 'src/core/big.ts', '// filler\n'.repeat(7000));
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'expired'));
    assert.equal(result.code, 2);
    assert.ok(errorLine(result.stdout, 'src/core/big.ts  error[reviewer-unreachable]  ')?.includes('expired'), result.stdout);
    assert.ok(!result.stdout.includes('error[internal]'), result.stdout);
  }, config(CLAUDE_CONFIG + '  max_chars: 120000\n'));
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], { PATH: gitAlone(dir) });
    assert.ok(result.stdout.split('\n').includes('error[reviewer-unreachable]  claude-code cannot be called: the program claude is not on PATH'), result.stdout);
    assert.equal(result.code, 2);
  }, config(CLAUDE_CONFIG));
});

function survivors(seen: { pid: number; child?: number }): string {
  const left = `claude ${alive(seen.pid) ? 'alive' : 'gone'}, its child ${alive(seen.child!) ? 'alive' : 'gone'}`;
  if (process.platform !== 'win32') return left;
  const list = spawnSync('powershell.exe', ['-NoProfile', '-Command', "Get-CimInstance Win32_Process | Where-Object { $_.Name -in 'node.exe','cmd.exe','taskkill.exe' } | ForEach-Object { \"$($_.ProcessId) $($_.ParentProcessId) $($_.CommandLine)\" }"], { encoding: 'utf8' });
  return `${left}\n${list.stdout}`;
}

async function waitFor(condition: () => boolean, ms: number): Promise<boolean> {
  const until = Date.now() + ms;
  while (Date.now() < until) {
    if (condition()) return true;
    await new Promise((done) => setTimeout(done, 50));
  }
  return condition();
}

test('test 67: claude-code past its timeout, and the tool killed', async () => {
  const killedGrace = process.platform === 'win32' ? WINDOWS_KILLED_GRACE_MS : KILLED_GRACE_MS;
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'sleep'));
    assert.equal(result.code, 2);
    assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
    assert.ok(result.ms < CLAUDE_TIMEOUT_RUN_MS, `${result.ms} ms`);
    const seen = record(dir);
    assert.ok(await waitFor(() => !alive(seen.pid), LEFTOVER_GRACE_MS), 'the fake claude is alive');
    assert.ok(await waitFor(() => !alive(seen.child!), LEFTOVER_GRACE_MS), 'its child is alive');
  }, config(CLAUDE_CONFIG + '  timeout: 1\n'));
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const child = startLawcheck(r, ['check', '--review', '--base', 'main'], { env: claudeEnv(dir, 'sleep') });
    try {
      assert.ok(await waitFor(() => existsSync(join(dir, 'record.json')), FAKE_STARTED_MS), 'the fake claude started');
      const seen = record(dir);
      child.kill('SIGKILL');
      const killedAt = Date.now();
      assert.ok(await waitFor(() => !alive(seen.pid) && !alive(seen.child!), killedGrace), `both are gone: ${survivors(seen)}`);
      assert.ok(Date.now() - killedAt <= killedGrace);
      assert.ok(await waitFor(() => !existsSync(seen.cwd), killedGrace), `${seen.cwd} is left`);
      assert.equal((await child.ended).signal, 'SIGKILL');
    } finally {
      child.kill('SIGKILL');
    }
  }, config(CLAUDE_CONFIG));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      // A signal that the tool can catch ends it as stopped, exit 2 (docs/codes.md).
      const child = startLawcheck(r, ['check', '--review', '--base', 'main'], { env: claudeEnv(dir, 'sleep'), internal: true });
      try {
        assert.ok(await waitFor(() => existsSync(join(dir, 'record.json')), FAKE_STARTED_MS), 'the fake claude started');
        const seen = record(dir);
        child.kill(signal);
        const { code } = await child.ended;
        if (platformSkip('exit 2 after SIGTERM and SIGINT') === null) assert.equal(code, 2, signal);
        assert.ok(await waitFor(() => !alive(seen.pid) && !alive(seen.child!), killedGrace), `${signal}: both are gone`);
        assert.ok(await waitFor(() => !existsSync(seen.cwd), killedGrace), `${signal}: ${seen.cwd} is left`);
      } finally {
        child.kill('SIGKILL');
      }
    }, config(CLAUDE_CONFIG));
  }
});

// In this copy of the tool the guard writes each line the tool sends it, with the time it came, and lists nothing, and the tool starts the guard's list on every system: what the tool tells the guard on Windows shows everywhere, and a wait for the guard's list never ends by itself.
function silentGuard(copy: Copy, told: string): void {
  const rules = join(copy.dir, 'dist', 'rules.js');
  const sound = readFileSync(rules, 'utf8');
  const windowsOnly = "if (process.platform !== 'win32' || listing || !existsSync(tmpdir()))";
  assert.ok(sound.includes(windowsOnly));
  writeFileSync(rules, sound.replace(windowsOnly, 'if (listing || !existsSync(tmpdir()))'));
  writeFileSync(
    join(copy.dir, 'dist', 'guard.js'),
    `import { appendFileSync } from 'node:fs';\nlet pending = '';\nprocess.stdin.setEncoding('utf8');\nprocess.stdin.on('data', (chunk) => {\n  pending += chunk;\n  for (let end = pending.indexOf('\\n'); end >= 0; end = pending.indexOf('\\n')) {\n    appendFileSync(${JSON.stringify(told)}, Date.now() + ' ' + pending.slice(0, end) + '\\n');\n    pending = pending.slice(end + 1);\n  }\n});\n`,
  );
}

function toldToList(told: string): number | null {
  if (!existsSync(told)) return null;
  const line = readFileSync(told, 'utf8').split('\n').find((said) => said.endsWith(' +w'));
  return line === undefined ? null : Number(line.split(' ')[0]);
}

test('R-74: doctor tells the guard to start no list of processes, and a review tells it before its call', async () => {
  await withCopy(async (copy) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const told = join(dir, 'told.txt');
      fakeWrites(dir, ['told.txt']);
      silentGuard(copy, told);
      const env = claudeEnv(dir, 'answer');
      const doctor = await lawcheckAt(copy.cli, r, ['doctor', '--base', 'main'], env);
      assert.match(doctor.stdout, /claude-code can be called/);
      assert.equal(toldToList(told), null, existsSync(told) ? readFileSync(told, 'utf8') : '');
      const review = await lawcheckAt(copy.cli, r, ['check', '--review', '--base', 'main'], env);
      assert.equal(review.stdout, SECOND);
      assert.notEqual(toldToList(told), null);
    }, config(CLAUDE_CONFIG));
  });
});

// Longer than a start of the fake claude through cmd.exe on a loaded Windows runner, and shorter than the 10 seconds the tool waited for the guard's list before df614fb.
const UNLISTED_TIMEOUT_S = 8;

test('R-69: a call of a program reviewer waits for no list of the guard: with a guard that never lists, the program starts and answers within reviewer.timeout of the tool telling the guard to list', async () => {
  await withCopy(async (copy) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const told = join(dir, 'told.txt');
      fakeWrites(dir, ['told.txt']);
      silentGuard(copy, told);
      const review = await lawcheckAt(copy.cli, r, ['check', '--review', '--base', 'main'], claudeEnv(dir, 'answer'));
      assert.equal(review.stdout, SECOND);
      assert.equal(review.code, 1);
      const asked = toldToList(told);
      assert.notEqual(asked, null);
      const waited = (JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { at: number }).at - asked!;
      assert.ok(waited < UNLISTED_TIMEOUT_S * 1000, `claude started ${waited} ms after the tool told the guard to list`);
    }, config(CLAUDE_CONFIG + `  timeout: ${UNLISTED_TIMEOUT_S}\n`));
  });
});

test('R-88: the test entry of the tool refuses a limit as long as the one the tool ships, and no program the tool starts sees its variable', async () => {
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const env = claudeEnv(dir, 'answer');
    const refused = await startLawcheck(r, ['check', '--review', '--base', 'main'], { env, limits: { ruleMs: LIMITS.ruleMs }, stderr: `${LIMITS_VARIABLE} gives ruleMs ${LIMITS.ruleMs}, and a test limit is shorter than the shipped ${LIMITS.ruleMs}\n` }).ended;
    assert.equal(refused.code, 1);
    assert.equal(refused.stdout, '');
    assert.ok(!existsSync(join(dir, 'record.json')), 'the refused tool called claude');
    const result = await startLawcheck(r, ['check', '--review', '--base', 'main'], { env, limits: { ruleMs: TEST_RULE_MS } }).ended;
    assert.equal(result.stdout, SECOND);
    assert.equal(result.code, 1);
    const seen = JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { env: Record<string, string> };
    assert.ok(Object.keys(seen.env).length > 0);
    assert.equal(seen.env[LIMITS_VARIABLE], undefined);
  }, config(CLAUDE_CONFIG));
});

test('test 92: a connection that gave no answer names its cause', async () => {
  await withR(async (r) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9/v1' });
    const errors = result.stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
    assert.deepEqual(errors, ['src/core/refund.ts  error[reviewer-unreachable]  clear-errors: http://127.0.0.1:9/v1 names a port that fetch refuses to call (bad port)']);
    assert.doesNotMatch(result.stdout + result.stderr, /TypeError/);
    assert.equal(result.code, 2);
  });
});

test('test 93: a key an HTTP header cannot carry stops the run before any call', async () => {
  const expectRefused = (result: { stdout: string; stderr: string; code: number | null }, line: string, secrets: string[]) => {
    const errors = result.stdout.split('\n').filter((text) => /(^|  )error\[[a-z0-9-]+\]  /.test(text));
    assert.deepEqual(errors, [line], result.stdout);
    for (const secret of secrets) assert.ok(!(result.stdout + result.stderr).includes(secret), secret);
    assert.equal(result.code, 2);
  };
  await withFake(async (fake) => {
    await withR(async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, fake, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_KEY: 'k1\nk2' });
      expectRefused(result, 'error[reviewer-unreachable]  openai-compatible cannot be called: LAWCHECK_REVIEWER_KEY holds a character an HTTP header cannot carry', ['k1', 'k2']);
      assert.equal(fake.requests.length, 0);
    });
  });
  await withR(
    async (r) => {
      write(r, F_PATH, F);
      const result = await run(r, null, ['--review', '--base', 'main'], { ANTHROPIC_API_KEY: 'k3\tk4' });
      expectRefused(result, 'error[reviewer-unreachable]  anthropic cannot be called: ANTHROPIC_API_KEY holds a character an HTTP header cannot carry', ['k3', 'k4']);
    },
    config('reviewer:\n  provider: anthropic\n  model: test-model\n'),
  );
});

import { test } from 'node:test';
import { fakeWrites, LIMITS_VARIABLE, platformSkip } from '../harness/tool.ts';
import { CLAUDE_TIMEOUT_RUN_MS, FAKE_STARTED_MS, KILLED_GRACE_MS, LEFTOVER_GRACE_MS, TEST_RULE_MS, WINDOWS_KILLED_GRACE_MS } from '../numbers.ts';
import { LIMITS } from '../../dist/rules.js';
import { killGroup, powershell } from '../../dist/programs.js';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
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
  return JSON.parse(readFileSync(join(dir, 'record.json'), 'utf8')) as { at: number; args: string[]; cwd: string; listing: string[]; stdin: string; pid: number; child?: number };
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
  const rules = join(copy.dir, 'dist', 'programs.js');
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
      const asked = toldToList(told);
      assert.notEqual(asked, null);
      assert.ok(asked! <= record(dir).at, `the tool told the guard at ${asked}, after claude started at ${record(dir).at}`);
    }, config(CLAUDE_CONFIG));
  });
});

// Longer than a start of the fake claude through cmd.exe on a loaded Windows runner, and shorter than the 10 seconds the tool waited for the guard's list before df614fb.
const UNLISTED_TIMEOUT_S = 8;
// The timeout above counts from the call, so a wait before it shows only in the time from the tool's telling to the fake's start, which takes some hundreds of milliseconds.
const UNLISTED_START_MS = 3_000;

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
      const waited = record(dir).at - asked!;
      assert.ok(waited < UNLISTED_START_MS, `claude started ${waited} ms after the tool told the guard to list`);
    }, config(CLAUDE_CONFIG + `  timeout: ${UNLISTED_TIMEOUT_S}\n`));
  });
});

// Each script prints the id of the program it starts. holder.mjs stays running with its child below it; leave.mjs ends and leaves its child running, detached, as cmd.exe leaves what it started on Windows.
const HOLDER = "import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });\nprocess.stdout.write(String(c.pid) + '\\n');\nsetInterval(() => {}, 1000);\n";
const LEAVE = "import { spawn } from 'node:child_process';\nconst c = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: true });\nc.unref();\nprocess.stdout.write(String(c.pid) + '\\n');\n";

async function startScript(dir: string, name: string, text: string, ends: boolean): Promise<{ pid: number; child: number }> {
  writeFileSync(join(dir, name), text);
  const parent = spawn(process.execPath, [join(dir, name)], { stdio: ['ignore', 'pipe', 'ignore'], windowsHide: true });
  const closed = new Promise((done) => parent.on('close', done));
  const child = await new Promise<number>((done) => parent.stdout!.setEncoding('utf8').once('data', (line: string) => done(Number(line.trim()))));
  if (ends) await closed;
  return { pid: parent.pid!, child };
}

// The guard may wait 10 seconds for its list and then take one itself, which PowerShell gave up to 6.2 seconds after its start on a Windows runner.
const GUARD_ENDS_MS = 30_000;

test('test 1008: on Windows the guard of a killed tool ends what a root left, and leaves alive a process that holds a root\'s id and the child of an older process whose parent id is a root\'s, whether its list of processes comes in time or not', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  for (const late of [false, true]) {
    await withCopy(async (copy) => {
      const guardFile = join(copy.dir, 'dist', 'guard.js');
      const waited = /listSince\(learned, \w+\)/;
      const sound = readFileSync(guardFile, 'utf8');
      assert.ok(waited.test(sound), 'the guard has no listSince(learned, …) for this test to cut short');
      if (late) writeFileSync(guardFile, sound.replace(waited, 'listSince(learned, 0)'));
      const left: number[] = [];
      try {
        // Both made before the guard, so neither is the tool's: Windows gave the id of a root that has ended to stranger, and older's child kept the id of a parent that ended before a root took it.
        const stranger = await startScript(copy.dir, 'holder.mjs', HOLDER, false);
        left.push(stranger.pid, stranger.child);
        const older = await startScript(copy.dir, 'older.mjs', LEAVE, true);
        left.push(older.child);
        const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
        let exited = false;
        guard.on('exit', () => (exited = true));
        const root = await startScript(copy.dir, 'root.mjs', LEAVE, true);
        left.push(root.child);
        guard.stdin!.end(`+g${stranger.pid}\n+g${older.pid}\n+g${root.pid}\n`);
        assert.ok(await waitFor(() => exited, GUARD_ENDS_MS), `late ${late}: the guard is still running`);
        assert.ok(await waitFor(() => !alive(root.child), LEFTOVER_GRACE_MS), `late ${late}: the child the root left is alive`);
        assert.ok(alive(stranger.pid), `late ${late}: the process that holds a root's id was ended`);
        assert.ok(alive(stranger.child), `late ${late}: the child of the process that holds a root's id was ended`);
        assert.ok(alive(older.child), `late ${late}: the child of an older process whose parent id is a root's was ended`);
      } finally {
        for (const pid of left) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already ended.
          }
        }
      }
    });
  }
});

const IDLE = "setInterval(() => {}, 1000)";

test('test 1010: on Windows the guard of a killed tool stops its own PowerShell that hangs, ends within a bound and removes the folders it was told of', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const waited = /listSince\(learned, \w+\)/;
    const listing = "spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE]";
    const sound = readFileSync(guardFile, 'utf8');
    assert.ok(waited.test(sound) && sound.includes(listing), 'the guard has no listSince(learned, …) to cut short or no list of its own to replace');
    // The watcher gives no list in time, and the guard's own list is a program that never answers.
    writeFileSync(guardFile, sound.replace(waited, 'listSince(learned, 0)').replace(listing, `spawnSync(process.execPath, ['-e', '${IDLE}']`));
    const folder = join(copy.dir, 'call folder');
    mkdirSync(folder);
    const idle = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true });
    const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    let exited = false;
    guard.on('exit', () => (exited = true));
    try {
      guard.stdin!.end(`+g${idle.pid}\n+d${folder}\n`);
      assert.ok(await waitFor(() => exited, GUARD_ENDS_MS), 'the guard is still running');
      assert.ok(!existsSync(folder), 'the call\'s folder is still there');
      assert.ok(alive(idle.pid!), 'a process of the tool was ended from no list');
    } finally {
      // A guard still running holds the copy, which then cannot be removed, and keeps this file from ending; the program it waits on holds the copy too.
      if (!exited) {
        killGroup(guard.pid!, 'SIGKILL');
        await waitFor(() => exited, LEFTOVER_GRACE_MS);
      }
      idle.kill('SIGKILL');
    }
  });
});

test('test 1011: on Windows the guard of a killed tool leaves alive a process that holds the id of a rule runner, with a list of processes that does not show the runner', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    // The runner ended with the tool, and a process that started before the guard's list holds its id now.
    const stranger = await startScript(copy.dir, 'holder.mjs', HOLDER, false);
    try {
      const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
      let exited = false;
      guard.on('exit', () => (exited = true));
      guard.stdin!.end(`+${stranger.pid}\n`);
      assert.ok(await waitFor(() => exited, GUARD_ENDS_MS), 'the guard is still running');
      assert.ok(alive(stranger.pid), 'the process that holds the runner\'s id was ended');
      assert.ok(alive(stranger.child), 'the child of the process that holds the runner\'s id was ended');
    } finally {
      for (const pid of [stranger.pid, stranger.child]) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already ended.
        }
      }
    }
  });
});

test('test 1054: on Windows the guard of a killed tool that called no program reviewer takes no list of processes', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const listing = "spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE]";
    const sound = readFileSync(guardFile, 'utf8');
    assert.ok(sound.includes(listing), 'the guard has no list of its own to replace');
    const listed = join(copy.dir, 'listed');
    // The guard's own list only leaves a mark that it was taken.
    writeFileSync(guardFile, sound.replace(listing, `spawnSync(process.execPath, ['-e', ${JSON.stringify(`require('node:fs').writeFileSync(${JSON.stringify(listed)}, '')`)}]`));
    const runner = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true });
    const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    let exited = false;
    guard.on('exit', () => (exited = true));
    try {
      guard.stdin!.end(`+${runner.pid}\n`);
      assert.ok(await waitFor(() => exited, GUARD_ENDS_MS), 'the guard is still running');
      assert.ok(!existsSync(listed), 'the guard took a list of processes for a run that had only rule runners');
      assert.ok(alive(runner.pid!), 'the guard ended a process by a rule runner\'s id');
    } finally {
      if (!exited) {
        killGroup(guard.pid!, 'SIGKILL');
        await waitFor(() => exited, LEFTOVER_GRACE_MS);
      }
      runner.kill('SIGKILL');
    }
  });
});

test('test 1055: on Windows the guard of a killed tool whose watcher gives no list and whose own list hangs removes the call\'s folders within WINDOWS_KILLED_GRACE_MS of the kill', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const watching = "watcher = spawn(powershell(), ['-NoProfile', '-NonInteractive', '-Command', ";
    const listing = "spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', PROCESS_TABLE]";
    const sound = readFileSync(guardFile, 'utf8');
    assert.ok(sound.includes(watching) && sound.includes(listing), 'the guard has no watcher or no list of its own to replace');
    // Neither the watcher nor the guard's own list ever answers, so the guard waits out both of its limits.
    writeFileSync(guardFile, sound.replace(watching, `watcher = spawn(process.execPath, ['-e', '${IDLE}', `).replace(listing, `spawnSync(process.execPath, ['-e', '${IDLE}']`));
    const folder = join(copy.dir, 'call folder');
    mkdirSync(folder);
    const idle = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true });
    const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    let exited = false;
    guard.on('exit', () => (exited = true));
    try {
      const killed = Date.now();
      guard.stdin!.end(`+g${idle.pid}\n+d${folder}\n`);
      assert.ok(await waitFor(() => !existsSync(folder), WINDOWS_KILLED_GRACE_MS), `the call's folder is still there ${WINDOWS_KILLED_GRACE_MS} ms after the kill`);
      assert.ok(Date.now() - killed <= WINDOWS_KILLED_GRACE_MS, `the call's folder was removed ${Date.now() - killed} ms after the kill`);
    } finally {
      if (!exited) {
        killGroup(guard.pid!, 'SIGKILL');
        await waitFor(() => exited, LEFTOVER_GRACE_MS);
      }
      idle.kill('SIGKILL');
    }
  });
});

test('test 1056: on Windows a guard removes the folder that a killed guard made for its PowerShell, and keeps the folder of a guard that runs', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const local = join(copy.dir, 'local');
    const temp = join(local, 'Temp');
    mkdirSync(temp, { recursive: true });
    const env: NodeJS.ProcessEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => name.toUpperCase() !== 'LOCALAPPDATA'));
    env.LOCALAPPDATA = local;
    const made = () => readdirSync(temp).filter((name) => name.startsWith('lawcheck-guard-'));
    const guards: { child: ReturnType<typeof spawn>; exited: boolean }[] = [];
    const start = (listing = true) => {
      const child = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), env, stdio: ['pipe', 'ignore', 'ignore'], detached: true });
      const guard = { child, exited: false };
      child.on('exit', () => (guard.exited = true));
      guards.push(guard);
      // The tool is about to call a program, so the guard starts its PowerShell.
      if (listing) child.stdin!.write('+w\n');
      return guard;
    };
    const of = (pid: number) => made().filter((name) => name.startsWith(`lawcheck-guard-${pid}-`));
    const stranger = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore', windowsHide: true });
    try {
      const killed = start();
      assert.ok(await waitFor(() => made().length === 1, GUARD_ENDS_MS), 'the guard made no folder for its PowerShell');
      const [left] = made();
      killed.child.kill('SIGKILL');
      assert.ok(await waitFor(() => killed.exited, LEFTOVER_GRACE_MS), 'the killed guard is still running');
      assert.ok(existsSync(join(temp, left!)), 'the killed guard removed its folder');
      const later = start();
      assert.ok(await waitFor(() => !made().includes(left!), GUARD_ENDS_MS), 'the folder of the killed guard is still there');
      assert.equal(made().length, 1, `the folder of the guard that runs is not the one left: ${made().join(', ')}`);
      later.child.stdin!.end();
      assert.ok(await waitFor(() => later.exited, GUARD_ENDS_MS), 'the later guard is still running');
      assert.deepEqual(made(), [], 'the later guard left its own folder');
      // Windows gives an ended guard's id to a new process: to a process that is no guard, or to the next guard.
      const held = join(temp, `lawcheck-guard-${stranger.pid}-left`);
      mkdirSync(held);
      const running = start();
      assert.ok(await waitFor(() => of(running.child.pid!).length === 1, GUARD_ENDS_MS), 'the running guard made no folder for its PowerShell');
      const next = start(false);
      const earlier = join(temp, `lawcheck-guard-${next.child.pid}-left`);
      mkdirSync(earlier);
      next.child.stdin!.write('+w\n');
      assert.ok(await waitFor(() => of(next.child.pid!).length === 1 && !existsSync(earlier), GUARD_ENDS_MS), `the folder an earlier holder of the guard's id left is still there: ${made().join(', ')}`);
      assert.equal(of(running.child.pid!).length, 1, 'a guard removed the folder of a guard that runs');
      assert.ok(existsSync(held), 'a guard removed a folder whose id a process that runs holds');
      next.child.stdin!.end();
      running.child.stdin!.end();
      assert.ok(await waitFor(() => next.exited && running.exited, GUARD_ENDS_MS), 'a guard that was told the tool ended is still running');
      rmSync(held, { recursive: true });
      assert.deepEqual(made(), [], 'a guard left its own folder');
    } finally {
      for (const guard of guards) {
        if (guard.exited) continue;
        killGroup(guard.child.pid!, 'SIGKILL');
        await waitFor(() => guard.exited, LEFTOVER_GRACE_MS);
      }
      stranger.kill('SIGKILL');
    }
  });
});

test('test 1057: outside Windows the guard of a killed tool ends a rule runner by its id when an earlier runner that had the same id was released after the later one started', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const runner = spawn(process.execPath, ['-e', IDLE], { stdio: 'ignore' });
    const guard = spawn(process.execPath, [guardFile], { cwd: dirname(guardFile), stdio: ['pipe', 'ignore', 'ignore'], detached: true });
    try {
      // The earlier runner ended, the later one got its id, and only then was the earlier one released.
      guard.stdin!.end(`+${runner.pid}\n+${runner.pid}\n-${runner.pid}\n`);
      assert.ok(await waitFor(() => !alive(runner.pid!), GUARD_ENDS_MS), 'the later runner is alive');
    } finally {
      guard.kill('SIGKILL');
      runner.kill('SIGKILL');
    }
  });
});

// The tool's side of a program call, without the call: it starts the guard and its list as before a call, then tells the guard of each program it is given, with the time that program was started.
const TOOL = "import { startListing, watchGroup } from './dist/programs.js';\nstartListing();\nprocess.stdout.write('ready\\n');\nlet pending = '';\nprocess.stdin.setEncoding('utf8').on('data', (chunk) => {\n  pending += chunk;\n  for (let end = pending.indexOf('\\n'); end >= 0; end = pending.indexOf('\\n')) {\n    const [pid, started] = pending.slice(0, end).split(' ').map(Number);\n    pending = pending.slice(end + 1);\n    watchGroup(pid, started);\n    process.stdout.write('told\\n');\n  }\n});\n";

test('test 1045: on Windows the guard of a tool killed before its first list of processes ends what a program left, and leaves alive the child that an older holder of the program\'s id made after the guard started', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const guardFile = join(copy.dir, 'dist', 'guard.js');
    const earlier = 'const before = table;';
    const sound = readFileSync(guardFile, 'utf8');
    assert.ok(sound.includes(earlier), 'the guard has no earlier list for this test to empty');
    // The tool is killed before the guard's first list, so the guard has no earlier list.
    writeFileSync(guardFile, sound.replace(earlier, "const before = '';"));
    writeFileSync(join(copy.dir, 'tool.mjs'), TOOL);
    const left: number[] = [];
    const tool = spawn(process.execPath, [join(copy.dir, 'tool.mjs')], { cwd: copy.dir, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    try {
      const said: string[] = [];
      tool.stdout!.setEncoding('utf8').on('data', (chunk: string) => said.push(...chunk.split('\n').filter(Boolean)));
      assert.ok(await waitFor(() => said.includes('ready'), GUARD_ENDS_MS), 'the tool did not start its guard');
      // older held an id after the guard started, left a child below it and ended; the program the tool started next took that id.
      const older = await startScript(copy.dir, 'older.mjs', LEAVE, true);
      left.push(older.child);
      const started = Date.now();
      const program = await startScript(copy.dir, 'program.mjs', LEAVE, true);
      left.push(program.child);
      tool.stdin!.write(`${older.pid} ${started}\n${program.pid} ${started}\n`);
      assert.ok(await waitFor(() => said.filter((line) => line === 'told').length === 2, GUARD_ENDS_MS), 'the tool did not tell its guard');
      tool.kill('SIGKILL');
      assert.ok(await waitFor(() => !alive(program.child), GUARD_ENDS_MS), 'the child the program left is alive');
      assert.ok(!(await waitFor(() => !alive(older.child), LEFTOVER_GRACE_MS)), 'the child an older holder of the program\'s id made after the guard started was ended');
    } finally {
      tool.kill('SIGKILL');
      for (const pid of left) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already ended.
        }
      }
    }
  });
});

test('test 1046: on Windows a program call that ends normally ends nothing by the program\'s id once the program has ended, so a process given that id is left alive with its child', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const stranger = await startScript(copy.dir, 'holder.mjs', HOLDER, false);
      try {
        const rules = join(copy.dir, 'dist', 'programs.js');
        const tree = 'export function killTree(pid, signal, orphans = false) {';
        const sound = readFileSync(rules, 'utf8');
        assert.ok(sound.includes(tree), 'programs.js has no killTree for this test to point at the stranger');
        // Once a process has ended, its id is the stranger's, as when Windows has given it to a new process.
        writeFileSync(rules, sound.replace(tree, `${tree}\n  try {\n    process.kill(pid, 0);\n  } catch {\n    pid = ${stranger.pid};\n  }`));
        const result = await lawcheckAt(copy.cli, r, ['check', '--review', '--base', 'main'], claudeEnv(dir, 'answer'));
        assert.equal(result.stdout, SECOND);
        assert.equal(result.code, 1);
        assert.ok(alive(stranger.pid), 'the process given the program\'s id was ended');
        assert.ok(alive(stranger.child), 'the child of the process given the program\'s id was ended');
      } finally {
        for (const pid of [stranger.pid, stranger.child]) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already ended.
          }
        }
      }
    }, config(CLAUDE_CONFIG));
  });
});

// PowerShell, held to the first processor with everything it starts, starts older, which makes a child and ends, and then a program that keeps running again and again until Windows gives one older's id. Windows keeps a list of free ids for each processor, and an ended process's id goes back to the list of the processor that freed it. PowerShell keeps a handle on every program it ends, so their ids stay taken. It writes older's id, older's child, the program that took the id and how many programs it started to a file, since that program would hold an output of PowerShell open for as long as it runs.
function reuse(older: string, out: string): string {
  const ping = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'PING.EXE');
  return `[System.Diagnostics.Process]::GetCurrentProcess().ProcessorAffinity = [IntPtr]1; $o = New-Object System.Diagnostics.ProcessStartInfo '${process.execPath}', '"${older}"'; $o.UseShellExecute = $false; $o.CreateNoWindow = $true; $o.RedirectStandardOutput = $true; $h = [System.Diagnostics.Process]::Start($o); $child = $h.StandardOutput.ReadLine(); $h.WaitForExit(); $target = $h.Id; $h.Dispose(); $psi = New-Object System.Diagnostics.ProcessStartInfo '${ping}', '-n 120 127.0.0.1'; $psi.UseShellExecute = $false; $psi.CreateNoWindow = $true; $kept = New-Object System.Collections.ArrayList; $end = (Get-Date).AddSeconds(${REUSE_S}); $n = 0; while ((Get-Date) -lt $end) { $p = [System.Diagnostics.Process]::Start($psi); $n++; if ($p.Id -eq $target) { Set-Content -LiteralPath '${out}' -Value "$target $child $($p.Id) $n"; exit 0 }; $p.Kill(); [void]$kept.Add($p) }; Set-Content -LiteralPath '${out}' -Value "missed $target after $n programs, the last $(($kept | Select-Object -Last 3 | ForEach-Object { $_.Id }) -join ' ')"; try { Stop-Process -Id $child -Force } catch {}; exit 1`;
}

const REUSE_S = 50;

test('test 1048: on Windows the tool that ends a running program\'s tree leaves alive the child an earlier holder of the program\'s id made before the program', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    const left: number[] = [];
    try {
      // older made its child and ended, and the child keeps older's id as its parent's.
      writeFileSync(join(copy.dir, 'older.mjs'), LEAVE);
      const out = join(copy.dir, 'reused.txt');
      const found = spawnSync(powershell(), ['-NoProfile', '-NonInteractive', '-Command', reuse(join(copy.dir, 'older.mjs'), out)], { stdio: 'ignore', windowsHide: true, timeout: (REUSE_S + 20) * 1000 });
      const said = existsSync(out) ? readFileSync(out, 'utf8').trim() : '';
      assert.ok(found.status === 0 && found.error === undefined, `no program was given the id of older: ${found.error?.message ?? `exit ${found.status}`}, ${said}`);
      const [, child, program, tries] = said.split(' ').map(Number);
      t.diagnostic(`older's id went to the program started ${tries}th`);
      left.push(child!, program!);
      assert.ok(alive(program!) && alive(child!), 'the program given older\'s id, or older\'s child, is not running');
      assert.ok(killGroup(program!, 'SIGKILL', true), 'the running program was not ended');
      assert.ok(await waitFor(() => !alive(program!), LEFTOVER_GRACE_MS), 'the running program is alive');
      assert.ok(!(await waitFor(() => !alive(child!), LEFTOVER_GRACE_MS)), 'the child older made before the program took its id was ended');
    } finally {
      for (const pid of left) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already ended.
        }
      }
    }
  });
});

// A process group of its own: the program and the child it made, which stays in the program's group.
async function startGroup(dir: string, name: string, text: string): Promise<{ pid: number; child: number }> {
  writeFileSync(join(dir, name), text);
  const leader = spawn(process.execPath, [join(dir, name)], { stdio: ['ignore', 'pipe', 'ignore'], detached: true, windowsHide: true });
  leader.unref();
  const child = await new Promise<number>((done) => leader.stdout!.setEncoding('utf8').once('data', (line: string) => done(Number(line.trim()))));
  (leader.stdout as unknown as { unref(): void }).unref();
  return { pid: leader.pid!, child };
}

test('test 1049: a program call that ends normally ends its process group no later than when the tool sees the program end, so a group given the number after that is left alive', async (t) => {
  const skip = platformSkip('the whole test');
  if (skip !== null) return t.skip(skip);
  await withCopy(async (copy) => {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const stranger = await startGroup(copy.dir, 'holder.mjs', HOLDER);
      try {
        const rules = join(copy.dir, 'dist', 'programs.js');
        const group = /\n\s*try \{\n\s*process\.kill\(-pid, signal\);/;
        const sound = readFileSync(rules, 'utf8');
        assert.ok(group.test(sound), 'programs.js has no kill of a process group for this test to point at the stranger');
        // The system gives a group's number to a new process only once no process of the group is left, and at the earliest some time after: the first look that finds the group empty is the moment the tool sees the program end, and from then on the number is the stranger's group.
        writeFileSync(rules, sound.replace(group, (kill) => `\nif (globalThis.emptied?.has(pid)) pid = ${stranger.pid};\nelse {\n  try {\n    process.kill(-pid, 0);\n  } catch {\n    (globalThis.emptied ??= new Set()).add(pid);\n  }\n}${kill}`));
        const result = await lawcheckAt(copy.cli, r, ['check', '--review', '--base', 'main'], claudeEnv(dir, 'answer'));
        assert.equal(result.stdout, SECOND);
        assert.equal(result.code, 1);
        assert.ok(alive(stranger.pid), 'the group given the program\'s number was ended');
        assert.ok(alive(stranger.child), 'the child in the group given the program\'s number was ended');
      } finally {
        for (const pid of [stranger.pid, stranger.child]) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // Already ended.
          }
        }
      }
    }, config(CLAUDE_CONFIG));
  });
});

// The tool's side of two program calls that got the same id: the earlier call's program has ended, the later call's program runs, and the earlier call is released after the later call was told to the guard.
const TWICE = "import { releaseGroup, startListing, watchGroup } from './dist/programs.js';\nstartListing();\nprocess.stdout.write('ready\\n');\nlet pending = '';\nprocess.stdin.setEncoding('utf8').on('data', (chunk) => {\n  pending += chunk;\n  for (let end = pending.indexOf('\\n'); end >= 0; end = pending.indexOf('\\n')) {\n    const [pid, started] = pending.slice(0, end).split(' ').map(Number);\n    pending = pending.slice(end + 1);\n    watchGroup(pid, started - 1, () => false);\n    watchGroup(pid, started);\n    releaseGroup(pid, false, started - 1);\n    process.stdout.write('told\\n');\n  }\n});\n";

test('test 1050: two program calls that get the same id each keep their own entry in the guard: the release of the earlier one neither ends the later one\'s program nor takes it from the guard of a killed tool', async () => {
  await withCopy(async (copy) => {
    writeFileSync(join(copy.dir, 'tool.mjs'), TWICE);
    const left: number[] = [];
    const tool = spawn(process.execPath, [join(copy.dir, 'tool.mjs')], { cwd: copy.dir, stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
    try {
      const said: string[] = [];
      tool.stdout!.setEncoding('utf8').on('data', (chunk: string) => said.push(...chunk.split('\n').filter(Boolean)));
      assert.ok(await waitFor(() => said.includes('ready'), GUARD_ENDS_MS), 'the tool did not start its guard');
      const started = Date.now();
      const program = await startGroup(copy.dir, 'program.mjs', HOLDER);
      left.push(program.pid, program.child);
      tool.stdin!.write(`${program.pid} ${started}\n`);
      assert.ok(await waitFor(() => said.includes('told'), GUARD_ENDS_MS), 'the tool did not tell its guard');
      assert.ok(!(await waitFor(() => !alive(program.pid) || !alive(program.child), LEFTOVER_GRACE_MS)), 'the release of the earlier call ended the later call\'s program');
      tool.kill('SIGKILL');
      assert.ok(await waitFor(() => !alive(program.pid), GUARD_ENDS_MS), 'the guard of the killed tool left the later call\'s program alive');
      assert.ok(await waitFor(() => !alive(program.child), GUARD_ENDS_MS), 'the guard of the killed tool left the later call\'s child alive');
    } finally {
      tool.kill('SIGKILL');
      for (const pid of left) {
        try {
          process.kill(pid, 'SIGKILL');
        } catch {
          // Already ended.
        }
      }
    }
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

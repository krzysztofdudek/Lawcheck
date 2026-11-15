import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { anthropic, defaultAnswer, openai, startFake, withFake, writeFakeClaude } from './fake-reviewer.ts';
import { alive, append, CLI, F, F_PATH, findingLines, GIT_ENV, pathWith, programDir, PROMPT_F, read, REVIEWER_CONFIG, REVIEWER_LAW, run, SECOND, withR, write } from './helpers.ts';

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
          assert.equal(read(r, '.lawcheck/verdicts'), '60f0a1a7ad3b74bcd40957cc8de73d1b clear-errors\n');
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
      assert.ok(plain.stdout.endsWith('\nnext: set reviewer.provider and reviewer.model in .lawcheck/config.yaml, then run lawcheck check --review --base main\n'), plain.stdout);
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

function claudeEnv(dir: string, mode: string, extra: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  const bin = writeFakeClaude(join(dir, 'bin'));
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
  const gitDir = programDir('git');
  if (existsSync(join(gitDir, 'claude')) || existsSync(join(gitDir, 'claude.cmd')) || existsSync(join(gitDir, 'claude.exe'))) return;
  await withR(async (r) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], { PATH: gitDir });
    assert.ok(result.stdout.split('\n').some((line) => line.startsWith('error[reviewer-unreachable]  ')), result.stdout);
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
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], claudeEnv(dir, 'sleep'));
    assert.equal(result.code, 2);
    assert.ok(errorLine(result.stdout, UNREACHABLE), result.stdout);
    assert.ok(result.ms < 15_000, `${result.ms} ms`);
    const seen = record(dir);
    assert.ok(await waitFor(() => !alive(seen.pid), 2000), 'the fake claude is alive');
    assert.ok(await waitFor(() => !alive(seen.child!), 2000), 'its child is alive');
  }, config(CLAUDE_CONFIG + '  timeout: 1\n'));
  await withR(async (r, dir) => {
    write(r, F_PATH, F);
    const child = spawn(process.execPath, [CLI, 'check', '--review', '--base', 'main'], {
      cwd: r,
      env: { ...GIT_ENV, ...claudeEnv(dir, 'sleep') },
      stdio: 'ignore',
    });
    try {
      assert.ok(await waitFor(() => existsSync(join(dir, 'record.json')), 20_000), 'the fake claude started');
      const seen = record(dir);
      child.kill('SIGKILL');
      const killedAt = Date.now();
      assert.ok(await waitFor(() => !alive(seen.pid) && !alive(seen.child!), 5000), `both are gone: ${survivors(seen)}`);
      assert.ok(Date.now() - killedAt <= 5000);
      assert.ok(await waitFor(() => !existsSync(seen.cwd), 5000), `${seen.cwd} is left`);
    } finally {
      child.kill('SIGKILL');
    }
  }, config(CLAUDE_CONFIG));
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    await withR(async (r, dir) => {
      write(r, F_PATH, F);
      const child = spawn(process.execPath, [CLI, 'check', '--review', '--base', 'main'], {
        cwd: r,
        env: { ...GIT_ENV, ...claudeEnv(dir, 'sleep') },
        stdio: 'ignore',
      });
      try {
        assert.ok(await waitFor(() => existsSync(join(dir, 'record.json')), 20_000), 'the fake claude started');
        const seen = record(dir);
        const ended = new Promise<number | null>((done) => child.on('exit', (code) => done(code)));
        child.kill(signal);
        const code = await ended;
        // On Windows every signal ends a process at once, so the tool cannot answer it with its own exit code.
        if (process.platform !== 'win32') assert.equal(code, 2, signal);
        assert.ok(await waitFor(() => !alive(seen.pid) && !alive(seen.child!), 5000), `${signal}: both are gone`);
        assert.ok(await waitFor(() => !existsSync(seen.cwd), 5000), `${signal}: ${seen.cwd} is left`);
      } finally {
        child.kill('SIGKILL');
      }
    }, config(CLAUDE_CONFIG));
  }
});

test('test 92: a connection that gave no answer names its cause', async () => {
  await withR(async (r) => {
    write(r, F_PATH, F);
    const result = await run(r, null, ['--review', '--base', 'main'], { LAWCHECK_REVIEWER_ENDPOINT: 'http://127.0.0.1:9/v1' });
    const errors = result.stdout.split('\n').filter((line) => /(^|  )error\[[a-z0-9-]+\]  /.test(line));
    assert.deepEqual(errors, ['src/core/refund.ts  error[reviewer-unreachable]  clear-errors: the connection to the reviewer gave no answer (bad port)']);
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

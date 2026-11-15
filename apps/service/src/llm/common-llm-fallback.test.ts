import assert from 'node:assert/strict';
import test from 'node:test';
import { executeTextLlm, type CommonLlmProfile } from './common-llm.js';
import { ServiceDatabase } from '../database.js';

function profile(id: string, overrides: Partial<CommonLlmProfile> = {}): CommonLlmProfile {
  return {
    id,
    name: id,
    baseUrl: `https://${id}.test/v1`,
    model: `${id}-upstream`,
    secret: `secret-${id}`,
    thinkingMode: 'omit',
    headers: {},
    extraBody: {},
    ...overrides,
  };
}

test('temperature is only sent when explicitly configured', async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  };

  await executeTextLlm({ profile: profile('temp-default'), prompt: 'p', fetchFn });
  await executeTextLlm({
    profile: profile('temp-extra', { extraBody: { temperature: 0.2 } }),
    prompt: 'p',
    fetchFn,
  });
  await executeTextLlm({
    profile: profile('temp-option', { extraBody: { temperature: 0.9 } }),
    prompt: 'p',
    temperature: 0.1,
    fetchFn,
  });
  await executeTextLlm({
    profile: profile('temp-invalid', { extraBody: { temperature: 'bad' } }),
    prompt: 'p',
    fetchFn,
  });

  assert.equal('temperature' in bodies[0], false);
  assert.equal(bodies[1].temperature, 0.2);
  assert.equal(bodies[2].temperature, 0.1);
  assert.equal('temperature' in bodies[3], false);
});

test('fallback attempts are audited and onResult fires only for the successful call', async () => {
  const database = new ServiceDatabase();
  const calls: string[] = [];
  const results: Array<{ profileId?: string; text: string }> = [];
  try {
    const fetchFn: typeof fetch = async (_input, init) => {
      const body = JSON.parse(String(init?.body)) as { model: string };
      calls.push(body.model);
      if (calls.length === 1) return new Response('primary down', { status: 500 });
      return Response.json({
        choices: [{ message: { role: 'assistant', content: 'fallback ok' } }],
        usage: { total_tokens: 7 },
      });
    };
    const text = await executeTextLlm({
      profile: profile('audit-primary', { fallbacks: [profile('audit-fallback')] }),
      prompt: 'hello',
      fetchFn,
      onResult: (result) => results.push({ profileId: result.profileId, text: result.text }),
      audit: {
        database,
        traceId: 'trace-llm-fallback',
        applicationId: 'test-app',
        feature: 'fallback-test',
        businessEvent: 'test.llm.fallback',
      },
    });
    assert.equal(text, 'fallback ok');
    assert.deepEqual(calls, ['audit-primary-upstream', 'audit-fallback-upstream']);
    assert.equal(results.length, 1);
    assert.equal(results[0].profileId, 'audit-fallback');
    assert.equal(results[0].text, 'fallback ok');

    const rows = database.connection.prepare(
      'SELECT models_json,status,parameters_json FROM ai_call_records WHERE trace_id=? ORDER BY rowid',
    ).all('trace-llm-fallback') as Array<{ models_json: string; status: string; parameters_json: string }>;
    assert.equal(rows.length, 2, 'each attempt has its own audit record');
    assert.equal(rows[0].status, 'failed');
    assert.equal(rows[1].status, 'succeeded');
    assert.deepEqual(JSON.parse(rows[0].models_json), ['audit-primary-upstream']);
    assert.deepEqual(JSON.parse(rows[1].models_json), ['audit-fallback-upstream']);
    const retryParameters = JSON.parse(rows[1].parameters_json) as Record<string, unknown>;
    assert.equal(retryParameters.fallbackOf, 'audit-primary');
    assert.equal(retryParameters.index, 1);
    assert.equal(retryParameters.fallbackIndex, 1);
    const primaryParameters = JSON.parse(rows[0].parameters_json) as Record<string, unknown>;
    assert.equal(primaryParameters.fallbackOf, null);
    assert.equal(primaryParameters.index, 0);
    assert.equal(primaryParameters.fallbackIndex, 0);
  } finally {
    database.close();
  }
});

test('only timeout, network, auth, 408/429 and 5xx responses switch to a fallback', async () => {
  for (const status of [401, 403, 404, 408, 429, 500, 503]) {
    let calls = 0;
    const text = await executeTextLlm({
      profile: profile(`status-${status}`, { fallbacks: [profile(`status-${status}-fb`)] }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        return calls === 1
          ? new Response('retryable', { status })
          : Response.json({ choices: [{ message: { content: 'ok' } }] });
      },
    });
    assert.equal(text, 'ok');
    assert.equal(calls, 2, `HTTP ${status} should switch`);
  }

  for (const status of [400, 409, 422, 418, 302]) {
    let calls = 0;
    await assert.rejects(
      executeTextLlm({
        profile: profile(`no-switch-${status}`, { fallbacks: [profile(`no-switch-${status}-fb`)] }),
        prompt: 'p',
        fetchFn: async () => {
          calls += 1;
          return new Response('do not retry', { status });
        },
      }),
      new RegExp(`\\[${status}\\]`),
    );
    assert.equal(calls, 1, `HTTP ${status} must not switch`);
  }
});

test('abort and content errors do not trigger fallback, while transport and timeout errors do', async () => {
  let calls = 0;
  const controller = new AbortController();
  controller.abort();
  await assert.rejects(
    executeTextLlm({
      profile: profile('pre-aborted', { fallbacks: [profile('pre-aborted-fb')] }),
      prompt: 'p',
      abortSignal: controller.signal,
      fetchFn: async () => { calls += 1; return Response.json({ choices: [{ message: { content: 'ok' } }] }); },
    }),
    (error: unknown) => (error as { name?: string }).name === 'AbortError',
  );
  assert.equal(calls, 0);

  calls = 0;
  await assert.rejects(
    executeTextLlm({
      profile: profile('user-abort', { fallbacks: [profile('user-abort-fb')] }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        const error = new Error('The operation was aborted');
        error.name = 'AbortError';
        throw error;
      },
    }),
    (error: unknown) => (error as { name?: string }).name === 'AbortError',
  );
  assert.equal(calls, 1, 'user AbortError must not switch');

  calls = 0;
  await assert.rejects(
    executeTextLlm({
      profile: profile('empty-content', { fallbacks: [profile('empty-content-fb')] }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        return Response.json({ choices: [{ message: { content: '' } }] });
      },
    }),
    (error: unknown) => (error as { code?: string }).code === 'llm_empty_content',
  );
  assert.equal(calls, 1, 'empty content must not switch');

  calls = 0;
  await assert.rejects(
    executeTextLlm({
      profile: profile('invalid-json', { fallbacks: [profile('invalid-json-fb')] }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        return new Response('not json', { status: 200, headers: { 'content-type': 'application/json' } });
      },
    }),
    /不是有效 JSON/,
  );
  assert.equal(calls, 1, 'invalid response body must not switch');

  for (const error of [
    new TypeError('fetch failed'),
    Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:443'), { code: 'ECONNREFUSED' }),
    new DOMException('The operation timed out', 'TimeoutError'),
  ]) {
    calls = 0;
    const text = await executeTextLlm({
      profile: profile(`transport-${String((error as { name?: string }).name ?? 'error')}`, { fallbacks: [profile('transport-fb')] }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        if (calls === 1) throw error;
        return Response.json({ choices: [{ message: { content: 'ok' } }] });
      },
    });
    assert.equal(text, 'ok');
    assert.equal(calls, 2);
  }

  const slow = profile('slow-timeout', { timeoutMs: 10, fallbacks: [profile('fast-timeout-fb')] });
  calls = 0;
  const text = await executeTextLlm({
    profile: slow,
    prompt: 'p',
    fetchFn: async (_input, init) => {
      calls += 1;
      const body = JSON.parse(String(init?.body)) as { model: string };
      if (body.model === 'slow-timeout-upstream') {
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
        });
      }
      return Response.json({ choices: [{ message: { content: 'ok' } }] });
    },
  });
  assert.equal(text, 'ok');
  assert.equal(calls, 2, 'an actual AbortSignal timeout should switch');
});

test('fallback chains stop at two retries and preserve the last error when exhausted', async () => {
  let calls = 0;
  await assert.rejects(
    executeTextLlm({
      profile: profile('exhaust-primary', {
        fallbacks: [
          profile('exhaust-fb-1'),
          profile('exhaust-fb-2'),
          profile('exhaust-fb-3'),
        ],
      }),
      prompt: 'p',
      fetchFn: async () => {
        calls += 1;
        return new Response(`down-${calls}`, { status: calls === 3 ? 503 : 500 });
      },
    }),
    /down-3/,
  );
  assert.equal(calls, 3, 'primary plus at most two fallbacks');

  calls = 0;
  await assert.rejects(
    executeTextLlm({
      profile: profile('single-primary'),
      prompt: 'p',
      fetchFn: async () => { calls += 1; return new Response('down', { status: 500 }); },
    }),
    /down/,
  );
  assert.equal(calls, 1);
});

test('thinking levels map explicitly without breaking legacy thinkingMode', async () => {
  const seen: Array<Record<string, unknown>> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    seen.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    return Response.json({ choices: [{ message: { content: 'ok' } }] });
  };

  for (const level of ['off', 'low', 'medium', 'high'] as const) {
    await executeTextLlm({
      profile: profile(`thinking-${level}`, {
        thinkingLevel: level,
        thinkingMode: 'enabled',
        extraBody: { reasoning_effort: 'legacy-effort' },
      }),
      prompt: 'p',
      fetchFn,
    });
    const body = seen.at(-1)!;
    assert.equal(body.thinkingMode, undefined);
    if (level === 'off') {
      assert.deepEqual(body.thinking, { type: 'disabled' });
      assert.equal(body.reasoning_effort, undefined);
    } else {
      assert.equal(body.thinking, undefined);
      assert.equal(body.reasoning_effort, level);
    }
  }

  await executeTextLlm({
    profile: profile('thinking-auto-enabled', { thinkingLevel: 'auto', thinkingMode: 'enabled' }),
    prompt: 'p', fetchFn,
  });
  assert.deepEqual(seen.at(-1)!.thinking, { type: 'enabled' });

  await executeTextLlm({
    profile: profile('thinking-off-omit', {
      thinkingLevel: 'off',
      thinkingMode: 'omit',
      extraBody: { thinking: { type: 'enabled' }, reasoning_effort: 'legacy-effort' },
    }),
    prompt: 'p', fetchFn,
  });
  assert.equal(seen.at(-1)!.thinking, undefined);
  assert.equal(seen.at(-1)!.reasoning_effort, undefined);

  await executeTextLlm({
    profile: profile('thinking-auto-disabled', {
      thinkingLevel: 'auto', thinkingMode: 'disabled',
      extraBody: { reasoning_effort: 'legacy-effort' },
    }),
    prompt: 'p', fetchFn,
  });
  assert.deepEqual(seen.at(-1)!.thinking, { type: 'disabled' });
  assert.equal(seen.at(-1)!.reasoning_effort, undefined);

  await executeTextLlm({
    profile: profile('thinking-auto-omit', {
      thinkingLevel: 'auto', thinkingMode: 'omit',
      extraBody: { thinking: { type: 'enabled' } },
    }),
    prompt: 'p', fetchFn,
  });
  assert.equal(seen.at(-1)!.thinking, undefined);
});

test('concurrent fallback chains stay isolated', async () => {
  let calls = 0;
  const results: Array<{ profileId?: string; text: string }> = [];
  const fetchFn: typeof fetch = async (_input, init) => {
    calls += 1;
    const body = JSON.parse(String(init?.body)) as {
      model: string;
      messages: Array<{ content: string }>;
    };
    if (body.model === 'parallel-primary-upstream') return new Response('busy', { status: 500 });
    return Response.json({
      choices: [{ message: { content: body.messages.at(-1)?.content ?? 'missing' } }],
    });
  };
  const texts = await Promise.all(Array.from({ length: 5 }, (_, index) => executeTextLlm({
    profile: profile('parallel-primary', { fallbacks: [profile('parallel-fallback')] }),
    prompt: `parallel-${index}`,
    fetchFn,
    onResult: (result) => results.push({ profileId: result.profileId, text: result.text }),
  })));
  assert.deepEqual(texts.sort(), ['parallel-0', 'parallel-1', 'parallel-2', 'parallel-3', 'parallel-4']);
  assert.equal(calls, 10);
  assert.equal(results.length, 5);
  assert.deepEqual([...new Set(results.map((result) => result.profileId))], ['parallel-fallback']);
});

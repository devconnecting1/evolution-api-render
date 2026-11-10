import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { OpenaiHealthService } from '@api/services/openai-health.service';
import {
  classifyOpenaiError,
  currentVerdict,
  maskKey,
  OpenaiHealthRegistry,
  testOpenaiKey,
} from '@utils/openai-health';

const httpError = (status: number, code: string | null, message: string) =>
  Object.assign(new Error(message), { response: { status, data: { error: { code, message } } } });

describe('openai health: classification', () => {
  test('each OpenAI answer becomes one plain situation', () => {
    assert.equal(classifyOpenaiError(httpError(401, 'invalid_api_key', 'Incorrect API key')).kind, 'invalid_key');
    assert.equal(
      classifyOpenaiError(httpError(429, 'insufficient_quota', 'You exceeded your current quota')).kind,
      'no_credit',
    );
    assert.equal(classifyOpenaiError(httpError(429, 'rate_limit_exceeded', 'Rate limit reached')).kind, 'rate_limited');
    assert.equal(classifyOpenaiError(httpError(404, 'model_not_found', 'does not exist')).kind, 'model_unavailable');
    assert.equal(classifyOpenaiError(httpError(503, null, 'overloaded')).kind, 'server_error');
    assert.equal(classifyOpenaiError(new Error('read ECONNRESET')).kind, 'network');
    // SDK errors carry status/code on the error itself
    assert.equal(
      classifyOpenaiError(Object.assign(new Error('quota'), { status: 429, code: 'insufficient_quota' })).kind,
      'no_credit',
    );
  });

  test('the key is only shown masked', () => {
    assert.equal(maskKey('sk-proj-abcdefghijklmnopWXYZ'), 'sk-…WXYZ');
    assert.equal(maskKey(''), '(sem chave)');
  });

  test('the most recent event decides the situation', () => {
    let now = 1_000;
    const reg = new OpenaiHealthRegistry(() => now);
    assert.equal(currentVerdict(reg.get('c1')).verdict, 'not_tested');
    reg.recordOk('c1', 'gpt-x');
    now = 2_000;
    reg.recordError('c1', httpError(429, 'insufficient_quota', 'quota'), 'gpt-x');
    assert.equal(currentVerdict(reg.get('c1')).verdict, 'no_credit');
    now = 3_000;
    reg.recordOk('c1', 'gpt-x');
    assert.equal(currentVerdict(reg.get('c1')).verdict, 'ok', 'credit added: the next answer clears it');
  });
});

/** Minimal axios stand-in: routes by method + path, throws the given errors. */
function fakeHttp(routes: Record<string, any>) {
  const calls: string[] = [];
  const handle = async (key: string) => {
    calls.push(key);
    const r = routes[key];
    if (r instanceof Error) throw r;
    if (typeof r === 'function') return r();
    return r ?? { data: {}, headers: {} };
  };
  return {
    calls,
    http: {
      get: (path: string) => handle(`GET ${path}`),
      post: (path: string, body: any) =>
        handle(`POST ${path}${body?.max_completion_tokens ? ':mct' : body?.max_tokens ? ':mt' : ''}`),
    } as any,
  };
}

describe('openai health: testOpenaiKey', () => {
  const models = { data: { data: [{ id: 'gpt-x' }, { id: 'text-embedding-3-small' }] }, headers: {} };

  test('valid key with credit: ok, model available, tier limits from the headers', async () => {
    const { http, calls } = fakeHttp({
      'GET /models': models,
      'POST /embeddings': {
        data: {},
        headers: { 'x-ratelimit-limit-requests': '3000', 'x-ratelimit-limit-tokens': '1000000' },
      },
    });
    const r = await testOpenaiKey('sk-test', 'gpt-x', { http });
    assert.equal(r.verdict, 'ok');
    assert.equal(r.modelAvailable, true);
    assert.deepEqual(r.limits, { requestsPerMinute: 3000, tokensPerMinute: 1000000 });
    assert.deepEqual(calls, ['GET /models', 'POST /embeddings']);
  });

  test('invalid key stops at the free call; no credit is caught by the 1-token probe', async () => {
    const bad = fakeHttp({ 'GET /models': httpError(401, 'invalid_api_key', 'Incorrect API key') });
    const r1 = await testOpenaiKey('sk-bad', 'gpt-x', { http: bad.http });
    assert.equal(r1.verdict, 'invalid_key');
    assert.deepEqual(bad.calls, ['GET /models']);
    assert.match(r1.hint ?? '', /api-keys/);

    const broke = fakeHttp({
      'GET /models': models,
      'POST /embeddings': httpError(429, 'insufficient_quota', 'You exceeded your current quota'),
    });
    const r2 = await testOpenaiKey('sk-broke', 'gpt-x', { http: broke.http });
    assert.equal(r2.verdict, 'no_credit');
    assert.match(r2.hint ?? '', /billing/);
  });

  test('model missing from the key: model_unavailable', async () => {
    const { http } = fakeHttp({ 'GET /models': models, 'POST /embeddings': { data: {}, headers: {} } });
    const r = await testOpenaiKey('sk-test', 'gpt-not-allowed', { http });
    assert.equal(r.verdict, 'model_unavailable');
    assert.equal(r.modelAvailable, false);
  });

  test('embeddings blocked in the project: confirms with a tiny answer of the bot model (token param fallback)', async () => {
    const { http, calls } = fakeHttp({
      'GET /models': models,
      'POST /embeddings': httpError(403, null, 'You are not allowed to use this model'),
      'POST /chat/completions:mct': httpError(400, null, "Unsupported parameter: 'max_completion_tokens'"),
      'POST /chat/completions:mt': { data: {}, headers: {} },
    });
    const r = await testOpenaiKey('sk-test', 'gpt-x', { http });
    assert.equal(r.verdict, 'ok');
    assert.deepEqual(calls, [
      'GET /models',
      'POST /embeddings',
      'POST /chat/completions:mct',
      'POST /chat/completions:mt',
    ]);
  });
});

describe('openai health: service', () => {
  function setup() {
    let now = Date.parse('2026-11-10T12:00:00Z');
    const registry = new OpenaiHealthRegistry(() => now);
    const tested: string[] = [];
    const prisma = {
      instance: {
        findMany: async ({ where }: any) =>
          [
            { id: 'i1', name: 'Escritório Exemplo' },
            { id: 'i2', name: 'Clínica Modelo' },
          ].filter((i) => !where?.id?.in || where.id.in.includes(i.id)),
      },
      openaiCreds: {
        findMany: async ({ where }: any) =>
          ({
            i1: [{ id: 'c1', name: 'Principal', apiKey: 'sk-proj-aaaaaaaaaaaa1111', instanceId: 'i1' }],
            i2: [{ id: 'c2', name: null, apiKey: 'sk-proj-bbbbbbbbbbbb2222', instanceId: 'i2' }],
          })[where.instanceId as 'i1' | 'i2'] ?? [],
      },
      openaiBot: {
        findMany: async ({ where }: any) =>
          where.instanceId === 'i1' ? [{ openaiCredsId: 'c1', model: 'gpt-x', enabled: true }] : [],
      },
    };
    const tester = async (key: string, model: string | null) => {
      tested.push(`${key.slice(-4)}:${model}`);
      return {
        verdict: key.endsWith('2222') ? ('no_credit' as const) : ('ok' as const),
        text: '',
        hint: null,
        checkedAt: new Date(now).toISOString(),
        model,
        modelAvailable: null,
        limits: null,
        error: null,
        durationMs: 1,
      };
    };
    const svc = new OpenaiHealthService({ prisma, registry, tester: tester as any, now: () => now });
    return { svc, registry, tested, advance: (ms: number) => (now += ms) };
  }

  test('overview: masked key, bot model, situation from real answers (no OpenAI call)', async () => {
    const { svc, registry, tested } = setup();
    registry.recordError('c1', httpError(429, 'insufficient_quota', 'quota'), 'gpt-x');
    const [c1] = await svc.overview(['i1']);
    assert.equal(c1.keyMasked, 'sk-…1111');
    assert.equal(c1.model, 'gpt-x');
    assert.equal(c1.verdict, 'no_credit');
    assert.equal(c1.text, 'Sem crédito na conta OpenAI');
    assert.ok(!JSON.stringify(c1).includes('aaaaaaaaaaaa1111'), 'the full key never leaves the service');
    assert.deepEqual(tested, []);
  });

  test('test: runs once per key per 30 s', async () => {
    const { svc, tested, advance } = setup();
    await svc.test('i1');
    await svc.test('i1');
    assert.equal(tested.length, 1);
    advance(31_000);
    const [c1] = await svc.test('i1');
    assert.equal(tested.length, 2);
    assert.equal(c1.verdict, 'ok');
  });

  test('Observability card: tests stale keys, counts the working ones and raises a critical alert', async () => {
    const { svc, tested } = setup();
    const view = await svc.providerView('desc');
    assert.equal(tested.length, 2, 'both keys had no signal yet: tested once');
    assert.equal(view.status, 'partial');
    assert.equal(view.metrics[0].used, 1);
    assert.equal(view.metrics[0].limit, 2);
    assert.equal(view.extraAlerts.length, 1);
    assert.equal(view.extraAlerts[0].status, 'critical');
    assert.match(view.extraAlerts[0].message, /Clínica Modelo: Sem crédito/);

    await svc.providerView('desc');
    assert.equal(tested.length, 2, 'fresh results are reused');
  });
});

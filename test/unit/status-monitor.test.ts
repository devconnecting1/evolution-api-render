import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';

import type { FetchLike } from '@api/services/status/signals';

import { Env, handleRequest, HISTORY_KEY, KVLike, runMonitor } from '../../ops/status-monitor/src/index';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/status', name), 'utf8'));
const AT = Date.UTC(2026, 10, 16, 22, 0, 0);
const MIN = 60_000;

function fakeKv() {
  const data = new Map<string, string>();
  let puts = 0;
  const kv: KVLike = {
    get: async (key) => (data.has(key) ? JSON.parse(data.get(key) as string) : null),
    put: async (key, value) => {
      puts++;
      data.set(key, value);
    },
  };
  return { kv, data, puts: () => puts };
}

function fakeFetch(state: { api: number | 'timeout'; site: number }, extra: Record<string, unknown> = {}) {
  const calls: string[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    const reply = (status: number, body: unknown) => ({
      ok: status >= 200 && status < 300,
      status,
      json: async () => (typeof body === 'string' ? JSON.parse(body) : body),
    });
    if (url.includes('/status/ping')) {
      if (state.api === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return reply(state.api, {
        status: 'ok',
        version: '2.3.7',
        uptimeSeconds: 60,
        state: 'operational',
        components: { api: 'operational', '<x>': 'bad' },
      });
    }
    if (url.startsWith('https://site')) return reply(state.site, {});
    for (const [prefix, body] of Object.entries(extra)) if (url.startsWith(prefix)) return reply(200, body);
    if (url.startsWith('https://api.status.io'))
      return reply(200, { result: { status_overall: { status_code: 100 }, incidents: [] } });
    if (url.includes('summary.json')) return reply(200, fixture('statuspage-openai-ok.json'));
    return reply(404, {});
  };
  return { fetcher, calls };
}

function env(kv: KVLike, extra: Partial<Env> = {}): Env {
  return { STATUS_KV: kv, API_URL: 'https://api.example', SITE_URL: 'https://site/', ...extra };
}

describe('monitor externo (Cloudflare Worker)', () => {
  test('uma gravação no KV por execução (288/dia) e terceiros só a cada 15 min', async () => {
    const store = fakeKv();
    const state = { api: 200 as number | 'timeout', site: 200 };
    const http = fakeFetch(state);
    let now = AT;
    for (let i = 0; i < 12; i++) {
      await runMonitor(env(store.kv), http.fetcher, () => now);
      now += 5 * MIN;
    }
    assert.equal(store.puts(), 12);
    assert.equal(
      http.calls.filter((call) => call.includes('summary.json')).length,
      4 * 3,
      '1 hora = 4 leituras de cada',
    );
    assert.ok(http.calls.some((call) => call === 'HEAD https://site/'));
    const saved = JSON.parse(store.data.get(HISTORY_KEY) as string);
    assert.equal(saved.samples.length, 12);
    assert.deepEqual(saved.days['2026-11-16'], [12, 12, 12, 12]);
    assert.deepEqual(saved.api.components, { api: 'operational' }, 'ids fora do padrão são descartados');
    assert.ok(store.data.get(HISTORY_KEY)!.length < 4000);
  });

  test('API sem resposta: incidente depois de 2 falhas seguidas, fechado quando volta', async () => {
    const store = fakeKv();
    const state = { api: 200 as number | 'timeout', site: 200 };
    const http = fakeFetch(state);
    let now = AT;
    const run = async () => {
      const history = await runMonitor(env(store.kv), http.fetcher, () => now);
      now += 5 * MIN;
      return history;
    };
    await run();
    state.api = 'timeout';
    let history = await run();
    assert.equal(history.incidents.length, 0, 'uma falha só não abre incidente');
    state.api = 503;
    history = await run();
    assert.equal(history.incidents[0].t, 'api_unreachable');
    assert.equal(history.incidents[0].a, AT + 5 * MIN);
    state.api = 200;
    history = await run();
    assert.equal(history.incidents[0].b, AT + 15 * MIN);

    const response = await handleRequest({ method: 'GET', url: 'https://w.example/history' }, env(store.kv), now);
    assert.equal(response.headers.get('Access-Control-Allow-Origin'), '*');
    const body: any = await response.json();
    assert.equal(body.incidents[0].title, 'API sem resposta');
    assert.equal(body.incidents[0].durationSeconds, 600);
    assert.equal((await handleRequest({ method: 'GET', url: 'https://w.example/x' }, env(store.kv))).status, 404);
  });

  test('tokens opcionais: deploy falho no Render e risco de cota no Neon viram incidentes, sem vazar tokens', async () => {
    const store = fakeKv();
    const http = fakeFetch(
      { api: 200, site: 200 },
      {
        'https://api.render.com/v1/services/srv-x/deploys': [
          { deploy: { status: 'build_failed', finishedAt: '2026-11-16T21:50:00Z' } },
        ],
        'https://api.render.com/v1/services/srv-x/events': [],
        'https://api.render.com/v1/services/srv-x': { id: 'srv-x' },
        'https://console.neon.tech/api/v2/projects/p/endpoints': fixture('neon-endpoints-idle.json'),
        'https://console.neon.tech/api/v2/projects/p': fixture('neon-project.json'),
      },
    );
    const history = await runMonitor(
      env(store.kv, {
        RENDER_API_KEY: 'rnd_secret',
        RENDER_SERVICE_ID: 'srv-x',
        NEON_API_KEY: 'neon_secret',
        NEON_PROJECT_ID: 'p',
      }),
      http.fetcher,
      () => AT,
    );
    const types = history.incidents.map((item) => item.t).sort();
    assert.deepEqual(types, ['db_quota_risk', 'deploy_failed']);
    const saved = store.data.get(HISTORY_KEY) as string;
    assert.ok(!saved.includes('rnd_secret') && !saved.includes('neon_secret'));
    const body: any = await (
      await handleRequest({ method: 'GET', url: 'https://w.example/history' }, env(store.kv), AT)
    ).json();
    assert.deepEqual(body.incidents.map((item: any) => item.title).sort(), [
      'Banco pode ser suspenso em ~8 dias',
      'Deploy falhou no build',
    ]);
  });

  test('KV ilegível não derruba a execução', async () => {
    const kv: KVLike = { get: async () => Promise.reject(new Error('kv')), put: async () => undefined };
    const history = await runMonitor(env(kv), fakeFetch({ api: 200, site: 200 }).fetcher, () => AT);
    assert.equal(history.samples.length, 1);
  });
});

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, mock, test } from 'node:test';

import {
  createPersistence,
  DB_PROBE_INTERVAL_MS,
  PublicStatusDeps,
  PublicStatusService,
  STATUS_REDIS_KEY,
  TICK_MS,
} from '@api/services/public-status.core';
import {
  emptyStore,
  MAX_SAMPLE_GAP_MS,
  mergeStores,
  normalizeStore,
  pruneStore,
  recordSample,
  StatusStore,
  summarizeDay,
} from '@api/services/status/history';
import {
  checkSite,
  describeIncident,
  FetchLike,
  fetchNeon,
  fetchRender,
  fetchUpstream,
  fetchVercel,
  parseNeon,
  parseRenderEvents,
  parseStatusIo,
  parseStatuspage,
  parseVercel,
  restartCause,
  UPSTREAM_SOURCES,
} from '@api/services/status/signals';
import type { KeyHealth } from '@utils/openai-health';

const fixture = (name: string) => JSON.parse(readFileSync(join(__dirname, '../fixtures/status', name), 'utf8'));

const AT = Date.UTC(2026, 10, 16, 22, 0, 0);
const MIN = 60_000;

type Reply = { status?: number; body?: unknown; throws?: unknown; delayMs?: number };

/** fetch falso: cada URL (prefixo) responde o que o teste mandar; conta as chamadas. */
function fakeFetch(routes: Record<string, Reply | (() => Reply)>) {
  const calls: { url: string; method: string; headers: Record<string, string> }[] = [];
  const fetcher: FetchLike = async (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', headers: init?.headers ?? {} });
    const key = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    const route = key ? routes[key] : { status: 404, body: {} };
    const reply = typeof route === 'function' ? route() : route;
    if (reply.throws) throw reply.throws;
    const status = reply.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => {
        if (typeof reply.body === 'string') return JSON.parse(reply.body);
        return reply.body;
      },
    };
  };
  return { fetcher, calls };
}

const UPSTREAM_OK: Record<string, Reply> = {
  'https://status.render.com': { body: fixture('statuspage-openai-ok.json') },
  'https://www.vercel-status.com': { body: fixture('statuspage-openai-ok.json') },
  'https://status.openai.com': { body: fixture('statuspage-openai-ok.json') },
  'https://api.status.io': { body: { result: { status_overall: { status_code: 100 }, incidents: [] } } },
};

function memoryPersistence(initial: unknown = null) {
  let saved: unknown = initial;
  const writes: StatusStore[] = [];
  return {
    writes,
    saved: () => saved,
    persistence: {
      read: async () => saved,
      write: async (store: StatusStore) => {
        saved = JSON.parse(JSON.stringify(store));
        writes.push(saved as StatusStore);
        return true;
      },
    },
  };
}

function setup(overrides: Partial<PublicStatusDeps> & { clock?: { now: number } } = {}) {
  const clock = overrides.clock ?? { now: AT };
  const memory = memoryPersistence();
  const probes: number[] = [];
  const http = fakeFetch({ 'https://whatsaibr.vercel.app': { status: 200, body: {} }, ...UPSTREAM_OK });
  const deps: PublicStatusDeps = {
    now: () => clock.now,
    version: '2.3.7',
    commit: 'abc1234',
    bootAt: AT - 2 * 3_600_000,
    instances: () => ({}),
    openai: () => [],
    dbLastQueryAt: () => null,
    dbProbe: async () => {
      probes.push(clock.now);
    },
    redis: () => 'ready',
    fetcher: http.fetcher,
    siteUrl: 'https://whatsaibr.vercel.app/',
    persistence: memory.persistence,
    ...overrides,
  };
  const service = new PublicStatusService(deps);
  return { service, clock, memory, probes, http, deps };
}

const component = (status: any, id: string) =>
  status.groups.flatMap((group: any) => group.components).find((item: any) => item.id === id);

// ------------------------------------------------------------------------------------------- signals

describe('status: páginas de status de terceiros', () => {
  const render = UPSTREAM_SOURCES.find((source) => source.id === 'upstream-render')!;
  const neon = UPSTREAM_SOURCES.find((source) => source.id === 'upstream-neon')!;

  test('Statuspage com incidente ativo: estado, título público e link do incidente', () => {
    const status = parseStatuspage(render, fixture('statuspage-render-incident.json'), AT);
    assert.equal(status.state, 'degraded');
    assert.equal(status.incidents.length, 1, 'incidentes resolvidos ficam de fora');
    assert.equal(status.incidents[0].name, 'Degraded deploys in Ohio');
    assert.equal(status.incidents[0].url, 'https://stspg.io/abc123');
  });

  test('status.io (Neon): código 300 é degradado', () => {
    const status = parseStatusIo(neon, fixture('statusio-neon.json'), AT);
    assert.equal(status.state, 'degraded');
    assert.match(status.incidents[0].name, /latency/);
  });

  test('falhas viram "sem leitura" com motivo curto: tempo esgotado, 401, JSON malformado', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const cases: [Reply, string][] = [
      [{ throws: abort }, 'tempo esgotado'],
      [{ status: 401, body: {} }, 'credencial inválida ou sem permissão'],
      [{ body: '<html>oops' }, 'resposta inválida'],
      [{ body: { status: { indicator: 'weird' } } }, 'resposta inválida'],
    ];
    for (const [reply, error] of cases) {
      const { fetcher } = fakeFetch({ 'https://status.render.com': reply });
      const status = await fetchUpstream(fetcher, render, () => AT);
      assert.equal(status.state, 'no_data');
      assert.equal(status.error, error);
    }
  });
});

describe('status: Render, Neon e Vercel', () => {
  test('eventos do Render: OOM, deploy, build falho e saída com código', () => {
    const events = parseRenderEvents(fixture('render-events.json'));
    assert.deepEqual(
      events.map((event) => event.kind),
      ['available', 'oom', 'deploy', 'deploy_failed', 'failed'],
    );
    const boot = Date.parse('2026-11-16T05:27:00.000Z');
    assert.equal(restartCause(events, boot)?.type, 'restart_oom');
    assert.equal(restartCause(events, Date.parse('2026-11-15T22:23:00Z'))?.type, 'restart_deploy');
    assert.equal(restartCause(events, Date.parse('2026-11-10T00:00:00Z')), null);
  });

  test('fetchRender: deploy, eventos e Key Value; 401 em tudo vira erro sem vazar a chave', async () => {
    const { fetcher, calls } = fakeFetch({
      'https://api.render.com/v1/services/srv-x/deploys': {
        body: [{ deploy: { status: 'build_failed', finishedAt: '2026-11-16T05:20:00Z' } }],
      },
      'https://api.render.com/v1/services/srv-x/events': { body: fixture('render-events.json') },
      'https://api.render.com/v1/services/srv-x': { body: { id: 'srv-x', suspended: 'not_suspended' } },
      'https://api.render.com/v1/key-value/red-y': { body: { id: 'red-y', status: 'available' } },
      'https://api.render.com/v1/metrics/memory-limit': { body: [{ values: [{ timestamp: 'x', value: 25e6 }] }] },
      'https://api.render.com/v1/metrics/memory': { body: [{ values: [{ timestamp: 'x', value: 5e6 }] }] },
    });
    const signal = await fetchRender(
      fetcher,
      { apiKey: 'rnd_secret', serviceId: 'srv-x', keyValueId: 'red-y' },
      () => AT,
    );
    assert.equal(signal.deployState, 'build_failed');
    assert.equal(signal.keyValue?.memoryUsed, 5e6);
    assert.equal(signal.keyValue?.memoryLimit, 25e6);
    assert.ok(calls.every((call) => call.headers.Authorization === 'Bearer rnd_secret'));

    const denied = fakeFetch({ 'https://api.render.com': { status: 401, body: {} } });
    const failed = await fetchRender(denied.fetcher, { apiKey: 'rnd_secret', serviceId: 'srv-x' }, () => AT);
    assert.equal(failed.error, 'credencial inválida ou sem permissão');
    assert.ok(!JSON.stringify(failed).includes('rnd_secret'));
  });

  test('Neon: endpoint em espera, projeção acima da cota e dias até suspender', async () => {
    const signal = parseNeon(fixture('neon-project.json'), fixture('neon-endpoints-idle.json'), AT);
    assert.equal(signal.endpointState, 'idle');
    assert.equal(signal.isFree, true);
    assert.equal(signal.computeCuHours, 66);
    assert.ok(signal.projectedCuHours! > 100);
    assert.ok(signal.daysToLimit! > 7 && signal.daysToLimit! < 10);
    assert.equal(signal.suspendedForQuota, false);

    const exhausted = fixture('neon-project.json');
    exhausted.project.compute_time_seconds = 100 * 3600;
    const suspended = parseNeon(exhausted, fixture('neon-endpoints-idle.json'), AT);
    assert.equal(suspended.suspendedForQuota, true);

    const { fetcher } = fakeFetch({ 'https://console.neon.tech': { body: 'not json' } });
    assert.equal((await fetchNeon(fetcher, { apiKey: 'k', projectId: 'p' }, () => AT)).error, 'resposta inválida');
  });

  test('Vercel: último deploy de produção, sem repassar a mensagem do commit', async () => {
    const signal = parseVercel(fixture('vercel-deployments.json'), AT);
    assert.equal(signal.state, 'error');
    assert.ok(!JSON.stringify(signal).includes('segredo'));
    const { fetcher } = fakeFetch({ 'https://api.vercel.com': { status: 403, body: {} } });
    assert.equal(
      (await fetchVercel(fetcher, { token: 't', projectId: 'p' }, () => AT)).error,
      'credencial inválida ou sem permissão',
    );
  });

  test('HEAD do site: 2xx/3xx no ar, 5xx e rede fora', async () => {
    let status = 308;
    const { fetcher, calls } = fakeFetch({ 'https://site': () => ({ status, body: {} }) });
    assert.equal((await checkSite(fetcher, 'https://site/', () => AT)).ok, true);
    assert.equal(calls[0].method, 'HEAD');
    status = 503;
    const down = await checkSite(fetcher, 'https://site/', () => AT);
    assert.deepEqual([down.ok, down.error], [false, 'HTTP 503']);
    const offline = fakeFetch({ 'https://site': { throws: new TypeError('fetch failed') } });
    assert.equal((await checkSite(offline.fetcher, 'https://site/', () => AT)).error, 'sem resposta');
  });
});

describe('status: títulos e detalhes dos incidentes', () => {
  test('cada tipo gera um título fixo e um detalhe com os números reais', () => {
    const start = AT - 42 * MIN;
    const text = (type: any, data: any, end: number | null = AT) => describeIncident({ type, start, end, data }, AT);
    assert.equal(text('restart_oom', {}).title, 'API reiniciou por falta de memória');
    assert.equal(text('restart_deploy', { version: '2.3.7' }).title, 'API reiniciou após deploy');
    assert.equal(text('restart_unknown', { gapMinutes: 42, sleep: 'yes' }).title, 'Serviço em espera (plano gratuito)');
    assert.match(text('restart_unknown', { gapMinutes: 42, sleep: 'yes' }).detail, /42 min/);
    assert.equal(text('restart_unknown', {}).title, 'Reinício da API');
    assert.equal(text('deploy_failed', { stage: 'build' }).title, 'Deploy falhou no build');
    assert.equal(text('db_suspended_quota', { used: 100, limit: 100 }).title, 'Banco suspenso: cota do mês esgotada');
    assert.equal(
      text('db_quota_risk', { used: 66, limit: 100, projected: 124, days: 8 }).title,
      'Banco pode ser suspenso em ~8 dias',
    );
    assert.match(
      text('db_quota_risk', { used: 66, limit: 100, projected: 124, days: 8 }).detail,
      /66,0 de 100 CU-h.*124/,
    );
    const whatsapp = text('whatsapp_disconnected', { down: 1, total: 3 });
    assert.equal(whatsapp.title, 'Conexão do WhatsApp caiu');
    assert.match(whatsapp.detail, /1 de 3 números.*voltou a conectar em 42 min/);
    assert.match(text('whatsapp_disconnected', { down: 1, total: 3 }, null).detail, /desde/);
    assert.match(text('ai_errors', { failing: 1, total: 2, kind: 'no_credit' }).detail, /1 de 2 chaves.*sem crédito/);
    assert.equal(text('site_down', { reason: 'HTTP 503' }).title, 'Site e painel fora do ar');
    assert.equal(
      text('upstream_incident', { provider: 'Render', name: 'Degraded deploys' }).title,
      'Render: Degraded deploys',
    );
    assert.equal(text('api_unreachable', {}).title, 'API sem resposta');
  });
});

// ------------------------------------------------------------------------------------------- history

describe('status: histórico compacto', () => {
  test('a cobertura é real: intervalos acima de 10 min são cortados e o dia vira na meia-noite UTC', () => {
    const store = emptyStore();
    const midnight = Date.UTC(2026, 10, 17, 0, 0, 0);
    recordSample(store, { api: 'operational', ai: 'no_data' }, midnight - 4 * MIN, midnight + MIN);
    assert.deepEqual(
      store.days.map((day) => [day.d, day.c.api[0]]),
      [
        ['2026-11-16', 240],
        ['2026-11-17', 60],
      ],
    );
    assert.equal(store.days[0].c.ai, undefined, '"sem dados" não conta como disponível');

    recordSample(store, { api: 'outage' }, midnight + MIN, midnight + 3 * 3_600_000);
    assert.equal(store.days[1].c.api[2], MAX_SAMPLE_GAP_MS / 1000);
  });

  test('resumo do dia, poda de 90 dias e leitura tolerante a lixo', () => {
    assert.equal(summarizeDay([86_000, 0, 400, 0], 86_400).state, 'outage');
    assert.equal(summarizeDay([86_000, 100, 0, 0], 86_400).state, 'degraded');
    assert.equal(summarizeDay([3600, 0, 0, 0], 86_400).coverage, 4.2);
    assert.equal(summarizeDay(undefined, 86_400).state, 'no_data');

    const store = emptyStore();
    recordSample(store, { api: 'operational' }, AT - 100 * 86_400_000 - MIN, AT - 100 * 86_400_000);
    recordSample(store, { api: 'operational' }, AT - MIN, AT);
    pruneStore(store, AT);
    assert.equal(store.days.length, 1);

    const garbage = normalizeStore({
      v: 2,
      days: [{ d: 'x' }, { d: '2026-11-16', c: { api: [1, 2, 3, 4], '<b>': [1, 1, 1, 1] } }],
      incidents: [
        { a: 1, c: 'api', t: 'nope', s: 'outage' },
        { a: 1, c: 'api', t: 'site_down', s: 'outage', d: { x: { y: 1 } } },
      ],
    });
    assert.equal(garbage.days.length, 1);
    assert.deepEqual(Object.keys(garbage.days[0].c), ['api']);
    assert.equal(garbage.incidents.length, 1);
    assert.equal(garbage.incidents[0].d, undefined);
    assert.deepEqual(normalizeStore('{"v":1}'), emptyStore());
  });

  test('junta o guardado com o desta execução sem perder nada', () => {
    const base = emptyStore();
    recordSample(base, { api: 'operational' }, AT - 5 * MIN, AT);
    base.incidents.push({ id: 'a', c: 'api', t: 'restart_unknown', s: 'maintenance', a: 1, b: 2 });
    const current = emptyStore();
    recordSample(current, { api: 'degraded' }, AT - 5 * MIN, AT);
    current.incidents.push({ id: 'b', c: 'site', t: 'site_down', s: 'outage', a: 3, b: null });
    const merged = mergeStores(base, current);
    assert.deepEqual(merged.days[0].c.api, [300, 300, 0, 0]);
    assert.deepEqual(merged.incidents.map((item) => item.id).sort(), ['a', 'b']);
  });
});

// ---------------------------------------------------------------------------------------- persistence

describe('status: Redis e GlobalSetting', () => {
  function fakeRedis() {
    const data = new Map<string, string>();
    const sets: { key: string; ex: number }[] = [];
    return {
      data,
      sets,
      client: {
        get: async (key: string) => data.get(key) ?? null,
        set: async (key: string, value: string, options: { EX: number }) => {
          data.set(key, value);
          sets.push({ key, ex: options.EX });
        },
      },
    };
  }

  test('Redis: uma chave com TTL de 100 dias e formato compacto', async () => {
    const redis = fakeRedis();
    const persistence = createPersistence({
      redisEnabled: () => true,
      redis: () => redis.client,
      globalSetting: null,
      dbLastQueryAt: () => null,
    });
    const store = emptyStore();
    recordSample(store, { api: 'operational', database: 'operational' }, AT - 5 * MIN, AT);
    assert.equal(await persistence.write(store, AT), true);
    assert.deepEqual(redis.sets, [{ key: STATUS_REDIS_KEY, ex: 100 * 24 * 3600 }]);
    assert.ok(redis.data.get(STATUS_REDIS_KEY)!.length < 400);
    assert.deepEqual(normalizeStore(await persistence.read()), normalizeStore(store));
  });

  test('Redis configurado mas fora: a leitura falha (não sobrescreve o histórico) e a gravação espera', async () => {
    const persistence = createPersistence({
      redisEnabled: () => true,
      redis: () => null,
      globalSetting: { read: async () => assert.fail('não lê o banco'), write: async () => assert.fail('não grava') },
      dbLastQueryAt: () => AT,
      waitMs: 1000,
      sleep: async () => undefined,
    });
    await assert.rejects(persistence.read());
    assert.equal(await persistence.write(emptyStore(), AT), false);
  });

  test('sem Redis: GlobalSetting no máximo a cada 30 min e só com o banco já acordado', async () => {
    const writes: number[] = [];
    let lastQuery: number | null = null;
    const persistence = createPersistence({
      redisEnabled: () => false,
      redis: () => null,
      globalSetting: { read: async () => null, write: async () => void writes.push(1) },
      dbLastQueryAt: () => lastQuery,
    });
    assert.equal(await persistence.write(emptyStore(), AT), false, 'banco dormindo: não acorda');
    lastQuery = AT - MIN;
    assert.equal(await persistence.write(emptyStore(), AT), true);
    lastQuery = AT + 10 * MIN;
    assert.equal(await persistence.write(emptyStore(), AT + 10 * MIN), false, 'menos de 30 min');
    lastQuery = AT + 31 * MIN;
    assert.equal(await persistence.write(emptyStore(), AT + 31 * MIN), true);
    assert.equal(writes.length, 2);
  });

  test('o núcleo lê de novo e junta antes de gravar quando a primeira leitura falhou', async () => {
    const saved = emptyStore();
    saved.incidents.push({
      id: 'old',
      c: 'api',
      t: 'restart_unknown',
      s: 'maintenance',
      a: AT - 86_400_000,
      b: AT - 86_000_000,
    });
    let fail = true;
    const writes: StatusStore[] = [];
    const { service } = setup({
      persistence: {
        read: async () => {
          if (fail) throw new Error('down');
          return saved;
        },
        write: async (store) => {
          writes.push(JSON.parse(JSON.stringify(store)));
          return true;
        },
      },
    });
    await service.start();
    service.stop();
    fail = false;
    await service.tick();
    const ids = writes.at(-1)!.incidents.map((item) => item.id);
    assert.ok(ids.includes('old'));
    assert.ok(ids.some((id) => id.startsWith('boot-')));
  });
});

// --------------------------------------------------------------------------------------------- engine

describe('status: banco sem acordar o Neon', () => {
  test('SELECT 1 no máximo a cada 30 min, mesmo com a página aberta', async () => {
    const { service, clock, probes } = setup();
    for (let i = 0; i < 120; i++) {
      await service.getStatus();
      clock.now += 31_000; // passa o cache de 30 s da resposta
    }
    // ~62 min de página aberta: sondagens em t0 e t0+30min (+ no máximo mais uma no fim)
    assert.ok(probes.length >= 2 && probes.length <= 3, `sondagens: ${probes.length}`);
    for (let i = 1; i < probes.length; i++) assert.ok(probes[i] - probes[i - 1] >= DB_PROBE_INTERVAL_MS);
    const status = await service.getStatus();
    assert.equal(component(status, 'database').state, 'operational');
    assert.match(component(status, 'database').detail, /^Consulta em \d+ ms/);
  });

  test('consulta recente da aplicação: sem sondagem, detalhe com o tempo real', async () => {
    const { service, probes } = setup({ dbLastQueryAt: () => AT - 2 * MIN });
    const status = await service.getStatus();
    assert.equal(probes.length, 0);
    assert.equal(component(status, 'database').detail, 'Última consulta da aplicação há 2 min');
  });

  test('Neon em espera (API de controle): operacional sem sondar o banco; risco de cota vira degradado', async () => {
    const http = fakeFetch({
      'https://console.neon.tech/api/v2/projects/p/endpoints': { body: fixture('neon-endpoints-idle.json') },
      'https://console.neon.tech/api/v2/projects/p': { body: fixture('neon-project.json') },
      ...UPSTREAM_OK,
      'https://whatsaibr.vercel.app': { status: 200, body: {} },
    });
    const { service, probes } = setup({ fetcher: http.fetcher, neon: { apiKey: 'k', projectId: 'p' } });
    const status = await service.getStatus();
    assert.equal(probes.length, 0);
    const db = component(status, 'database');
    assert.equal(db.state, 'degraded');
    assert.match(db.detail, /Em espera desde .* \(liga na primeira consulta\)/);
    assert.match(db.detail, /compute 66,0 de 100 CU-h, projeção 12\d/);
    const risk = status.incidents.find((item) => item.type === 'db_quota_risk');
    assert.ok(risk && risk.end === null);
    assert.match(risk.title, /Banco pode ser suspenso em ~\d dias/);
  });

  test('erro recente ao gravar mensagens deixa o banco fora sem sondar', async () => {
    const { service, probes } = setup({
      dbFailures: () => ({ lastAt: new Date(AT - MIN).toISOString(), lastCode: 'P1001' }),
    });
    const status = await service.getStatus();
    assert.equal(component(status, 'database').state, 'outage');
    assert.equal(probes.length, 0);
  });
});

describe('status: ping, registro em memória e reinício', () => {
  test('/status/ping não toca banco nem grava no Redis', async () => {
    const { service, probes, memory } = setup({
      instances: () => ({ a: { connectionStatus: { state: 'open' }, wuid: 'x' } }) as any,
    });
    const ping = service.ping();
    assert.equal(ping.status, 'ok');
    assert.equal(ping.version, '2.3.7');
    assert.equal(ping.uptimeSeconds, 7200);
    assert.equal(ping.components['whatsapp-web'], 'operational');
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(probes.length, 0);
    assert.equal(memory.writes.length, 0);
  });

  test('o registro roda a cada 5 min com timers falsos e grava o histórico', async () => {
    mock.timers.enable({ apis: ['setInterval'] });
    try {
      const { service, clock, memory, probes } = setup();
      await service.start();
      for (let i = 0; i < 6; i++) {
        clock.now += TICK_MS;
        mock.timers.tick(TICK_MS);
        await new Promise((resolve) => setImmediate(resolve));
        await new Promise((resolve) => setImmediate(resolve));
      }
      service.stop();
      assert.equal(probes.length, 0, 'o registro em segundo plano nunca sonda o banco');
      assert.ok(memory.writes.length >= 2 && memory.writes.length <= 3, 'gravação no máximo a cada 10 min');
      const last = memory.writes.at(-1)!;
      assert.ok(last.days[0].c.api[0] >= 4 * 300 - 1, 'cobre os intervalos entre as passadas');
    } finally {
      mock.timers.reset();
    }
  });

  test('reinício: "Reinício da API" com a lacuna desde o último sinal; commit novo = deploy', async () => {
    const previous = emptyStore();
    previous.boot = { at: AT - 86_400_000, commit: 'abc1234', version: '2.3.6' };
    previous.seen = AT - 2 * 3_600_000 - 20 * MIN;
    const memory = memoryPersistence(previous);
    const { service } = setup({ persistence: memory.persistence });
    const status = await service.getStatus();
    const restart = status.incidents.find((item) => item.type === 'restart_unknown')!;
    assert.equal(restart.title, 'Reinício da API');
    assert.equal(restart.severity, 'maintenance');
    assert.equal(restart.durationSeconds, 20 * 60);
    assert.match(restart.detail, /Sem sinal da API de .* \(20 min\)/);

    const deployed = setup({ persistence: memoryPersistence(previous).persistence, commit: 'def5678' });
    const deployStatus = await deployed.service.getStatus();
    assert.equal(deployStatus.incidents[0].type, 'restart_deploy');
    assert.equal(deployStatus.incidents[0].title, 'API reiniciou após deploy');
  });

  test('reinício classificado pelos eventos do Render (falta de memória) e espera do Free', async () => {
    const bootAt = Date.parse('2026-11-16T05:27:00.000Z');
    const routes = {
      'https://api.render.com/v1/services/srv-x/events': { body: fixture('render-events.json') },
      'https://api.render.com/v1/services/srv-x/deploys': {
        body: [{ deploy: { status: 'live', finishedAt: '2026-11-15T22:22:20Z' } }],
      },
      'https://api.render.com/v1/services/srv-x': { body: { id: 'srv-x' } },
      ...UPSTREAM_OK,
      'https://whatsaibr.vercel.app': { status: 200, body: {} },
    };
    const { service } = setup({
      bootAt,
      clock: { now: bootAt + 5 * MIN },
      fetcher: fakeFetch(routes).fetcher,
      render: { apiKey: 'k', serviceId: 'srv-x' },
    });
    const status = await service.getStatus();
    assert.equal(status.incidents[0].type, 'restart_oom');
    assert.equal(status.incidents[0].title, 'API reiniciou por falta de memória');
    assert.match(component(status, 'api').detail, /deploy 15\/11 19:22 ativo/);

    const previous = emptyStore();
    previous.boot = { at: AT - 86_400_000, commit: 'abc1234', version: null };
    previous.seen = AT - 3 * 3_600_000;
    const quiet = setup({
      persistence: memoryPersistence(previous).persistence,
      fetcher: fakeFetch({ 'https://api.render.com': { body: [] }, ...UPSTREAM_OK }).fetcher,
      render: { apiKey: 'k', serviceId: 'srv-x' },
      siteUrl: null,
    });
    const asleep = await quiet.service.getStatus();
    assert.equal(asleep.incidents[0].title, 'Serviço em espera (plano gratuito)');
  });
});

describe('status: site, WhatsApp, IA e terceiros', () => {
  test('site: HEAD real em cache por 5 min; duas falhas seguidas abrem "site fora do ar"', async () => {
    let siteStatus = 200;
    const http = fakeFetch({
      'https://whatsaibr.vercel.app': () => ({ status: siteStatus, body: {} }),
      ...UPSTREAM_OK,
    });
    const { service, clock } = setup({ fetcher: http.fetcher });
    const heads = () => http.calls.filter((call) => call.method === 'HEAD').length;

    let status = await service.getStatus();
    assert.equal(component(status, 'site').state, 'operational');
    assert.match(component(status, 'site').detail, /^Respondeu em \d+ ms/);
    clock.now += 2 * MIN;
    await service.getStatus();
    assert.equal(heads(), 1, 'cache de 5 min');

    siteStatus = 503;
    clock.now += 4 * MIN;
    status = await service.getStatus();
    assert.equal(component(status, 'site').state, 'degraded');
    clock.now += 6 * MIN;
    status = await service.getStatus();
    assert.equal(heads(), 3);
    assert.equal(component(status, 'site').state, 'outage');
    assert.equal(status.incidents[0].type, 'site_down');
    assert.equal(status.state, 'outage');
    assert.equal(status.title, 'Indisponibilidade em Site e painel');

    siteStatus = 200;
    clock.now += 6 * MIN;
    status = await service.getStatus();
    assert.ok(status.incidents.find((item) => item.type === 'site_down')!.end);
  });

  test('WhatsApp: queda vira incidente depois de 3 min e fecha quando reconecta', async () => {
    const live: Record<string, any> = {
      a: { connectionStatus: { state: 'open' }, wuid: '1' },
      b: { connectionStatus: { state: 'open' }, wuid: '2' },
      nunca: { connectionStatus: { state: 'close' }, wuid: null },
    };
    const { service, clock } = setup({ instances: () => live });
    let status = await service.getStatus();
    assert.equal(component(status, 'whatsapp-web').detail, '2 de 2 conectados');

    live.b.connectionStatus.state = 'close';
    clock.now += MIN;
    status = await service.getStatus();
    assert.equal(component(status, 'whatsapp-web').state, 'degraded');
    assert.ok(!status.incidents.some((item) => item.type === 'whatsapp_disconnected'), 'ainda no tempo de tolerância');

    clock.now += 3 * MIN;
    status = await service.getStatus();
    const open = status.incidents.find((item) => item.type === 'whatsapp_disconnected')!;
    assert.equal(open.end, null);
    assert.match(open.detail, /1 de 2 números sem conexão desde/);

    live.b.connectionStatus.state = 'open';
    clock.now += 7 * MIN;
    status = await service.getStatus();
    const closed = status.incidents.find((item) => item.type === 'whatsapp_disconnected')!;
    assert.match(closed.detail, /voltou a conectar em 10 min/);
    assert.ok(!JSON.stringify(status).includes('"nunca"'));
  });

  test('Respostas da IA: agregado das chaves, sem chave nem instância', async () => {
    const keys: KeyHealth[] = [
      { lastOkAt: AT - 5 * MIN, lastOkModel: 'gpt', lastError: null, okCount: 3, errorCount: 0, lastTest: null },
      {
        lastOkAt: AT - 3_600_000,
        lastOkModel: null,
        lastError: {
          kind: 'no_credit',
          status: 429,
          code: 'insufficient_quota',
          message: 'sk-live-123',
          at: AT - 12 * MIN,
          model: null,
        },
        okCount: 1,
        errorCount: 2,
        lastTest: null,
      },
      // limite por minuto antigo não conta como falha
      {
        lastOkAt: null,
        lastOkModel: null,
        lastError: { kind: 'rate_limited', status: 429, code: null, message: '', at: AT - 2 * 3_600_000, model: null },
        okCount: 0,
        errorCount: 1,
        lastTest: null,
      },
    ];
    const { service } = setup({ openai: () => keys });
    const status = await service.getStatus();
    const ai = component(status, 'ai');
    assert.equal(ai.state, 'degraded');
    assert.equal(
      ai.detail,
      '2 de 3 chaves funcionando · última resposta há 5 min · último erro: sem crédito na conta OpenAI há 12 min',
    );
    assert.ok(!JSON.stringify(status).includes('sk-live'));
    const incident = status.incidents.find((item) => item.type === 'ai_errors')!;
    assert.equal(incident.start, new Date(AT - 12 * MIN).toISOString());
  });

  test('Serviços de terceiros: indicador real e incidente com link; falha não quebra a página', async () => {
    const http = fakeFetch({
      'https://status.render.com': { body: fixture('statuspage-render-incident.json') },
      'https://www.vercel-status.com': { throws: Object.assign(new Error('x'), { name: 'AbortError' }) },
      'https://status.openai.com': { body: '{bad' },
      'https://api.status.io': { body: fixture('statusio-neon.json') },
      'https://whatsaibr.vercel.app': { status: 200, body: {} },
    });
    const { service } = setup({ fetcher: http.fetcher });
    const status = await service.getStatus();
    const third = status.groups.find((group) => group.id === 'terceiros')!;
    assert.deepEqual(
      third.components.map((item) => [item.id, item.state]),
      [
        ['upstream-render', 'degraded'],
        ['upstream-neon', 'degraded'],
        ['upstream-vercel', 'no_data'],
        ['upstream-openai', 'no_data'],
      ],
    );
    const render = third.components[0];
    assert.equal(render.detail, 'Degraded deploys in Ohio');
    assert.deepEqual(render.incidents, [{ name: 'Degraded deploys in Ohio', url: 'https://stspg.io/abc123' }]);
    assert.equal(third.components[2].detail, 'Página de status sem resposta (tempo esgotado)');
    assert.equal(
      status.incidents.find((item) => item.component === 'upstream-render')!.title,
      'Render: Degraded deploys in Ohio',
    );
    // terceiros não derrubam o estado geral, mas aparecem no resumo
    assert.equal(status.state, 'operational');
    assert.match(status.summary, /Terceiros: Render com instabilidade, Neon com instabilidade/);
  });

  test('cobertura honesta: sem registro anterior, só o período observado conta', async () => {
    const { service, clock } = setup();
    let status = await service.getStatus();
    assert.equal(status.history.length, 24);
    assert.equal(status.days.length, 90);
    assert.equal(status.days.filter((day) => Object.keys(day.components).length).length, 0);
    clock.now += 5 * MIN;
    await service.tick();
    clock.now += 31_000;
    status = await service.getStatus();
    assert.ok(status.coverage.last3d > 0 && status.coverage.last3d < 5);
    assert.equal(status.days.at(-1)!.components.api.state, 'operational');
    assert.ok(component(status, 'api').coverage90 > 0);
  });
});

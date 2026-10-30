import '../helpers/setup';

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { HttpFactory, ObservabilityService, renderActiveHours } from '@api/services/observability.service';
import {
  cuidFloor,
  readCgroupCpuLimit,
  readCgroupMemory,
  SystemDeps,
  SystemProbe,
} from '@api/services/observability.system';

import * as fx from '../fixtures/observability';

const NOW = Date.parse('2026-10-30T12:40:00.000Z');
const MB = 1024 * 1024;

// --------------------------------------------------------------------------------------------- fakes

const httpError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { isAxiosError: true, response: { status } });

type Call = { url: string; params?: Record<string, any>; headers: Record<string, string> };
type Handler = any | ((params: Record<string, any>) => any);

/** Answers `get` by "host/path" (e.g. "api.render.com/v1/services/srv-1"); unknown routes are 404. */
function fakeHttp(routes: Record<string, Handler>, calls: Call[] = []): HttpFactory {
  return (baseURL, headers) => ({
    get: async (path, config) => {
      const url = `${baseURL.replace(/^https:\/\//, '')}${path}`;
      calls.push({ url, params: config?.params, headers });
      if (!(url in routes)) throw httpError(404);
      const handler = routes[url];
      const value = typeof handler === 'function' ? handler(config?.params ?? {}) : handler;
      if (value instanceof Error) throw value;
      if (value instanceof Promise) return { data: await value };
      return { data: structuredClone(value) };
    },
  });
}

const neonRoutes = {
  'console.neon.tech/api/v2/projects/spring-boat-14626479': fx.neonProject,
  'console.neon.tech/api/v2/projects/spring-boat-14626479/branches': fx.neonBranches,
  'console.neon.tech/api/v2/projects/spring-boat-14626479/endpoints': fx.neonEndpoints,
};

const renderMetricRoute = (name: string) => (params: Record<string, any>) => {
  const kv = String(params.resource).startsWith('red-');
  if (name === 'memory') return kv ? fx.renderMetrics.keyValueMemory : fx.renderMetrics.memory;
  if (name === 'memory-limit') return kv ? fx.renderMetrics.keyValueMemoryLimit : fx.renderMetrics.memoryLimit;
  if (name === 'cpu') return params.resolutionSeconds === 3600 ? fx.renderMetrics.cpuHourly : fx.renderMetrics.cpu;
  if (name === 'cpu-limit') return fx.renderMetrics.cpuLimit;
  if (name === 'bandwidth') return fx.renderMetrics.bandwidth;
  return [];
};

const renderRoutes = {
  'api.render.com/v1/services/srv-dbd9qqi9lscs73aoe85g': fx.renderService,
  'api.render.com/v1/key-value/red-dbd9qp29lscs73aoe2s0': fx.renderKeyValue,
  'api.render.com/v1/services/srv-dbd9qqi9lscs73aoe85g/deploys': fx.renderDeploys,
  ...Object.fromEntries(
    ['cpu', 'cpu-limit', 'memory', 'memory-limit', 'bandwidth'].map((name) => [
      `api.render.com/v1/metrics/${name}`,
      renderMetricRoute(name),
    ]),
  ),
};

const vercelRoutes = {
  'api.vercel.com/v2/teams/team_L4ydLNVlb1XnoQd49WIvXRfw': fx.vercelTeam,
  'api.vercel.com/v9/projects/prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU': fx.vercelProject,
  'api.vercel.com/v6/deployments': fx.vercelDeployments,
};

const githubRoutes = {
  'api.github.com/repos/devconnecting1/evolution-api-render': fx.githubRepo,
  'api.github.com/repos/devconnecting1/evolution-api-render/actions/runs': fx.githubRuns,
  'api.github.com/users/devconnecting1/settings/billing/usage': fx.githubBillingUsage,
};

const fullEnv = {
  NEON_API_KEY: 'neon-test-not-real',
  NEON_PROJECT_ID: 'spring-boat-14626479',
  NEON_ORG_ID: 'org-soft-mouse-21767293',
  RENDER_API_KEY: 'rnd-test-not-real',
  RENDER_SERVICE_IDS: 'srv-dbd9qqi9lscs73aoe85g, red-dbd9qp29lscs73aoe2s0',
  VERCEL_TOKEN: 'vercel-test-not-real',
  VERCEL_TEAM_ID: 'team_L4ydLNVlb1XnoQd49WIvXRfw',
  VERCEL_PROJECT_ID: 'prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU',
  GITHUB_TOKEN: 'ghp-test-not-real',
};

const service = (env: Record<string, string>, routes: Record<string, Handler>, calls: Call[] = [], extra = {}) =>
  new ObservabilityService({ env, http: fakeHttp(routes, calls), now: () => NOW, system: null, ...extra });

const provider = async (id: string, env: Record<string, string>, routes: Record<string, Handler>, calls?: Call[]) =>
  (await service(env, routes, calls).getOverview()).providers.find((item) => item.id === id);

const metric = (view: any, id: string) => view.metrics.find((item: any) => item.id === id);

// ------------------------------------------------------------------------------------- system fakes

type SystemOptions = {
  rss?: number;
  files?: Record<string, string>;
  instancesInDb?: { connectionStatus: string; _count: { _all: number } }[];
  live?: Record<string, any>;
  failDb?: boolean;
  provider?: string;
  redis?: SystemDeps['cache'];
};

function systemDeps(options: SystemOptions = {}) {
  const queries: string[] = [];
  let cpuMicros = 0;
  let clock = NOW;
  const fail = () => Promise.reject(new Error('connection refused'));
  const files = options.files ?? {
    '/sys/fs/cgroup/memory.max': '536870912',
    '/sys/fs/cgroup/memory.current': '251658240',
    '/sys/fs/cgroup/cpu.max': '15000 100000',
  };

  const deps: SystemDeps = {
    prisma: {
      $queryRawUnsafe: async (query: string) => {
        queries.push(query);
        if (options.failDb) return fail();
        if (/size/i.test(query) && !/human/.test(query)) return [{ size: BigInt(42 * MB) }];
        return [{ human: 2, manual: 1 }];
      },
      instance: {
        groupBy: async () =>
          options.failDb
            ? fail()
            : (options.instancesInDb ?? [
                { connectionStatus: 'open', _count: { _all: 2 } },
                { connectionStatus: 'close', _count: { _all: 0 } },
              ]),
      },
      message: { count: async () => (options.failDb ? fail() : 137) },
      integrationSession: {
        groupBy: async () =>
          options.failDb
            ? fail()
            : [
                { status: 'opened', _count: { _all: 5 } },
                { status: 'paused', _count: { _all: 3 } },
                { status: 'closed', _count: { _all: 40 } },
              ],
      },
    },
    waInstances: () =>
      options.live ?? {
        'cliente-joao-5511999990000': { connectionStatus: { state: 'open' }, number: '5511999990000' },
        'loja-maria': { connectionStatus: { state: 'open' }, number: '5511888880000' },
      },
    databaseProvider: options.provider ?? 'postgresql',
    cache: options.redis ?? {
      redisEnabled: true,
      localEnabled: false,
      redisState: async () => ({ state: 'ready', latencyMs: 3 }),
    },
    env: {
      RENDER_GIT_COMMIT: 'e4e2cedcb53c3e4b839e48d92556706a1f723fa1',
      RENDER_SERVICE_ID: 'srv-dbd9qqi9lscs73aoe85g',
    },
    readFile: (path) => files[path] ?? null,
    memoryUsage: () => ({
      rss: options.rss ?? 200 * MB,
      heapUsed: 90 * MB,
      heapTotal: 120 * MB,
      external: 0,
      arrayBuffers: 0,
    }),
    // 7.5 ms of CPU per 250 ms window = 3% of one core = 20% of the 0.15 vCPU limit
    cpuUsage: () => ({ user: (cpuMicros += 7_500), system: 0 }),
    uptimeSeconds: () => 3 * 3600 + 30 * 60,
    totalMemory: () => 8 * 1024 * MB,
    cpuCount: () => 4,
    loadAverage: () => [0.1, 0.2, 0.3],
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    packageVersion: () => '2.3.7',
    nodeVersion: 'v20.0.0',
  };

  return { deps, queries };
}

// ------------------------------------------------------------------------------------------- System

describe('observability: Sistema provider', () => {
  test('healthy server: ok card with the expected metrics, first in the overview', async () => {
    const { deps } = systemDeps();
    const overview = await new ObservabilityService({
      env: {},
      http: fakeHttp({}),
      now: () => NOW,
      system: new SystemProbe(deps),
    }).getOverview();

    assert.deepEqual(
      overview.providers.map((item) => item.id),
      ['system', 'whatsapp', 'neon', 'render', 'vercel', 'github'],
    );
    const system = overview.providers[0];
    assert.equal(system.name, 'Sistema');
    assert.equal(system.status, 'ok');
    assert.equal(system.configured, true);
    assert.equal(system.plan, 'v2.3.7');
    assert.deepEqual(
      system.metrics.map((item) => item.id),
      ['memory', 'cpu', 'instances', 'messages_24h', 'chatbot_sessions', 'human_paused', 'database_size', 'uptime'],
    );

    assert.equal(metric(system, 'memory').used, 200 * MB);
    assert.equal(metric(system, 'memory').limit, 512 * MB);
    assert.equal(metric(system, 'memory').status, 'ok');
    assert.equal(Math.round(metric(system, 'cpu').used), 20);
    assert.equal(metric(system, 'cpu').limit, 100);
    assert.deepEqual([metric(system, 'instances').used, metric(system, 'instances').limit], [2, 2]);
    assert.equal(metric(system, 'messages_24h').used, 137);
    assert.equal(metric(system, 'chatbot_sessions').used, 8);
    assert.match(metric(system, 'chatbot_sessions').detail, /Abertas 5 · pausadas 3 · encerradas 40/);
    assert.equal(metric(system, 'human_paused').used, 2);
    assert.equal(metric(system, 'database_size').used, 42 * MB);
    assert.equal(metric(system, 'uptime').used, 210);
    assert.equal(metric(system, 'uptime').unit, 'minutes');

    const resources = Object.fromEntries(system.resources.map((item) => [item.id, item]));
    assert.match(resources.api.detail, /commit e4e2ced/);
    assert.equal(resources.database.status, 'conectado');
    assert.equal(resources.cache.type, 'Redis');
    assert.equal(resources.cache.status, 'conectado');
    assert.deepEqual(system.links, [
      { label: 'Serviço no Render', url: 'https://dashboard.render.com/web/srv-dbd9qqi9lscs73aoe85g' },
    ]);
  });

  test('never exposes instance names or phone numbers', async () => {
    const { deps } = systemDeps();
    const json = JSON.stringify(await new SystemProbe(deps).collect());
    assert.doesNotMatch(json, /cliente-joao|loja-maria|5511/);
  });

  test('memory above 90% of the container is critical and the card becomes partial', async () => {
    const { deps } = systemDeps({ rss: 470 * MB });
    const view = await new SystemProbe(deps).collect();
    assert.equal(metric(view, 'memory').status, 'critical');
    assert.equal(view.status, 'partial');
    assert.ok(view.notes.some((note) => /90%/.test(note)));
  });

  test('memory between 80% and 90% is a warning', async () => {
    const { deps } = systemDeps({ rss: 440 * MB });
    assert.equal(metric(await new SystemProbe(deps).collect(), 'memory').status, 'warning');
  });

  test('an instance that is not open makes the card partial (live state wins over the database)', async () => {
    const { deps } = systemDeps({
      live: { a: { connectionStatus: { state: 'open' } }, b: { connectionStatus: { state: 'connecting' } } },
    });
    const view = await new SystemProbe(deps).collect();
    const instances = metric(view, 'instances');
    assert.deepEqual([instances.used, instances.limit, instances.status], [1, 2, 'warning']);
    assert.match(instances.detail, /conectando 1/);
    assert.equal(view.status, 'partial');
    assert.ok(view.notes.some((note) => /1 instância\(s\) não conectada/.test(note)));
  });

  test('without live instances it falls back to the stored connectionStatus', async () => {
    const { deps } = systemDeps({
      live: {},
      instancesInDb: [
        { connectionStatus: 'open', _count: { _all: 1 } },
        { connectionStatus: 'close', _count: { _all: 2 } },
      ],
    });
    const instances = metric(await new SystemProbe(deps).collect(), 'instances');
    assert.deepEqual([instances.used, instances.limit], [1, 3]);
    assert.match(instances.detail, /estado salvo/);
  });

  test('a database failure is isolated: the card still answers, as partial, with unknown metrics', async () => {
    const { deps } = systemDeps({ failDb: true, live: {} });
    const view = await new SystemProbe(deps).collect();
    assert.equal(view.status, 'partial');
    assert.equal(metric(view, 'database_size').used, null);
    assert.equal(metric(view, 'messages_24h').status, 'unknown');
    assert.equal(view.resources.find((item) => item.id === 'database').status, 'sem resposta');
    assert.ok(view.notes.some((note) => /Não foi possível ler do banco/.test(note)));
  });

  test('MySQL uses information_schema and JSON_EXTRACT; Postgres uses pg_database_size and ->>', async () => {
    const mysql = systemDeps({ provider: 'mysql' });
    await new SystemProbe(mysql.deps).collect();
    assert.ok(mysql.queries.some((query) => /information_schema\.TABLES/.test(query)));
    assert.ok(mysql.queries.some((query) => /JSON_EXTRACT\(parameters, '\$\.humanLastMessageAt'\)/.test(query)));

    const pg = systemDeps();
    await new SystemProbe(pg.deps).collect();
    assert.ok(pg.queries.some((query) => /pg_database_size\(current_database\(\)\)/.test(query)));
    assert.ok(pg.queries.some((query) => /"parameters"->>'humanLastMessageAt' IS NOT NULL/.test(query)));
  });

  test('Redis enabled but not connected is reported; local cache and no cache are fine', async () => {
    const down = systemDeps({
      redis: { redisEnabled: true, localEnabled: false, redisState: async () => ({ state: 'connecting' }) },
    });
    const view = await new SystemProbe(down.deps).collect();
    assert.equal(view.resources.find((item) => item.id === 'cache').status, 'reconectando');
    assert.equal(view.status, 'partial');

    const local = systemDeps({ redis: { redisEnabled: false, localEnabled: true } });
    const localView = await new SystemProbe(local.deps).collect();
    assert.equal(localView.resources.find((item) => item.id === 'cache').status, 'ativo');
    assert.equal(localView.status, 'ok');
  });

  test('without a cgroup limit the machine memory and cores are used', async () => {
    const { deps } = systemDeps({ files: {} });
    const view = await new SystemProbe(deps).collect();
    assert.equal(metric(view, 'memory').limit, 8 * 1024 * MB);
    // 3% of one core over 4 cores
    assert.equal(metric(view, 'cpu').used, 0.75);
  });

  test('cgroup v1/v2 parsing', () => {
    const read = (files: Record<string, string>) => (path: string) => files[path] ?? null;
    assert.deepEqual(readCgroupMemory(read({ '/sys/fs/cgroup/memory.max': 'max' })), { limit: null, current: null });
    assert.deepEqual(
      readCgroupMemory(
        read({
          '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712',
          '/sys/fs/cgroup/memory/memory.usage_in_bytes': '1048576',
        }),
      ),
      { limit: null, current: 1048576 },
    );
    assert.equal(readCgroupCpuLimit(read({ '/sys/fs/cgroup/cpu.max': 'max 100000' })), null);
    assert.equal(readCgroupCpuLimit(read({ '/sys/fs/cgroup/cpu.max': '50000 100000' })), 0.5);
    assert.equal(
      readCgroupCpuLimit(
        read({ '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '-1', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000' }),
      ),
      null,
    );
    assert.equal(
      readCgroupCpuLimit(
        read({ '/sys/fs/cgroup/cpu/cpu.cfs_quota_us': '10000', '/sys/fs/cgroup/cpu/cpu.cfs_period_us': '100000' }),
      ),
      0.1,
    );
  });
});

// ------------------------------------------------------------------------------- overview behavior

describe('observability: overview without keys, cache and isolation', () => {
  test('without any key every external provider is "missing" with the exact variables and where to create them', async () => {
    const calls: Call[] = [];
    const started = Date.now();
    const overview = await service({}, {}, calls).getOverview();

    assert.ok(Date.now() - started < 500);
    assert.equal(calls.length, 0);
    const byId = Object.fromEntries(overview.providers.map((item) => [item.id, item]));
    assert.deepEqual(byId.neon.missingEnv, ['NEON_API_KEY', 'NEON_PROJECT_ID']);
    assert.deepEqual(byId.render.missingEnv, ['RENDER_API_KEY']);
    assert.deepEqual(byId.vercel.missingEnv, ['VERCEL_TOKEN', 'VERCEL_TEAM_ID', 'VERCEL_PROJECT_ID']);
    assert.deepEqual(byId.github.missingEnv, ['GITHUB_TOKEN']);
    for (const view of overview.providers) {
      assert.equal(view.status, 'missing');
      assert.equal(view.configured, false);
      assert.ok(view.notes.includes(`Variáveis necessárias: ${view.missingEnv.join(', ')}.`));
      assert.ok(view.links.length >= 1 && view.links.every((link) => link.url.startsWith('https://')));
    }
    assert.match(byId.neon.links[0].url, /console\.neon\.tech/);
    assert.match(byId.render.links[0].url, /dashboard\.render\.com/);
    assert.match(byId.vercel.links[0].url, /vercel\.com\/account\/settings\/tokens/);
    assert.match(byId.github.links[0].url, /github\.com\/settings\/personal-access-tokens/);
  });

  test('only the variables that are actually missing are listed', async () => {
    const view = await provider('neon', { NEON_API_KEY: 'x' }, {});
    assert.deepEqual(view.missingEnv, ['NEON_PROJECT_ID']);
    assert.ok(view.notes.includes('Variáveis necessárias: NEON_PROJECT_ID.'));
  });

  test('60s cache, refresh forces a new read', async () => {
    const calls: Call[] = [];
    let now = NOW;
    const svc = new ObservabilityService({
      env: { GITHUB_TOKEN: 'x' },
      http: fakeHttp(githubRoutes, calls),
      now: () => now,
      system: null,
    });
    const first = await svc.getOverview();
    const count = calls.length;
    assert.equal(first.cached, false);
    assert.equal(first.cacheTtlSeconds, 60);

    now += 30_000;
    assert.equal((await svc.getOverview()).cached, true);
    assert.equal(calls.length, count);

    assert.equal((await svc.getOverview(true)).cached, false);
    assert.equal(calls.length, count * 2);

    now += 61_000;
    assert.equal((await svc.getOverview()).cached, false);
  });

  test('a provider that hangs becomes an error card without delaying the others', async () => {
    const hang = () => new Promise(() => undefined);
    const svc = service(
      { ...fullEnv },
      { ...neonRoutes, 'api.github.com/repos/devconnecting1/evolution-api-render': hang, ...vercelRoutes },
      [],
      { providerTimeoutMs: 50 },
    );
    const routesWithHang = await svc.getOverview();
    const github = routesWithHang.providers.find((item) => item.id === 'github');
    assert.equal(github.status, 'error');
    assert.equal(github.error, 'O provedor não respondeu dentro do tempo esperado.');
    assert.notEqual(routesWithHang.providers.find((item) => item.id === 'neon').status, 'error');
  });

  test('errors are short and never carry the token', async () => {
    const neon = await provider('neon', fullEnv, {
      'console.neon.tech/api/v2/projects/spring-boat-14626479': httpError(401),
    });
    assert.equal(neon.status, 'error');
    assert.equal(neon.error, 'Credencial inválida ou sem permissão.');

    const leaky = await provider('neon', fullEnv, {
      'console.neon.tech/api/v2/projects/spring-boat-14626479': new Error('Bearer neon-test-not-real rejected'),
    });
    assert.equal(leaky.error, 'Falha ao consultar o provedor.');
    assert.doesNotMatch(JSON.stringify(leaky), /neon-test-not-real/);

    const notFound = await provider('neon', fullEnv, {});
    assert.equal(notFound.error, 'Recurso não encontrado: confira os IDs configurados.');
  });
});

// ----------------------------------------------------------------------------------------- Neon

describe('observability: Neon (real response shape)', () => {
  test('free_v3 project: storage summed across branches, CU-hours, egress and branches against the Free limits', async () => {
    const calls: Call[] = [];
    const view = await provider('neon', fullEnv, neonRoutes, calls);

    // partial: at the pace of the fixture a full month would exceed the 100 CU-hours (see the projection test)
    assert.equal(view.status, 'partial');
    assert.equal(view.plan, 'Free');
    // the plan comes with the project: the organization endpoint (not readable by project-scoped keys) is skipped
    assert.ok(!calls.some((call) => call.url.includes('/organizations/')));
    assert.equal(calls[0].headers.Authorization, 'Bearer neon-test-not-real');

    const storage = metric(view, 'storage');
    // Neon documents the Free cap as the logical_size summed across branches; the limit comes from the project
    assert.deepEqual([storage.used, storage.limit], [40484864 + 2 * 34660352, 1024 * MB]);
    assert.match(storage.detail, /3 branch\(es\) somadas · production 38,6 MB/);

    const compute = metric(view, 'compute');
    assert.equal(compute.unit, 'cu_hours');
    assert.equal(Math.round(compute.used * 100) / 100, 33.68);
    assert.equal(compute.limit, 100);
    assert.equal(metric(view, 'egress').used, 178364830);
    // Neon bills in decimal GB
    assert.equal(metric(view, 'egress').limit, 5e9);
    assert.equal(Math.round(metric(view, 'active_time').used), 132);
    assert.deepEqual([metric(view, 'branches').used, metric(view, 'branches').limit], [3, 10]);

    assert.equal(view.resources[0].status, 'active');
    assert.equal(view.resources[0].type, 'Postgres 16');
    assert.match(view.resources[0].detail, /Compute 0.25-2 CU/);
    assert.ok(view.notes.some((note) => /termina em 31\/10/.test(note)));
  });

  test('without owner.subscription_type the organization plan is used', async () => {
    const project = structuredClone(fx.neonProject);
    delete (project.project as any).owner;
    const view = await provider('neon', fullEnv, {
      ...neonRoutes,
      'console.neon.tech/api/v2/projects/spring-boat-14626479': project,
      'console.neon.tech/api/v2/organizations/org-soft-mouse-21767293': fx.neonOrganization,
    });
    assert.equal(view.plan, 'Free');
    assert.equal(metric(view, 'compute').limit, 100);
  });

  test('branches failing makes the card partial', async () => {
    const view = await provider('neon', fullEnv, {
      ...neonRoutes,
      'console.neon.tech/api/v2/projects/spring-boat-14626479/branches': httpError(500),
    });
    assert.equal(view.status, 'partial');
    assert.equal(metric(view, 'storage').used, null);
  });
});

// --------------------------------------------------------------------------------------- Render

describe('observability: Render (real response shape)', () => {
  test('web service + Key Value from RENDER_SERVICE_IDS: memory/CPU against the reported limits', async () => {
    const calls: Call[] = [];
    const view = await provider('render', fullEnv, renderRoutes, calls);

    assert.equal(view.status, 'ok');
    assert.equal(view.plan, 'Free');
    // the Key Value is read from /key-value (it is not a /services resource)
    assert.ok(calls.some((call) => call.url === 'api.render.com/v1/key-value/red-dbd9qp29lscs73aoe2s0'));
    assert.ok(!calls.some((call) => call.url.endsWith('/metrics/instance-count')));

    const memory = metric(view, 'memory_srv-dbd9qqi9lscs73aoe85g');
    assert.deepEqual([memory.used, memory.limit, memory.unit], [233930750, 536870900, 'bytes']);
    const cpu = metric(view, 'cpu_srv-dbd9qqi9lscs73aoe85g');
    assert.equal(Math.round(cpu.used * 10) / 10, 1.4);
    assert.match(cpu.detail, /0,002 de 0,15 vCPU/);

    const kv = metric(view, 'memory_red-dbd9qp29lscs73aoe2s0');
    assert.deepEqual([kv.used, kv.limit], [6467584, 26214400]);

    // three distinct hours (the two instances overlap at 01:00)
    assert.deepEqual([metric(view, 'instance_hours').used, metric(view, 'instance_hours').limit], [3, 750]);
    assert.equal(Math.round(metric(view, 'bandwidth').used), Math.round((1.5406828 + 2.459055) * MB));

    const metricsCall = calls.find(
      (call) => call.url.endsWith('/metrics/cpu') && call.params.resolutionSeconds === 3600,
    );
    assert.equal(metricsCall.params.startTime, '2026-10-01T00:00:00.000Z');
    assert.equal(metricsCall.params.resource, 'srv-dbd9qqi9lscs73aoe85g');

    const [web, redis] = view.resources;
    assert.deepEqual([web.status, web.plan, web.url], ['live', 'Free', 'https://evolution-api-x93o.onrender.com']);
    assert.match(web.detail, /commit e4e2ced/);
    assert.deepEqual([redis.type, redis.status], ['Key Value 8.1.10', 'available']);
    assert.deepEqual(view.links, [
      { label: 'Abrir evolution-api', url: 'https://dashboard.render.com/web/srv-dbd9qqi9lscs73aoe85g' },
    ]);
  });

  test('without RENDER_SERVICE_IDS it lists the workspace services and Key Value instances', async () => {
    const calls: Call[] = [];
    const view = await provider(
      'render',
      { RENDER_API_KEY: 'x' },
      {
        ...renderRoutes,
        'api.render.com/v1/owners': [{ cursor: 'c', owner: { id: 'tea-dbd7a58m7kps73c2cr5g', name: 'My Workspace' } }],
        'api.render.com/v1/services': [{ cursor: 'c', service: fx.renderService }],
        'api.render.com/v1/key-value': [{ cursor: 'c', keyValue: fx.renderKeyValue }],
      },
      calls,
    );
    assert.equal(view.status, 'ok');
    assert.equal(view.resources.length, 2);
    assert.equal(calls.find((call) => call.url.endsWith('/v1/services')).params.ownerId, 'tea-dbd7a58m7kps73c2cr5g');
  });

  test('a failed deploy or unreadable metrics make the card partial', async () => {
    const failed = structuredClone(fx.renderDeploys);
    failed[0].deploy.status = 'build_failed';
    const view = await provider('render', fullEnv, {
      ...renderRoutes,
      'api.render.com/v1/services/srv-dbd9qqi9lscs73aoe85g/deploys': failed,
      'api.render.com/v1/metrics/memory': httpError(500),
    });
    assert.equal(view.status, 'partial');
    assert.ok(view.notes.some((note) => /build_failed/.test(note)));
    assert.ok(view.notes.some((note) => /métricas do Render/.test(note)));
  });

  test('renderActiveHours counts distinct hourly buckets with data', () => {
    assert.equal(renderActiveHours(fx.renderMetrics.cpuHourly), 3);
    assert.equal(renderActiveHours([]), null);
    assert.equal(renderActiveHours(null), null);
  });
});

// --------------------------------------------------------------------------------------- Vercel

describe('observability: Vercel (real response shape)', () => {
  test('Hobby project: deploys per day against the limit, build time against 45 min, production domains', async () => {
    const calls: Call[] = [];
    const view = await provider('vercel', fullEnv, vercelRoutes, calls);

    assert.equal(view.status, 'ok');
    assert.equal(view.plan, 'Hobby');
    const list = calls.find((call) => call.url.endsWith('/v6/deployments'));
    assert.deepEqual(
      { projectId: list.params.projectId, teamId: list.params.teamId, limit: list.params.limit },
      { projectId: 'prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU', teamId: 'team_L4ydLNVlb1XnoQd49WIvXRfw', limit: 100 },
    );

    assert.deepEqual([metric(view, 'deployments_24h').used, metric(view, 'deployments_24h').limit], [2, 100]);
    assert.equal(metric(view, 'deployments').used, 3);
    assert.equal(metric(view, 'last_build').used, 0.5);
    assert.equal(metric(view, 'last_build').limit, 45);
    assert.equal(metric(view, 'build_minutes').used, 2);

    const [project] = view.resources;
    assert.equal(project.name, 'whatsai-manager');
    assert.equal(project.status, 'ready');
    assert.equal(project.url, 'https://whatsaibr.vercel.app');
    assert.match(project.detail, /commit e4e2ced/);
    assert.deepEqual(view.links, [
      { label: 'Abrir projeto', url: 'https://vercel.com/matheus-projects-309a1b5f/whatsai-manager' },
      { label: 'Ver usage', url: 'https://vercel.com/matheus-projects-309a1b5f/~/usage' },
    ]);
  });

  test('legacy project.alias and a team without billing still work', async () => {
    const project = { ...fx.vercelProject, targets: undefined, alias: [{ domain: 'whatsaibr.vercel.app' }] };
    const { billing, ...team } = fx.vercelTeam;
    assert.ok(billing);
    const view = await provider('vercel', fullEnv, {
      ...vercelRoutes,
      'api.vercel.com/v2/teams/team_L4ydLNVlb1XnoQd49WIvXRfw': team,
      'api.vercel.com/v9/projects/prj_1qlhQq1PuLn20KRs2FK0fsD0GIvU': project,
    });
    assert.equal(view.plan, null);
    assert.equal(metric(view, 'deployments_24h').limit, null);
    assert.equal(view.resources[0].url, 'https://whatsaibr.vercel.app');
  });

  test('a failed production deploy makes the card partial', async () => {
    const deployments = structuredClone(fx.vercelDeployments);
    deployments.deployments[0].readyState = 'ERROR';
    const view = await provider('vercel', fullEnv, { ...vercelRoutes, 'api.vercel.com/v6/deployments': deployments });
    assert.equal(view.status, 'partial');
    assert.equal(metric(view, 'deployments').status, 'warning');
  });
});

// --------------------------------------------------------------------------------------- GitHub

describe('observability: GitHub (Actions runs + billing usage report)', () => {
  test('Actions minutes come from the usage report (the old /settings/billing/actions is never called)', async () => {
    const calls: Call[] = [];
    const view = await provider('github', fullEnv, githubRoutes, calls);

    assert.equal(view.status, 'ok');
    assert.ok(!calls.some((call) => call.url.includes('/settings/billing/actions')));
    const usage = calls.find((call) => call.url.endsWith('/settings/billing/usage'));
    assert.deepEqual(usage.params, { year: 2026, month: 10 });

    const minutes = metric(view, 'actions_minutes');
    assert.deepEqual([minutes.used, minutes.limit, minutes.unit], [155.5, 2000, 'count']);
    const runs = metric(view, 'runs');
    assert.equal(runs.used, 64);
    assert.equal(runs.status, 'warning');
    assert.match(runs.detail, /1 falha/);
    assert.equal(view.resources[0].status, 'privado');
    assert.match(view.resources[0].detail, /Deploy Manager · success/);
  });

  test('billing without permission (403) or unavailable (404/410) is partial with a hint, runs still shown', async () => {
    for (const [status, pattern] of [
      [403, /Plan/],
      [404, /HTTP 404/],
      [410, /HTTP 410/],
    ] as const) {
      const view = await provider('github', fullEnv, {
        ...githubRoutes,
        'api.github.com/users/devconnecting1/settings/billing/usage': httpError(status),
      });
      assert.equal(view.status, 'partial');
      assert.ok(
        view.notes.some((note) => pattern.test(note)),
        `${status}: ${view.notes.join(' | ')}`,
      );
      assert.equal(metric(view, 'actions_minutes'), undefined);
      assert.equal(metric(view, 'runs').used, 64);
    }
  });

  test('organization repositories use the organization usage report; invalid token is an error', async () => {
    const calls: Call[] = [];
    await provider(
      'github',
      { GITHUB_TOKEN: 'x', GITHUB_OWNER: 'acme', GITHUB_REPO: 'api' },
      {
        'api.github.com/repos/acme/api': { ...fx.githubRepo, owner: { login: 'acme', type: 'Organization' } },
        'api.github.com/repos/acme/api/actions/runs': fx.githubRuns,
        'api.github.com/organizations/acme/settings/billing/usage': fx.githubBillingUsage,
      },
      calls,
    );
    assert.ok(calls.some((call) => call.url === 'api.github.com/organizations/acme/settings/billing/usage'));

    const invalid = await provider('github', fullEnv, {
      'api.github.com/repos/devconnecting1/evolution-api-render': httpError(401),
      'api.github.com/repos/devconnecting1/evolution-api-render/actions/runs': httpError(401),
    });
    assert.equal(invalid.status, 'error');

    const network = Object.assign(new Error('getaddrinfo ENOTFOUND api.github.com'), { isAxiosError: true });
    const unreachable = await provider('github', fullEnv, {
      'api.github.com/repos/devconnecting1/evolution-api-render': network,
      'api.github.com/repos/devconnecting1/evolution-api-render/actions/runs': network,
    });
    assert.equal(unreachable.status, 'error');
    assert.equal(unreachable.error, 'Sem resposta do provedor (rede indisponível ou tempo esgotado).');
  });
});

// ------------------------------------------------------------------------ fixes of the verification

describe('observability: degraded responses, forced refresh and alerts', () => {
  test('a non-JSON body (HTML of a proxy, empty) is an error, never "zero deploys" or "public repository"', async () => {
    for (const body of ['<html>Bad gateway</html>', '', null]) {
      const overview = await service(fullEnv, {
        ...neonRoutes,
        'api.vercel.com/v6/deployments': body,
        'api.github.com/repos/devconnecting1/evolution-api-render': body,
        'api.github.com/repos/devconnecting1/evolution-api-render/actions/runs': body,
      }).getOverview();
      const byId = Object.fromEntries(overview.providers.map((item) => [item.id, item]));
      assert.equal(byId.vercel.status, 'error');
      assert.equal(byId.vercel.error, 'Resposta inválida do provedor (não é JSON).');
      assert.equal(byId.github.status, 'error');
      assert.notEqual(byId.neon.status, 'error');
    }
  });

  test('GitHub: a token without access to the repository (403 on every read) is an error card', async () => {
    const view = await provider('github', fullEnv, {
      'api.github.com/repos/devconnecting1/evolution-api-render': httpError(403),
      'api.github.com/repos/devconnecting1/evolution-api-render/actions/runs': httpError(403),
    });
    assert.equal(view.status, 'error');
    assert.equal(view.error, 'Credencial inválida ou sem permissão.');
    // the error card says what to check and where to create a new key
    assert.match(view.notes[0], /^Confira GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO no Environment/);
    assert.deepEqual(
      view.links.map((link) => link.label),
      ['Criar token', 'Como criar'],
    );

    const down = await provider('neon', fullEnv, {
      'console.neon.tech/api/v2/projects/spring-boat-14626479': httpError(503),
    });
    assert.equal(down.error, 'Falha na API do provedor (HTTP 503).');
    assert.match(down.notes[0], /instável/);
  });

  test('GitHub organization billing without permission asks for "Administration", not "Plan"', async () => {
    const view = await provider(
      'github',
      { GITHUB_TOKEN: 'x', GITHUB_OWNER: 'acme', GITHUB_REPO: 'api' },
      {
        'api.github.com/repos/acme/api': { ...fx.githubRepo, owner: { login: 'acme', type: 'Organization' } },
        'api.github.com/repos/acme/api/actions/runs': fx.githubRuns,
        'api.github.com/organizations/acme/settings/billing/usage': httpError(403),
      },
    );
    assert.ok(view.notes.some((note) => /Administration/.test(note)));
  });

  test('a forced refresh right after a build reuses it (5s); later it reads again', async () => {
    const calls: Call[] = [];
    let now = NOW;
    const svc = new ObservabilityService({
      env: { GITHUB_TOKEN: 'x' },
      http: fakeHttp(githubRoutes, calls),
      now: () => now,
      system: null,
    });
    await svc.getOverview(true);
    const count = calls.length;
    now += 2_000;
    assert.equal((await svc.getOverview(true)).cached, true);
    assert.equal(calls.length, count);
    now += 4_000;
    assert.equal((await svc.getOverview(true)).cached, false);
    assert.equal(calls.length, count * 2);
  });

  test('metrics at 80% or more of a quota are listed in alerts and summarized on the card', async () => {
    const overview = await service(fullEnv, { ...neonRoutes }).getOverview();
    const neon = overview.providers.find((item) => item.id === 'neon');
    assert.deepEqual(
      overview.alerts.map((alert) => [alert.provider, alert.metric, alert.status]),
      [['neon', 'compute_projection', 'critical']],
    );
    assert.match(overview.alerts[0].message, /^Neon: Compute projetado \(mês\) em 137% do limite\.$/);
    assert.match(neon.notes[0], /^Atenção: Compute projetado \(mês\) em 137% do limite\.$/);
  });

  test('connected instances (higher is better) never become an alert', async () => {
    const { deps } = systemDeps();
    const overview = await new ObservabilityService({
      env: {},
      http: fakeHttp({}),
      now: () => NOW,
      system: new SystemProbe(deps),
    }).getOverview();
    const system = overview.providers.find((item) => item.id === 'system');
    assert.equal(metric(system, 'instances').percent, 100);
    assert.equal(metric(system, 'instances').higherIsBetter, true);
    assert.deepEqual(overview.alerts, []);
  });
});

describe('observability: Neon CU-hour projection', () => {
  const withPeriod = (computeSeconds: number, start: string, end: string) => {
    const project = structuredClone(fx.neonProject);
    Object.assign(project.project, {
      compute_time_seconds: computeSeconds,
      consumption_period_start: start,
      consumption_period_end: end,
    });
    return { ...neonRoutes, 'console.neon.tech/api/v2/projects/spring-boat-14626479': project };
  };

  test('a first, shorter period is projected to a full Neon month (744 h) and warns when the compute stops', async () => {
    const view = await provider('neon', fullEnv, neonRoutes);
    const projection = metric(view, 'compute_projection');
    // 33.68 CU-h in 183.3 h since 22/10 21:23 = 4.41 CU-h/day -> 136.7 CU-h in 744 h
    assert.equal(Math.round(projection.used), 137);
    assert.equal(projection.limit, 100);
    assert.equal(projection.status, 'critical');
    assert.match(projection.detail, /Ritmo de 4,4 CU-h\/dia · estimativa para um mês completo/);
    assert.ok(view.notes.some((note) => /acabariam por volta do dia 23 .*suspenso/.test(note)));
  });

  test('a full period at a safe pace has no warning; at a fast pace it says the date the limit is reached', async () => {
    // 10 days of 31 at 1 CU-h/day
    const safe = await provider('neon', fullEnv, withPeriod(10 * 3600, '2026-10-20T12:40:00Z', '2026-11-20T12:40:00Z'));
    assert.equal(Math.round(metric(safe, 'compute_projection').used), 31);
    assert.equal(metric(safe, 'compute_projection').status, 'ok');
    assert.ok(!safe.notes.some((note) => /No ritmo atual/.test(note)));
    assert.equal(safe.status, 'ok');

    // 50 CU-h in the first 10 days -> 100 CU-h on day 20 (09/11 12:40 UTC = 09:40 in São Paulo)
    const fast = await provider('neon', fullEnv, withPeriod(50 * 3600, '2026-10-20T12:40:00Z', '2026-11-20T12:40:00Z'));
    assert.equal(Math.round(metric(fast, 'compute_projection').used), 155);
    assert.ok(
      fast.notes.some((note) => /acabam por volta de 09\/11, 09:40/.test(note)),
      fast.notes.join(' | '),
    );
  });

  test('no projection without a consumption period or in its first hours', async () => {
    const young = await provider('neon', fullEnv, withPeriod(3600, '2026-10-30T10:40:00Z', '2026-11-30T00:00:00Z'));
    assert.equal(metric(young, 'compute_projection'), undefined);
    const unknown = await provider('neon', fullEnv, withPeriod(3600, '', ''));
    assert.equal(metric(unknown, 'compute_projection'), undefined);
  });
});

describe('observability: cgroup of a nested process and the 24h message count', () => {
  test('without a cgroup namespace the limits are read from the process cgroup (and its ancestors)', () => {
    const read = (files: Record<string, string>) => (path: string) => files[path] ?? null;
    // cgroup v1 with the controllers nested (the root reports "unlimited" and the usage of the whole machine)
    const v1 = read({
      '/proc/self/cgroup': '4:memory:/kubepods/pod1/abc\n2:cpu,cpuacct:/kubepods/pod1/abc\n0::/',
      '/sys/fs/cgroup/memory/memory.limit_in_bytes': '9223372036854771712',
      '/sys/fs/cgroup/memory/memory.usage_in_bytes': '15000000000',
      '/sys/fs/cgroup/memory/kubepods/pod1/memory.limit_in_bytes': '1073741824',
      '/sys/fs/cgroup/memory/kubepods/pod1/abc/memory.limit_in_bytes': '9223372036854771712',
      '/sys/fs/cgroup/memory/kubepods/pod1/abc/memory.usage_in_bytes': '104857600',
      '/sys/fs/cgroup/cpu,cpuacct/kubepods/pod1/abc/cpu.cfs_quota_us': '15000',
      '/sys/fs/cgroup/cpu,cpuacct/kubepods/pod1/abc/cpu.cfs_period_us': '100000',
    });
    assert.deepEqual(readCgroupMemory(v1), { limit: 1073741824, current: 104857600 });
    assert.equal(readCgroupCpuLimit(v1), 0.15);

    // cgroup v2 without namespace: the root has no memory.max, the service cgroup does
    const v2 = read({
      '/proc/self/cgroup': '0::/system.slice/app.service',
      '/sys/fs/cgroup/system.slice/app.service/memory.max': '536870912',
      '/sys/fs/cgroup/system.slice/app.service/memory.current': '201326592',
      '/sys/fs/cgroup/system.slice/app.service/cpu.max': '15000 100000',
    });
    assert.deepEqual(readCgroupMemory(v2), { limit: 536870912, current: 201326592 });
    assert.equal(readCgroupCpuLimit(v2), 0.15);
  });

  test('the 24h count is bounded by the cuid of 24h ago (primary key range) and the message timestamp', async () => {
    const counted: any[] = [];
    const { deps } = systemDeps();
    deps.prisma.message.count = async (args: any) => {
      counted.push(args);
      return 3;
    };
    await new SystemProbe(deps).collect();
    // the fake clock moves 250 ms while the CPU is sampled
    const since = NOW - 24 * 3600 * 1000;
    const { id, messageTimestamp } = counted[0].where;
    assert.deepEqual(Object.keys(counted[0].where), ['id', 'messageTimestamp']);
    assert.ok(id.gte >= cuidFloor(since) && id.gte <= cuidFloor(since + 1000), id.gte);
    assert.equal(id.gte.length, 9);
    assert.ok(Math.abs(messageTimestamp.gte - Math.floor(since / 1000)) <= 1);
    // Prisma's cuid(): "c" + 8 base36 chars of the creation time in ms (id below created on 30/10 ~14:42 UTC)
    assert.equal(cuidFloor(1793371350000), `c${(1793371350000).toString(36)}`);
    assert.ok('cmvv352j200007db8fqo7zmvx' > cuidFloor(Date.parse('2026-10-30T14:00:00Z')));
    assert.ok('cmvv352j200007db8fqo7zmvx' < cuidFloor(Date.parse('2026-10-30T16:00:00Z')));
  });
});

describe('observability: WhatsApp card (connection per instance)', () => {
  const rows = [
    { id: 'c1', name: 'cliente-padaria', connectionStatus: 'open', integration: 'WHATSAPP-BAILEYS' },
    {
      id: 'c2',
      name: 'cliente-clinica',
      connectionStatus: 'close',
      integration: 'WHATSAPP-BAILEYS',
      disconnectionReasonCode: 401,
      disconnectionAt: new Date('2026-10-30T09:00:00Z'),
    },
    { id: 'c3', name: 'cliente-advocacia', connectionStatus: 'open', integration: 'WHATSAPP-BUSINESS' },
    { id: 'c4', name: 'cliente-oficina', connectionStatus: 'connecting', integration: 'WHATSAPP-BAILEYS' },
  ];

  const probe = (live: Record<string, any>, findMany?: () => Promise<any[]>) => {
    const { deps } = systemDeps({ live });
    deps.prisma.instance.findMany = findMany ?? (async () => structuredClone(rows));
    return new SystemProbe(deps);
  };

  test('disconnected first, live state over the stored one, reasons in plain words, no phone numbers', async () => {
    const view = await probe({
      'cliente-padaria': { connectionStatus: { state: 'close', statusReason: 440 }, number: '5511999990000' },
      'cliente-advocacia': { connectionStatus: { state: 'open' } },
    }).collectWhatsapp();

    assert.equal(view.id, 'whatsapp');
    assert.equal(view.status, 'partial');
    assert.deepEqual(
      view.resources.map((item) => [item.name, item.status]),
      [
        ['cliente-clinica', 'desconectada'],
        ['cliente-padaria', 'desconectada'],
        ['cliente-oficina', 'conectando'],
        ['cliente-advocacia', 'conectada'],
      ],
    );
    const byName = Object.fromEntries(view.resources.map((item) => [item.name, item]));
    assert.match(byName['cliente-clinica'].detail, /desde 30\/10, 06:00 · sessão encerrada no celular/);
    assert.match(byName['cliente-clinica'].detail, /não carregada neste servidor/);
    assert.match(byName['cliente-padaria'].detail, /aberta em outro lugar/);
    assert.equal(byName['cliente-advocacia'].type, 'Cloud API (Meta)');
    assert.equal(byName['cliente-padaria'].url, '/manager/instance/c1/dashboard');

    const connected = metric(view, 'connected');
    assert.deepEqual([connected.used, connected.limit, connected.status], [1, 4, 'warning']);
    assert.ok(view.notes.some((note) => /3 instância\(s\) sem conexão/.test(note)));
    assert.doesNotMatch(JSON.stringify(view), /5511/);
  });

  test('all connected is ok; a database failure falls back to the loaded instances', async () => {
    const ok = await probe({}, async () => rows.filter((row) => row.connectionStatus === 'open')).collectWhatsapp();
    assert.equal(ok.status, 'ok');

    const failed = await probe({ 'loja-1': { connectionStatus: { state: 'open' } } }, () =>
      Promise.reject(new Error('db down')),
    ).collectWhatsapp();
    assert.equal(failed.status, 'partial');
    assert.deepEqual(
      failed.resources.map((item) => item.name),
      ['loja-1'],
    );
    assert.ok(failed.notes.some((note) => /Banco indisponível/.test(note)));
  });
});

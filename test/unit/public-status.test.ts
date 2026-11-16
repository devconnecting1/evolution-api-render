import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import type { ProviderView } from '@api/services/observability.shared';
import {
  normalizeStore,
  PublicSnapshot,
  PublicStatusService,
  PublicStatusStore,
} from '@api/services/public-status.core';

const AT = Date.UTC(2026, 10, 16, 12, 0, 0);

function systemView(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: 'system',
    name: 'Sistema',
    description: 'Servidor da API, banco e instâncias',
    configured: true,
    plan: 'v2.3.5',
    status: 'ok',
    updatedAt: new Date(AT).toISOString(),
    metrics: [
      {
        id: 'uptime',
        label: 'Uptime do processo',
        used: 120,
        limit: null,
        unit: 'minutes',
        percent: null,
        status: 'ok',
      },
      {
        id: 'database_size',
        label: 'Tamanho do banco',
        used: 10,
        limit: null,
        unit: 'bytes',
        percent: null,
        status: 'ok',
      },
    ],
    resources: [
      { id: 'api', name: 'API WhatsAI', type: 'Evolution API v2.3.5', status: 'online', detail: 'commit abc1234' },
      {
        id: 'database',
        name: 'Banco de dados',
        type: 'PostgreSQL',
        status: 'conectado',
        detail: 'Consulta em 4 ms',
      },
    ],
    notes: [],
    links: [],
    ...overrides,
  };
}

function whatsappView(overrides: Partial<ProviderView> = {}): ProviderView {
  return {
    id: 'whatsapp',
    name: 'WhatsApp',
    description: 'Conexão de cada instância (número)',
    configured: true,
    plan: null,
    status: 'ok',
    updatedAt: new Date(AT).toISOString(),
    metrics: [],
    resources: [
      {
        id: 'instance-1',
        name: 'Cliente Confidencial',
        type: 'WhatsApp Web',
        status: 'conectada',
        url: '/manager/instance/instance-1/dashboard',
      },
      {
        id: 'instance-2',
        name: 'Outro Cliente',
        type: 'WhatsApp Web',
        status: 'conectada',
        url: '/manager/instance/instance-2/dashboard',
      },
    ],
    notes: [],
    links: [],
    ...overrides,
  };
}

function serviceWith(
  snapshot: () => Promise<PublicSnapshot>,
  options: { now?: () => number; saved?: { value: unknown } } = {},
) {
  const saved = options.saved ?? { value: null };
  const service = new PublicStatusService({
    snapshot,
    readStore: async () => saved.value,
    writeStore: async (value: PublicStatusStore) => {
      saved.value = JSON.parse(JSON.stringify(value));
    },
    now: options.now ?? (() => AT),
    cacheTtlMs: 0,
  });
  return { service, saved };
}

function componentState(data: Awaited<ReturnType<PublicStatusService['getStatus']>>, id: string): string {
  return data.groups.flatMap((group) => group.components).find((component) => component.id === id)?.state ?? 'missing';
}

describe('public status', () => {
  test('maps the system and WhatsApp views without exposing instance data', async () => {
    const { service } = serviceWith(async () => ({ system: systemView(), whatsapp: whatsappView() }));
    const data = await service.getStatus(true);

    assert.equal(data.state, 'operational');
    assert.equal(data.title, 'Todos os sistemas operacionais');
    assert.equal(componentState(data, 'whatsapp-web'), 'operational');
    assert.equal(componentState(data, 'whatsapp-cloud'), 'no_data');
    assert.equal(componentState(data, 'api'), 'operational');
    assert.equal(componentState(data, 'database'), 'operational');
    assert.equal(componentState(data, 'site'), 'operational');
    assert.equal(data.history.length, 56);
    assert.equal(data.history.at(-1)?.components['whatsapp-web'], 'operational');
    const json = JSON.stringify(data);
    assert.equal(json.includes('Cliente Confidencial'), false);
    assert.equal(json.includes('Outro Cliente'), false);
    assert.equal(json.includes('instance-1'), false);
    assert.equal(json.includes('5511'), false);
  });

  test('shares one probe between concurrent requests', async () => {
    let calls = 0;
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const service = new PublicStatusService({
      snapshot: async () => {
        calls++;
        await gate;
        return { system: systemView(), whatsapp: whatsappView() };
      },
      readStore: async () => null,
      writeStore: async () => undefined,
      now: () => AT,
      cacheTtlMs: 0,
    });

    const first = service.getStatus(true);
    const second = service.getStatus(true);
    release();
    const [a, b] = await Promise.all([first, second]);

    assert.equal(calls, 1);
    assert.deepEqual(a, b);
  });

  test('degrades when one of the numbers is disconnected', async () => {
    const whatsapp = whatsappView({
      status: 'partial',
      resources: [
        { id: 'instance-1', name: 'Cliente A', type: 'WhatsApp Web', status: 'conectada' },
        { id: 'instance-2', name: 'Cliente B', type: 'WhatsApp Web', status: 'desconectada' },
      ],
    });
    const { service } = serviceWith(async () => ({ system: systemView(), whatsapp }));
    const data = await service.getStatus(true);

    assert.equal(data.state, 'degraded');
    assert.equal(componentState(data, 'whatsapp-web'), 'degraded');
    const web = data.groups.flatMap((group) => group.components).find((component) => component.id === 'whatsapp-web');
    assert.equal(web?.detail, '1 de 2 conectados');
  });

  test('opens and closes an incident and keeps the worst state in the bucket', async () => {
    let now = AT;
    let disconnected = false;
    const snapshot = async (): Promise<PublicSnapshot> => ({
      system: systemView(),
      whatsapp: whatsappView({
        status: disconnected ? 'partial' : 'ok',
        resources: [
          { id: 'instance-1', name: 'Cliente A', type: 'WhatsApp Web', status: 'conectada' },
          {
            id: 'instance-2',
            name: 'Cliente B',
            type: 'WhatsApp Web',
            status: disconnected ? 'desconectada' : 'conectada',
          },
        ],
      }),
    });
    const { service, saved } = serviceWith(snapshot, { now: () => now });

    let data = await service.getStatus(true);
    assert.equal(data.incidents.length, 0);

    now += 6 * 60_000;
    disconnected = true;
    data = await service.getStatus(true);
    assert.equal(data.state, 'degraded');
    assert.equal(data.incidents.length, 1);
    assert.equal(data.incidents[0].end, null);
    assert.equal(data.incidents[0].component, 'whatsapp-web');
    assert.equal(data.history.at(-1)?.components['whatsapp-web'], 'degraded');

    now += 6 * 60_000;
    disconnected = false;
    data = await service.getStatus(true);
    assert.equal(data.state, 'operational');
    assert.equal(data.incidents.length, 1);
    assert.notEqual(data.incidents[0].end, null);
    assert.ok(data.incidents[0].durationSeconds >= 360);
    assert.equal(data.history.at(-1)?.components['whatsapp-web'], 'degraded');
    assert.ok(saved.value);
  });

  test('falls back to a degraded page when the probe throws', async () => {
    const { service } = serviceWith(async () => {
      throw new Error('db down');
    });
    const data = await service.getStatus(true);

    assert.equal(data.state, 'degraded');
    assert.equal(componentState(data, 'api'), 'operational');
    assert.equal(componentState(data, 'database'), 'no_data');
    assert.equal(componentState(data, 'site'), 'operational');
    assert.ok(data.notes.some((note) => note.includes('Não foi possível ler todos os componentes')));
  });

  test('normalizes malformed history without throwing', () => {
    const store = normalizeStore({
      states: { api: 'operational', database: 'oops' },
      buckets: [{ t: 'bad' }, { t: AT, components: { api: 'outage' } }],
      incidents: [{ component: 'database', state: 'degraded', start: AT }],
    });
    assert.deepEqual(store.states, { api: 'operational' });
    assert.equal(store.buckets.length, 1);
    assert.equal(store.buckets[0].components.api, 'outage');
    assert.equal(store.incidents.length, 1);
    assert.equal(store.incidents[0].name, 'Banco de dados');
  });
});

import type { ProviderView } from './observability.shared';

/**
 * Public status page: a safe, aggregate view of the platform for anyone, without API key.
 *
 * It reads only the local "Sistema" and "WhatsApp" provider views (no external keys) and never returns instance
 * names, phone numbers, messages, tokens or database details. History and incidents are stored as one GlobalSetting
 * row (control database), at most once per five minutes; nothing here runs on a timer.
 */

export type PublicState = 'operational' | 'degraded' | 'outage' | 'no_data';
export type IncidentState = 'degraded' | 'outage';

export type PublicComponent = {
  id: string;
  name: string;
  description: string;
  state: PublicState;
  detail?: string;
};

export type PublicGroup = {
  id: string;
  name: string;
  components: PublicComponent[];
};

export type PublicBucket = {
  start: string;
  components: Record<string, PublicState>;
};

export type PublicIncident = {
  id: string;
  component: string;
  name: string;
  state: IncidentState;
  title: string;
  start: string;
  end: string | null;
  durationSeconds: number;
};

export type PublicStatus = {
  checkedAt: string;
  state: PublicState;
  title: string;
  summary: string;
  groups: PublicGroup[];
  history: PublicBucket[];
  incidents: PublicIncident[];
  nextCheckSeconds: number;
  historyDays: number;
  bucketHours: number;
  notes: string[];
};

export type PublicSnapshot = { system: ProviderView; whatsapp: ProviderView };

type StoredBucket = { t: number; components: Record<string, PublicState> };
type StoredIncident = {
  id: string;
  component: string;
  name: string;
  state: IncidentState;
  start: number;
  end: number | null;
};

export type PublicStatusStore = {
  states: Record<string, PublicState>;
  buckets: StoredBucket[];
  incidents: StoredIncident[];
};

export type PublicStatusServiceOptions = {
  snapshot: () => Promise<PublicSnapshot>;
  readStore: () => Promise<unknown>;
  writeStore: (value: PublicStatusStore) => Promise<void>;
  now?: () => number;
  cacheTtlMs?: number;
};

export const COMPONENT_IDS = ['whatsapp-web', 'whatsapp-cloud', 'api', 'database', 'site'] as const;
const COMPONENT_NAMES: Record<string, string> = {
  'whatsapp-web': 'WhatsApp Web',
  'whatsapp-cloud': 'API oficial da Meta',
  api: 'API WhatsAI',
  database: 'Banco de dados',
  site: 'Site e painel',
};

const BUCKET_MS = 3 * 60 * 60 * 1000;
const HISTORY_BUCKETS = 56;
const INCIDENT_WINDOW_MS = 90 * 24 * 60 * 60 * 1000;
const MAX_INCIDENTS = 50;
const DEFAULT_CACHE_TTL_MS = 5 * 60 * 1000;

const STATE_RANK: Record<PublicState, number> = { no_data: 0, operational: 1, degraded: 2, outage: 3 };

const COPY: Record<PublicState, { title: string; summary: string }> = {
  operational: {
    title: 'Todos os sistemas operacionais',
    summary: 'O atendimento no WhatsApp e a plataforma do WhatsAI estão funcionando normalmente.',
  },
  degraded: {
    title: 'Operação parcial',
    summary: 'Um ou mais componentes estão degradados. Quem já está em atendimento continua sendo atendido.',
  },
  outage: {
    title: 'Serviço indisponível',
    summary: 'Um ou mais componentes estão fora do ar. A equipe foi acionada e trabalha na recuperação.',
  },
  no_data: {
    title: 'Sem dados suficientes',
    summary: 'Ainda não foi possível verificar os componentes. Tente novamente em alguns minutos.',
  },
};

function state(value: unknown): PublicState {
  return value === 'operational' || value === 'degraded' || value === 'outage' || value === 'no_data'
    ? value
    : 'no_data';
}

function numberValue(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function iso(ms: number): string {
  return new Date(ms).toISOString();
}

export function overallState(states: PublicState[]): PublicState {
  if (states.some((item) => item === 'outage')) return 'outage';
  if (states.some((item) => item === 'degraded')) return 'degraded';
  if (states.some((item) => item === 'operational')) return 'operational';
  return 'no_data';
}

function whatsappComponent(
  view: ProviderView,
  id: string,
  name: string,
  description: string,
  types: string[],
): PublicComponent {
  const resources = view.resources.filter((resource) => types.includes(String(resource.type ?? '')));
  if (!resources.length) {
    return { id, name, description, state: 'no_data', detail: 'Nenhum número conectado por este canal' };
  }
  const connected = resources.filter((resource) => resource.status === 'conectada').length;
  const state: PublicState = connected === resources.length ? 'operational' : connected === 0 ? 'outage' : 'degraded';
  return {
    id,
    name,
    description,
    state,
    detail: `${connected} de ${resources.length} conectado${resources.length === 1 ? '' : 's'}`,
  };
}

function apiDetail(system: ProviderView): string | undefined {
  const resource = system.resources.find((item) => item.id === 'api');
  const uptime = system.metrics.find((metric) => metric.id === 'uptime');
  const minutes = numberValue(uptime?.used);
  const uptimeText =
    minutes === null
      ? null
      : minutes < 60
        ? `${Math.max(1, Math.round(minutes))} min no ar`
        : `${Math.floor(minutes / 60)} h ${Math.round(minutes % 60)} min no ar`;
  return [resource?.type, uptimeText].filter(Boolean).join(' · ') || undefined;
}

function databaseComponent(system: ProviderView): PublicComponent {
  const resource = system.resources.find((item) => item.id === 'database');
  const size = system.metrics.find((metric) => metric.id === 'database_size');
  let state: PublicState = 'no_data';
  let detail: string | undefined;

  if (resource) {
    detail = resource.detail ?? resource.status;
    if (resource.status === 'conectado') state = 'operational';
    else if (resource.status === 'sem resposta') state = 'outage';
    if (state === 'operational' && size?.status === 'warning') state = 'degraded';
    if (state === 'operational' && size?.status === 'critical') state = 'outage';
  } else if (system.status === 'error') {
    state = 'outage';
    detail = 'Sem resposta do banco';
  }

  return {
    id: 'database',
    name: COMPONENT_NAMES.database,
    description: 'Conversas, leads, agenda e configurações',
    state,
    detail,
  };
}

export function buildGroups(snapshot: PublicSnapshot): PublicGroup[] {
  const system = snapshot.system;
  const whatsapp = snapshot.whatsapp;

  const api: PublicComponent = {
    id: 'api',
    name: COMPONENT_NAMES.api,
    description: 'Recepção, envio e automações',
    state: 'operational',
    detail: apiDetail(system),
  };
  const site: PublicComponent = {
    id: 'site',
    name: COMPONENT_NAMES.site,
    description: 'Landing, documentação e painel na Vercel',
    state: 'operational',
    detail: 'Servido pela Vercel',
  };

  return [
    {
      id: 'atendimento',
      name: 'Atendimento',
      components: [
        whatsappComponent(
          whatsapp,
          'whatsapp-web',
          COMPONENT_NAMES['whatsapp-web'],
          'Conexão por QR code (Baileys e Evolution)',
          ['WhatsApp Web', 'Evolution'],
        ),
        whatsappComponent(
          whatsapp,
          'whatsapp-cloud',
          COMPONENT_NAMES['whatsapp-cloud'],
          'Cloud API para números oficiais',
          ['Cloud API (Meta)'],
        ),
      ],
    },
    {
      id: 'plataforma',
      name: 'Plataforma',
      components: [api, databaseComponent(system), site],
    },
  ];
}

export function fallbackGroups(): PublicGroup[] {
  return [
    {
      id: 'atendimento',
      name: 'Atendimento',
      components: [
        {
          id: 'whatsapp-web',
          name: COMPONENT_NAMES['whatsapp-web'],
          description: 'Conexão por QR code (Baileys e Evolution)',
          state: 'no_data',
          detail: 'Sem leitura das instâncias',
        },
        {
          id: 'whatsapp-cloud',
          name: COMPONENT_NAMES['whatsapp-cloud'],
          description: 'Cloud API para números oficiais',
          state: 'no_data',
          detail: 'Sem leitura das instâncias',
        },
      ],
    },
    {
      id: 'plataforma',
      name: 'Plataforma',
      components: [
        {
          id: 'api',
          name: COMPONENT_NAMES.api,
          description: 'Recepção, envio e automações',
          state: 'operational',
          detail: 'Endpoint público respondendo',
        },
        {
          id: 'database',
          name: COMPONENT_NAMES.database,
          description: 'Conversas, leads, agenda e configurações',
          state: 'no_data',
          detail: 'Sem leitura do banco',
        },
        {
          id: 'site',
          name: COMPONENT_NAMES.site,
          description: 'Landing, documentação e painel na Vercel',
          state: 'operational',
          detail: 'Servido pela Vercel',
        },
      ],
    },
  ];
}

export function componentStates(groups: PublicGroup[]): Record<string, PublicState> {
  const states: Record<string, PublicState> = {};
  for (const group of groups) for (const component of group.components) states[component.id] = component.state;
  return states;
}

export function groupState(group: PublicGroup, states: Record<string, PublicState>): PublicState {
  return overallState(group.components.map((component) => states[component.id] ?? component.state));
}

function emptyStore(): PublicStatusStore {
  return { states: {}, buckets: [], incidents: [] };
}

export function normalizeStore(value: unknown): PublicStatusStore {
  const store = emptyStore();
  if (!value || typeof value !== 'object') return store;
  const raw = value as Record<string, unknown>;

  if (raw.states && typeof raw.states === 'object') {
    for (const id of COMPONENT_IDS) {
      const item = (raw.states as Record<string, unknown>)[id];
      if (item && state(item) !== 'no_data') store.states[id] = state(item);
    }
  }

  if (Array.isArray(raw.buckets)) {
    for (const item of raw.buckets) {
      if (!item || typeof item !== 'object') continue;
      const bucket = item as Record<string, unknown>;
      const t = numberValue(bucket.t);
      if (t === null) continue;
      const components: Record<string, PublicState> = {};
      if (bucket.components && typeof bucket.components === 'object') {
        for (const id of COMPONENT_IDS) {
          const value = (bucket.components as Record<string, unknown>)[id];
          if (value && state(value) !== 'no_data') components[id] = state(value);
        }
      }
      store.buckets.push({ t, components });
    }
  }

  if (Array.isArray(raw.incidents)) {
    for (const item of raw.incidents) {
      if (!item || typeof item !== 'object') continue;
      const incident = item as Record<string, unknown>;
      const start = numberValue(incident.start);
      const incidentState = incident.state;
      if (start === null || (incidentState !== 'degraded' && incidentState !== 'outage')) continue;
      const end = numberValue(incident.end);
      const component = String(incident.component ?? '');
      if (!component) continue;
      store.incidents.push({
        id: String(incident.id ?? `${component}-${start}`),
        component,
        name: String(incident.name ?? COMPONENT_NAMES[component] ?? component),
        state: incidentState,
        start,
        end,
      });
    }
  }

  return store;
}

function mergeBucket(store: PublicStatusStore, now: number, states: Record<string, PublicState>): boolean {
  const start = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  let bucket = store.buckets.find((item) => item.t === start);
  let changed = false;
  if (!bucket) {
    bucket = { t: start, components: {} };
    store.buckets.push(bucket);
    changed = true;
  }
  for (const [id, current] of Object.entries(states)) {
    if (current === 'no_data') continue;
    const previous = bucket.components[id];
    if (!previous || STATE_RANK[current] > STATE_RANK[previous]) {
      bucket.components[id] = current;
      changed = true;
    }
  }
  const oldest = now - HISTORY_BUCKETS * BUCKET_MS;
  const before = store.buckets.length;
  store.buckets = store.buckets.filter((item) => item.t >= oldest).sort((a, b) => a.t - b.t);
  if (store.buckets.length !== before) changed = true;
  return changed;
}

function updateIncidents(
  store: PublicStatusStore,
  states: Record<string, PublicState>,
  groups: PublicGroup[],
  now: number,
): boolean {
  const names = new Map<string, string>();
  for (const group of groups) for (const component of group.components) names.set(component.id, component.name);
  let changed = false;

  for (const [id, current] of Object.entries(states)) {
    const previous = store.states[id] ?? 'no_data';
    if (current === previous) continue;
    store.states[id] = current;
    changed = true;
    if (current === 'no_data') continue;

    const open = store.incidents.find((item) => item.component === id && item.end === null);
    if (current === 'degraded' || current === 'outage') {
      if (open) {
        if (open.state === current) continue;
        open.end = now;
      }
      store.incidents.push({
        id: `${id}-${now}`,
        component: id,
        name: names.get(id) ?? COMPONENT_NAMES[id] ?? id,
        state: current,
        start: now,
        end: null,
      });
      changed = true;
      continue;
    }

    if (open) {
      open.end = now;
      changed = true;
    }
  }

  const before = store.incidents.length;
  store.incidents = store.incidents
    .filter((item) => item.start >= now - INCIDENT_WINDOW_MS)
    .sort((a, b) => b.start - a.start)
    .slice(0, MAX_INCIDENTS);
  if (store.incidents.length !== before) changed = true;
  return changed;
}

function publicHistory(store: PublicStatusStore, now: number): PublicBucket[] {
  const currentStart = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const byStart = new Map(store.buckets.map((item) => [item.t, item]));
  const result: PublicBucket[] = [];
  for (let i = HISTORY_BUCKETS - 1; i >= 0; i--) {
    const start = currentStart - i * BUCKET_MS;
    const stored = byStart.get(start);
    const components: Record<string, PublicState> = {};
    for (const id of COMPONENT_IDS) components[id] = stored?.components[id] ?? 'no_data';
    result.push({ start: iso(start), components });
  }
  return result;
}

function publicIncidents(store: PublicStatusStore, now: number): PublicIncident[] {
  return store.incidents.slice(0, 20).map((item) => ({
    id: item.id,
    component: item.component,
    name: item.name,
    state: item.state,
    title: item.state === 'outage' ? `Indisponibilidade em ${item.name}` : `Instabilidade em ${item.name}`,
    start: iso(item.start),
    end: item.end === null ? null : iso(item.end),
    durationSeconds: Math.max(0, Math.round(((item.end ?? now) - item.start) / 1000)),
  }));
}

function notes(): string[] {
  return [
    'Verificação a cada 5 minutos. O intervalo protege o banco gratuito de consultas em segundo plano.',
    'O histórico é gravado quando há mudança de estado ou o início de uma faixa de 3 horas; lacunas aparecem como “Sem dados”.',
    'Nenhum nome de cliente, número, mensagem ou chave é publicado nesta página.',
    'Horários em UTC; a página mostra o horário local do navegador.',
  ];
}

export class PublicStatusService {
  private cache: { at: number; data: PublicStatus } | null = null;
  private inFlight: Promise<PublicStatus> | null = null;
  private store: PublicStatusStore = emptyStore();
  private storeLoaded = false;
  private storeWritable = true;

  constructor(private readonly options: PublicStatusServiceOptions) {}

  public async getStatus(force = false): Promise<PublicStatus> {
    const now = (this.options.now ?? Date.now)();
    const ttl = this.options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
    if (!force && this.cache && now - this.cache.at < ttl) return this.cache.data;

    // One probe at a time: concurrent public requests must not multiply the database reads.
    if (this.inFlight) return this.inFlight;
    this.inFlight = this.buildStatus(now).finally(() => {
      this.inFlight = null;
    });
    return this.inFlight;
  }

  private async buildStatus(now: number): Promise<PublicStatus> {
    // A new check may retry the store after a transient database error.
    this.storeWritable = true;
    let groups: PublicGroup[];
    let snapshotFailed = false;
    try {
      groups = buildGroups(await this.options.snapshot());
    } catch {
      groups = fallbackGroups();
      snapshotFailed = true;
    }

    const states = componentStates(groups);
    if (!snapshotFailed) {
      await this.loadStore();
      let changed = mergeBucket(this.store, now, states);
      if (updateIncidents(this.store, states, groups, now)) changed = true;
      if (changed) await this.saveStore();
    }

    const allStates = groups.flatMap((group) => group.components.map((component) => component.state));
    const overall = snapshotFailed ? overallState(['degraded', ...allStates]) : overallState(allStates);
    const copy = COPY[overall];
    const data: PublicStatus = {
      checkedAt: iso(now),
      state: overall,
      title: copy.title,
      summary: copy.summary,
      groups,
      history: publicHistory(this.store, now),
      incidents: publicIncidents(this.store, now),
      nextCheckSeconds: 300,
      historyDays: 7,
      bucketHours: 3,
      notes: [...notes(), ...(snapshotFailed ? ['Não foi possível ler todos os componentes agora.'] : [])],
    };
    this.cache = { at: now, data };
    return data;
  }

  private async loadStore(): Promise<void> {
    if (this.storeLoaded) return;
    try {
      this.store = normalizeStore(await this.options.readStore());
      this.storeWritable = true;
      this.storeLoaded = true;
    } catch {
      this.store = emptyStore();
      this.storeWritable = false;
      this.storeLoaded = false;
    }
  }

  private async saveStore(): Promise<void> {
    if (!this.storeWritable) return;
    try {
      await this.options.writeStore(this.store);
    } catch {
      this.storeWritable = false;
    }
  }
}

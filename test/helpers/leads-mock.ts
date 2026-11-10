/**
 * In-memory stand-in for the tables the LeadsService touches (Lead, LeadSettings, Message, IntegrationSession,
 * OpenAI bot/creds/settings, Instance) with the subset of Prisma it uses: equality, OR/AND, in/not/lt/lte/gt/gte,
 * contains (mode insensitive), JSON key path filters of Message.key, orderBy with nulls, groupBy/count, and the
 * unique violation (P2002) of create.
 */
const toTime = (value: any) => (value instanceof Date ? value.getTime() : value);

function matchValue(value: any, cond: any): boolean {
  if (cond === undefined) return true;
  if (cond === null) return value === null || value === undefined;
  if (cond instanceof Date) return toTime(value) === cond.getTime();
  if (cond && typeof cond === 'object' && !Array.isArray(cond)) {
    if ('path' in cond) {
      const path = Array.isArray(cond.path) ? cond.path : String(cond.path).replace(/^\$\./, '').split('.');
      const inner = path.reduce((node: any, key: string) => (node == null ? undefined : node[key]), value);
      return inner === cond.equals;
    }
    const v = toTime(value);
    if ('in' in cond && !cond.in.includes(value)) return false;
    if ('not' in cond) {
      if (cond.not === null ? value === null || value === undefined : value === cond.not) return false;
    }
    if ('lt' in cond && !(v < toTime(cond.lt))) return false;
    if ('lte' in cond && !(v <= toTime(cond.lte))) return false;
    if ('gt' in cond && !(v > toTime(cond.gt))) return false;
    if ('gte' in cond && !(v >= toTime(cond.gte))) return false;
    if ('contains' in cond) {
      if (typeof value !== 'string') return false;
      const insensitive = cond.mode === 'insensitive';
      if (!(insensitive ? value.toLowerCase().includes(cond.contains.toLowerCase()) : value.includes(cond.contains))) {
        return false;
      }
    }
    if ('equals' in cond && value !== cond.equals) return false;
    return true;
  }
  return value === cond;
}

export const matchRow = (row: any, where: any = {}): boolean =>
  Object.entries(where ?? {}).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((part) => matchRow(row, part));
    if (key === 'AND') return (cond as any[]).every((part) => matchRow(row, part));
    return matchValue(row[key], cond);
  });

function sortRows(rows: any[], orderBy: any): any[] {
  const specs: any[] = Array.isArray(orderBy) ? orderBy : orderBy ? [orderBy] : [];
  return [...rows].sort((a, b) => {
    for (const spec of specs) {
      const [field, raw] = Object.entries(spec)[0] as [string, any];
      const dir = typeof raw === 'string' ? raw : raw.sort;
      const nulls = typeof raw === 'object' ? raw.nulls : undefined;
      const va = toTime(a[field]);
      const vb = toTime(b[field]);
      const na = va === null || va === undefined;
      const nb = vb === null || vb === undefined;
      if (na || nb) {
        if (na && nb) continue;
        const last = nulls ? nulls === 'last' : dir === 'asc' ? false : true;
        return na === last ? 1 : -1;
      }
      if (va === vb) continue;
      const cmp = va < vb ? -1 : 1;
      return dir === 'desc' ? -cmp : cmp;
    }
    return 0;
  });
}

const copy = (value: any) => (value == null ? null : structuredClone(value));
const LEAD_DEFAULTS = {
  pushName: null,
  name: null,
  area: null,
  city: null,
  summary: null,
  status: 'novo',
  statusSource: 'ai',
  manualFields: null,
  priority: 'normal',
  priorityRank: 1,
  priorityReason: null,
  missingInfo: null,
  nextStep: null,
  opposingParty: null,
  hasLawyer: null,
  documentsMentioned: null,
  mediaCount: 0,
  source: null,
  firstMessageAt: null,
  lastMessageAt: null,
  lastClientMessageAt: null,
  lastHumanReplyAt: null,
  awaitingHumanSince: null,
  lastExtractedAt: null,
  extractedFromCount: 0,
  notifiedAt: null,
};

export function createLeadsTables(options: { instances?: { id: string; name: string }[] } = {}) {
  const leads: any[] = [];
  const settings = new Map<string, any>();
  const messages: any[] = [];
  const sessions: any[] = [];
  const bots: any[] = [];
  const creds: any[] = [];
  const instances = options.instances ?? [{ id: 'inst-1', name: 'escritorio' }];
  let nextId = 1;

  const applyData = (row: any, data: any) => {
    for (const [key, value] of Object.entries(data)) {
      if (value === undefined) continue;
      row[key] =
        value && typeof value === 'object' && !(value instanceof Date) && 'increment' in (value as any)
          ? (row[key] ?? 0) + (value as any).increment
          : value instanceof Date
            ? new Date(value)
            : structuredClone(value);
    }
    row.updatedAt = new Date();
  };

  const lead = {
    findMany: async ({ where, orderBy, skip = 0, take, select }: any = {}) => {
      const rows = sortRows(
        leads.filter((row) => matchRow(row, where)),
        orderBy,
      ).slice(skip, take ? skip + take : undefined);
      return rows.map((row) =>
        select ? Object.fromEntries(Object.keys(select).map((key) => [key, copy(row[key])])) : copy(row),
      );
    },
    findFirst: async ({ where }: any = {}) => copy(leads.find((row) => matchRow(row, where))),
    delete: async ({ where }: any) => {
      const index = leads.findIndex((row) => row.id === where.id);
      if (index < 0) throw Object.assign(new Error('not found'), { code: 'P2025' });
      return copy(leads.splice(index, 1)[0]);
    },
    findUnique: async ({ where }: any) =>
      copy(
        leads.find((row) =>
          where.id
            ? row.id === where.id
            : row.instanceId === where.instanceId_remoteJid.instanceId &&
              row.remoteJid === where.instanceId_remoteJid.remoteJid,
        ),
      ),
    create: async ({ data }: any) => {
      if (leads.some((row) => row.instanceId === data.instanceId && row.remoteJid === data.remoteJid)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      const row: any = { id: `lead-${nextId++}`, ...LEAD_DEFAULTS, createdAt: new Date(), updatedAt: new Date() };
      applyData(row, data);
      leads.push(row);
      return copy(row);
    },
    update: async ({ where, data }: any) => {
      const row = leads.find((item) =>
        where.id
          ? item.id === where.id
          : item.instanceId === where.instanceId_remoteJid.instanceId &&
            item.remoteJid === where.instanceId_remoteJid.remoteJid,
      );
      if (!row) throw Object.assign(new Error('Record not found'), { code: 'P2025' });
      if (
        data.remoteJid &&
        leads.some((item) => item !== row && item.instanceId === row.instanceId && item.remoteJid === data.remoteJid)
      ) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      applyData(row, data);
      return copy(row);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of leads) {
        if (matchRow(row, where)) {
          applyData(row, data);
          count++;
        }
      }
      return { count };
    },
    count: async ({ where }: any = {}) => leads.filter((row) => matchRow(row, where)).length,
    groupBy: async ({ by, where }: any) => {
      const groups = new Map<string, any>();
      for (const row of leads.filter((item) => matchRow(item, where))) {
        const key = by.map((field: string) => row[field]).join('|');
        const group = groups.get(key) ?? {
          ...Object.fromEntries(by.map((field: string) => [field, row[field]])),
          _count: { _all: 0 },
        };
        group._count._all++;
        groups.set(key, group);
      }
      return [...groups.values()];
    },
  };

  const leadSettings = {
    findUnique: async ({ where }: any) => copy(settings.get(where.instanceId)),
    upsert: async ({ where, create, update }: any) => {
      const current = settings.get(where.instanceId);
      const row = current
        ? { ...current, ...update, updatedAt: new Date() }
        : { id: `ls-${nextId++}`, ...create, updatedAt: new Date() };
      settings.set(where.instanceId, row);
      return copy(row);
    },
  };

  const message = {
    findMany: async ({ where, orderBy, take }: any = {}) =>
      sortRows(
        messages.filter((row) => matchRow(row, where)),
        orderBy,
      )
        .slice(0, take)
        .map(copy),
    findFirst: async ({ where, orderBy }: any = {}) =>
      copy(
        sortRows(
          messages.filter((row) => matchRow(row, where)),
          orderBy,
        )[0],
      ),
    count: async ({ where }: any = {}) => messages.filter((row) => matchRow(row, where)).length,
  };

  const integrationSession = {
    findFirst: async ({ where, orderBy }: any = {}) =>
      copy(
        sortRows(
          sessions.filter((row) => matchRow(row, where)),
          orderBy,
        )[0],
      ),
  };

  const prisma: any = {
    lead,
    leadSettings,
    message,
    integrationSession,
    openaiBot: { findFirst: async ({ where }: any = {}) => copy(bots.find((row) => matchRow(row, where))) },
    openaiSetting: { findFirst: async () => null },
    openaiCreds: { findUnique: async ({ where }: any) => copy(creds.find((row) => row.id === where.id)) },
    instance: {
      findUnique: async ({ where }: any) => copy(instances.find((row) => row.name === where.name)),
      findMany: async ({ where }: any = {}) => instances.filter((row) => matchRow(row, where)).map(copy),
    },
    /** Backfill candidates: the same GROUP BY as the SQL, over the in-memory messages. */
    $queryRawUnsafe: async (_sql: string, instanceId: string, since: number) => {
      const groups = new Map<string, { jid: string; n: number; last: number }>();
      for (const row of messages) {
        if (row.instanceId !== instanceId || row.messageTimestamp < since || row.key.fromMe) continue;
        const group = groups.get(row.key.remoteJid) ?? { jid: row.key.remoteJid, n: 0, last: 0 };
        group.n++;
        group.last = Math.max(group.last, row.messageTimestamp);
        groups.set(row.key.remoteJid, group);
      }
      return [...groups.values()].sort((a, b) => b.last - a.last);
    },
  };

  let ts = 0;
  /** Stores a message; `at` in unix seconds (default: a minute after the previous one, never before now). */
  const addMessage = (instanceId: string, remoteJid: string, text: string | null, fromMe = false, extra: any = {}) => {
    ts = extra.at ?? Math.max(ts + 60, Math.floor(Date.now() / 1000));
    const row = {
      id: `msg-${nextId++}`,
      instanceId,
      key: { id: `K${nextId}`, remoteJid, fromMe },
      pushName: fromMe ? 'Escritório' : (extra.pushName ?? 'Contato'),
      messageType: extra.messageType ?? 'conversation',
      message: extra.message ?? { conversation: text },
      messageTimestamp: ts,
    };
    messages.push(row);
    return row;
  };

  /** Unix seconds of the newest message stored so far (a clock for the service under test). */
  const lastTs = () => ts;

  return { prisma, leads, settings, messages, sessions, bots, creds, addMessage, lastTs };
}

/** Fake OpenAI client: records each request and answers with the queued JSON objects (or errors). */
export function createFakeExtractor(answers: any[] = []) {
  const requests: any[] = [];
  const queue = [...answers];
  const client = {
    chat: {
      completions: {
        create: async (body: any) => {
          requests.push(structuredClone(body));
          const next = queue.length > 1 ? queue.shift() : queue[0];
          if (next instanceof Error) throw next;
          return {
            choices: [{ message: { content: typeof next === 'string' ? next : JSON.stringify(next) } }],
            usage: { prompt_tokens: 1800, completion_tokens: 180 },
          };
        },
      },
    },
  };
  return { client: client as any, requests, push: (answer: any) => queue.push(answer) };
}

/** A complete extraction answer with every field (override what the test needs). */
export const extraction = (overrides: Record<string, any> = {}) => ({
  name: null,
  area: null,
  city: null,
  summary: null,
  urgentType: null,
  urgentFact: null,
  noLegalNeed: false,
  clearNeed: false,
  missingInfo: [],
  nextStep: null,
  opposingParty: null,
  hasLawyer: null,
  documentsMentioned: [],
  ...overrides,
});

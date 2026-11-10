/**
 * In-memory stand-in for the "Agenda" tables (AgendaSettings, Appointment) with the Prisma operators the agenda
 * service uses. $transaction runs one callback at a time (like the settings row lock does in the database).
 */
const copy = (value: any) => (value ? structuredClone(value) : null);

const cmp = (a: any, b: any) => {
  const x = a instanceof Date ? a.getTime() : a;
  const y = b instanceof Date ? b.getTime() : b;
  return x < y ? -1 : x > y ? 1 : 0;
};

function matchValue(actual: any, condition: any): boolean {
  if (condition === undefined) return true;
  if (condition instanceof Date) return actual != null && cmp(actual, condition) === 0;
  if (condition && typeof condition === 'object' && !Array.isArray(condition)) {
    if ('in' in condition && !condition.in.includes(actual)) return false;
    if (
      'not' in condition &&
      (condition.not instanceof Date ? cmp(actual, condition.not) === 0 : actual === condition.not)
    )
      return false;
    if ('gt' in condition && !(actual != null && cmp(actual, condition.gt) > 0)) return false;
    if ('gte' in condition && !(actual != null && cmp(actual, condition.gte) >= 0)) return false;
    if ('lt' in condition && !(actual != null && cmp(actual, condition.lt) < 0)) return false;
    if ('lte' in condition && !(actual != null && cmp(actual, condition.lte) <= 0)) return false;
    return true;
  }
  return actual === condition;
}

export const matchesWhere = (row: any, where: any = {}) =>
  Object.entries(where).every(([key, value]) => matchValue(row[key], value));

export function createAgendaTables(instances: { id: string; name: string }[] = [{ id: 'inst-a', name: 'escritorio' }]) {
  const settings = new Map<string, any>();
  const appointments = new Map<string, any>();
  let seq = 0;
  let queue: Promise<any> = Promise.resolve();

  const sortRows = (rows: any[], orderBy: any) => {
    if (!orderBy) return rows;
    const [[key, dir]] = Object.entries(orderBy) as [string, string][];
    return rows.sort((a, b) => cmp(a[key], b[key]) * (dir === 'desc' ? -1 : 1));
  };

  const agendaSettings = {
    findUnique: async ({ where }: any) =>
      copy(
        where.instanceId
          ? settings.get(where.instanceId)
          : [...settings.values()].find((row) => where.icsToken && row.icsToken === where.icsToken),
      ),
    findMany: async ({ where }: any = {}) => [...settings.values()].filter((row) => matchesWhere(row, where)).map(copy),
    upsert: async ({ where, create, update }: any) => {
      const current = settings.get(where.instanceId);
      const row = current
        ? Object.assign(current, update, { updatedAt: new Date() })
        : { id: `as${++seq}`, bookingSeq: 0, createdAt: new Date(), updatedAt: new Date(), ...create };
      settings.set(where.instanceId, row);
      return copy(row);
    },
    update: async ({ where, data }: any) => {
      const row = settings.get(where.instanceId);
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      for (const [key, value] of Object.entries(data)) {
        row[key] =
          value && typeof value === 'object' && 'increment' in (value as any)
            ? row[key] + (value as any).increment
            : value;
      }
      row.updatedAt = new Date();
      return copy(row);
    },
  };

  const appointment = {
    rows: appointments,
    findFirst: async ({ where, orderBy }: any) =>
      copy(
        sortRows(
          [...appointments.values()].filter((row) => matchesWhere(row, where)),
          orderBy,
        )[0],
      ),
    findMany: async ({ where, orderBy, take }: any = {}) =>
      sortRows(
        [...appointments.values()].filter((row) => matchesWhere(row, where)),
        orderBy,
      )
        .slice(0, take ?? 10_000)
        .map(copy),
    count: async ({ where }: any) => [...appointments.values()].filter((row) => matchesWhere(row, where)).length,
    create: async ({ data }: any) => {
      const now = new Date();
      const row = {
        id: `ap${++seq}`,
        status: 'agendado',
        remindersSent: {},
        awaitingReplyAt: null,
        confirmedAt: null,
        cancelledAt: null,
        notes: null,
        createdAt: now,
        updatedAt: now,
        ...structuredClone(data),
      };
      appointments.set(row.id, row);
      return copy(row);
    },
    update: async ({ where, data }: any) => {
      const row = appointments.get(where.id);
      if (!row) throw Object.assign(new Error('not found'), { code: 'P2025' });
      Object.assign(row, structuredClone(data), { updatedAt: new Date(row.updatedAt.getTime() + 1) });
      return copy(row);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of appointments.values()) {
        if (matchesWhere(row, where)) {
          Object.assign(row, structuredClone(data), { updatedAt: new Date(row.updatedAt.getTime() + 1) });
          count++;
        }
      }
      return { count };
    },
  };

  const instance = {
    findUnique: async ({ where }: any) =>
      copy(instances.find((row) => (where.id ? row.id === where.id : row.name === where.name)) ?? null),
    findMany: async ({ where }: any = {}) => instances.filter((row) => matchesWhere(row, where)).map(copy),
  };

  const prisma: any = {
    agendaSettings,
    appointment,
    instance,
    $transaction: (fn: (tx: any) => Promise<any>) => {
      const run = queue.then(() => fn(prisma));
      queue = run.catch(() => undefined);
      return run;
    },
  };
  return prisma;
}

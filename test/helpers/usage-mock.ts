/**
 * In-memory stand-in for the "Plano e limites" tables (InstanceLimits, UsageCounter) with the subset of Prisma
 * the UsageService uses: equality, OR, lt/lte/gt/gte/in filters, compound primary key, upsert with increment,
 * and the unique violation (P2002) of create.
 */
const matchValue = (value: any, cond: any): boolean => {
  if (cond === undefined) return true;
  if (cond && typeof cond === 'object' && !(cond instanceof Date)) {
    if ('in' in cond && !cond.in.includes(value)) return false;
    if ('lt' in cond && !(value < cond.lt)) return false;
    if ('lte' in cond && !(value <= cond.lte)) return false;
    if ('gt' in cond && !(value > cond.gt)) return false;
    if ('gte' in cond && !(value >= cond.gte)) return false;
    return true;
  }
  return value === cond;
};

export const matchWhere = (row: any, where: any = {}): boolean =>
  Object.entries(where).every(([key, cond]) => {
    if (key === 'OR') return (cond as any[]).some((part) => matchWhere(row, part));
    if (key === 'AND') return (cond as any[]).every((part) => matchWhere(row, part));
    return matchValue(row[key], cond);
  });

const counterKey = (row: any) => [row.instanceId, row.type, row.period, row.remoteJid ?? ''].join('|');

export function createUsageTables(instances: { id: string; name: string }[] = []) {
  const limits = new Map<string, any>();
  const counters = new Map<string, any>();
  const calls: { op: string; args: any }[] = [];
  const copy = (value: any) => (value ? structuredClone(value) : null);

  const instanceLimits = {
    findUnique: async ({ where }: any) => {
      calls.push({ op: 'instanceLimits.findUnique', args: where });
      return copy(limits.get(where.instanceId));
    },
    findMany: async ({ take }: any = {}) => [...limits.values()].slice(0, take ?? 1000).map(copy),
    upsert: async ({ where, create, update }: any) => {
      calls.push({ op: 'instanceLimits.upsert', args: { where, create, update } });
      const current = limits.get(where.instanceId);
      const row = current
        ? { ...current, ...update, updatedAt: new Date() }
        : { id: `lim-${limits.size + 1}`, createdAt: new Date(), ...create, updatedAt: new Date() };
      limits.set(where.instanceId, row);
      return copy(row);
    },
  };

  const usageCounter = {
    findUnique: async ({ where }: any) => copy(counters.get(counterKey(where.instanceId_type_period_remoteJid))),
    findMany: async ({ where, orderBy, take }: any = {}) => {
      calls.push({ op: 'usageCounter.findMany', args: where });
      let rows = [...counters.values()].filter((row) => matchWhere(row, where));
      if (orderBy?.responses === 'desc') rows = rows.sort((a, b) => b.responses - a.responses);
      return rows.slice(0, take ?? 1000).map(copy);
    },
    upsert: async ({ where, create, update }: any) => {
      calls.push({ op: 'usageCounter.upsert', args: { where, create, update } });
      const key = counterKey(where.instanceId_type_period_remoteJid);
      const current = counters.get(key);
      if (current) {
        current.responses += update?.responses?.increment ?? 0;
        current.updatedAt = new Date();
        return copy(current);
      }
      const row = { remoteJid: '', limitNotice: false, hoursNotice: false, ...create, updatedAt: new Date() };
      counters.set(key, row);
      return copy(row);
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of counters.values()) {
        if (matchWhere(row, where)) {
          Object.assign(row, data, { updatedAt: new Date() });
          count++;
        }
      }
      return { count };
    },
    create: async ({ data }: any) => {
      const row = {
        remoteJid: '',
        responses: 0,
        limitNotice: false,
        hoursNotice: false,
        ...data,
        updatedAt: new Date(),
      };
      const key = counterKey(row);
      if (counters.has(key)) throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      counters.set(key, row);
      return copy(row);
    },
    deleteMany: async ({ where }: any) => {
      calls.push({ op: 'usageCounter.deleteMany', args: where });
      let count = 0;
      for (const [key, row] of counters) {
        if (matchWhere(row, where)) {
          counters.delete(key);
          count++;
        }
      }
      return { count };
    },
  };

  const instance = {
    findUnique: async ({ where }: any) => copy(instances.find((row) => row.name === where.name)),
    findMany: async ({ where }: any = {}) => instances.filter((row) => matchWhere(row, where)).map(copy),
  };

  /** Responses stored for a counter row (0 when it does not exist). */
  const count = (instanceId: string, type: string, period: string, remoteJid = '') =>
    counters.get(counterKey({ instanceId, type, period, remoteJid }))?.responses ?? 0;

  return { instanceLimits, usageCounter, instance, limits, counters, calls, count };
}

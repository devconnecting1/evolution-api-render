/**
 * In-memory stand-in for the Prisma models the OpenAI chatbot path touches (controller, service, usage limits),
 * with the filters those queries use: equality, in, not, lt/lte/gt/gte, OR/AND, orderBy createdAt. Ids and
 * timestamps are deterministic (counter + the virtual clock), so a run is reproducible.
 */
import { createUsageTables, matchWhere } from '../helpers/usage-mock';

const copy = <T>(value: T): T => (value == null ? (null as T) : structuredClone(value));

function matches(row: any, where: any = {}): boolean {
  return Object.entries(where).every(([key, cond]) => {
    if (cond === undefined) return true;
    if (key === 'OR') return (cond as any[]).some((part) => matches(row, part));
    if (key === 'AND') return (cond as any[]).every((part) => matches(row, part));
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'not' in (cond as any)) {
      const not = (cond as any).not;
      if (not === null) return row[key] !== null && row[key] !== undefined;
      if (not && typeof not === 'object') return !matches({ [key]: row[key] }, { [key]: not });
      return row[key] !== not;
    }
    if (cond && typeof cond === 'object' && !(cond instanceof Date) && 'endsWith' in (cond as any)) {
      return typeof row[key] === 'string' && row[key].endsWith((cond as any).endsWith);
    }
    return matchWhere({ [key]: row[key] }, { [key]: cond });
  });
}

class Table {
  readonly rows = new Map<string, any>();
  private counter = 0;
  constructor(private readonly prefix: string) {}

  private sorted(orderBy?: any): any[] {
    const rows = [...this.rows.values()];
    if (orderBy?.createdAt) {
      const dir = orderBy.createdAt === 'desc' ? -1 : 1;
      rows.sort((a, b) => dir * (a.createdAt - b.createdAt || a.__seq - b.__seq));
    }
    return rows;
  }

  private out(row: any) {
    if (!row) return null;
    const out = copy(row);
    delete out.__seq;
    return out;
  }

  findUnique = async ({ where }: any) => this.out([...this.rows.values()].find((row) => matches(row, where)));
  findFirst = async ({ where, orderBy }: any = {}) => this.out(this.sorted(orderBy).find((row) => matches(row, where)));
  findMany = async ({ where, orderBy, take }: any = {}) =>
    this.sorted(orderBy)
      .filter((row) => matches(row, where))
      .slice(0, take ?? Infinity)
      .map((row) => this.out(row));
  create = async ({ data }: any) => {
    const seq = ++this.counter;
    const row = {
      id: data.id ?? `${this.prefix}${seq}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ...data,
      __seq: seq,
    };
    this.rows.set(row.id, row);
    return this.out(row);
  };
  update = async ({ where, data }: any) => {
    const row = [...this.rows.values()].find((item) => matches(item, where));
    if (!row) throw Object.assign(new Error('Record to update not found.'), { code: 'P2025' });
    Object.assign(row, data, { updatedAt: new Date() });
    return this.out(row);
  };
  updateMany = async ({ where, data }: any) => {
    let count = 0;
    for (const row of this.rows.values()) {
      if (matches(row, where)) {
        Object.assign(row, data, { updatedAt: new Date() });
        count++;
      }
    }
    return { count };
  };
  delete = async ({ where }: any) => {
    const row = [...this.rows.values()].find((item) => matches(item, where));
    if (row) this.rows.delete(row.id);
    return this.out(row);
  };
  deleteMany = async ({ where }: any = {}) => {
    let count = 0;
    for (const row of [...this.rows.values()]) {
      if (matches(row, where)) {
        this.rows.delete(row.id);
        count++;
      }
    }
    return { count };
  };
}

export function createSimPrisma(apiKey: string) {
  const usage = createUsageTables();
  return {
    openaiBot: new Table('bot'),
    openaiSetting: new Table('set'),
    integrationSession: new Table('ses'),
    openaiCreds: { findUnique: async ({ where }: any) => ({ id: where.id, apiKey }) },
    instanceLimits: usage.instanceLimits,
    usageCounter: usage.usageCounter,
    instance: { findFirst: async () => null },
  };
}

export type SimPrisma = ReturnType<typeof createSimPrisma>;

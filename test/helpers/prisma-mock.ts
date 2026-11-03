import { createUsageTables } from './usage-mock';

/**
 * Small in-memory stand-in for the Prisma models the OpenAI service touches, for unit tests that do not need a
 * database. Records every write so tests can assert that nothing was written.
 */
export function createPrismaMock(initialSessions: any[] = []) {
  const sessions = new Map<string, any>(initialSessions.map((session) => [session.id, { ...session }]));
  const writes: { op: string; args: any }[] = [];
  const copy = (value: any) => (value ? structuredClone(value) : null);

  const matches = (session: any, where: any = {}) =>
    Object.entries(where).every(([key, value]) => value === undefined || session[key] === value);

  const usage = createUsageTables();

  const prisma: any = {
    sessions,
    writes,
    /** "Plano e limites" tables (see usage-mock.ts). */
    usage,
    instanceLimits: usage.instanceLimits,
    usageCounter: usage.usageCounter,
    openaiCreds: {
      findUnique: async ({ where }: any) => ({ id: where.id, apiKey: 'sk-test-not-real' }),
    },
    openaiSetting: {
      findFirst: async () => prisma.settingsRow ?? null,
    },
    settingsRow: null as any,
    integrationSession: {
      findUnique: async ({ where }: any) => copy(sessions.get(where.id)),
      findFirst: async ({ where }: any) => {
        if (where?.id) return copy(sessions.get(where.id));
        return copy([...sessions.values()].reverse().find((session) => matches(session, where)));
      },
      create: async ({ data }: any) => {
        const row = { id: `s${sessions.size + 1}`, createdAt: new Date(), updatedAt: new Date(), ...data };
        writes.push({ op: 'create', args: data });
        sessions.set(row.id, row);
        return copy(row);
      },
      update: async ({ where, data }: any) => {
        writes.push({ op: 'update', args: { where, data } });
        const row = sessions.get(where.id);
        if (!row) throw new Error(`session ${where.id} not found`);
        Object.assign(row, data, { updatedAt: new Date() });
        return copy(row);
      },
      updateMany: async ({ where, data }: any) => {
        writes.push({ op: 'updateMany', args: { where, data } });
        let count = 0;
        for (const row of sessions.values()) {
          if (matches(row, where)) {
            Object.assign(row, data, { updatedAt: new Date() });
            count++;
          }
        }
        return { count };
      },
      delete: async ({ where }: any) => {
        writes.push({ op: 'delete', args: { where } });
        const row = sessions.get(where.id);
        sessions.delete(where.id);
        return copy(row);
      },
    },
  };

  return prisma;
}

/**
 * In-memory Prisma for `User` and `UserSession` (the real database is exercised in test/integration).
 * Only the queries UserSessionService makes are implemented.
 */
export function fakeTeamPrisma() {
  const users: any[] = [];
  const sessions: any[] = [];
  let reads = 0;
  let writes = 0;
  const prisma = {
    get reads() {
      return reads;
    },
    get writes() {
      return writes;
    },
    user: {
      upsert: async ({ where, create, update }: any) => {
        writes++;
        let row = users.find((user) => user.email === where.email);
        if (!row) {
          row = { id: `u${users.length + 1}`, createdAt: new Date(), updatedAt: new Date(), ...create };
          users.push(row);
        } else {
          Object.assign(row, update, { updatedAt: new Date() });
        }
        return { ...row };
      },
      findUnique: async ({ where }: any) => {
        const row = users.find((user) => user.id === where.id);
        return row ? { ...row } : null;
      },
      findMany: async ({ where }: any) => {
        const emails = where?.email?.in;
        return users.filter((user) => !emails || emails.includes(user.email)).map((user) => ({ ...user }));
      },
    },
    userSession: {
      create: async ({ data }: any) => {
        writes++;
        const row = { id: `s${sessions.length + 1}`, createdAt: new Date(), revokedAt: null, ...data };
        sessions.push(row);
        return { ...row };
      },
      findUnique: async ({ where, include }: any) => {
        reads++;
        const row = where.id
          ? sessions.find((session) => session.id === where.id)
          : sessions.find((session) => session.tokenHash === where.tokenHash);
        if (!row) return null;
        const user = users.find((candidate) => candidate.id === row.userId);
        return {
          ...row,
          User: include?.User
            ? user
              ? { id: user.id, email: user.email, name: user.name, picture: user.picture }
              : undefined
            : undefined,
        };
      },
      update: async ({ where, data }: any) => {
        writes++;
        const row = sessions.find((session) => session.id === where.id);
        Object.assign(row, data);
        return { ...row };
      },
      findMany: async ({ where, include }: any) => {
        reads++;
        const list = sessions
          .filter((session) => {
            if (where?.userId && session.userId !== where.userId) return false;
            if ('revokedAt' in (where ?? {}) && session.revokedAt !== null) return false;
            if (where?.expiresAt?.gt && !(+new Date(session.expiresAt) > +where.expiresAt.gt)) return false;
            return true;
          })
          .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt));
        return list.map((session) => {
          const user = users.find((candidate) => candidate.id === session.userId);
          return {
            ...session,
            User: include?.User && user ? { id: user.id, email: user.email, name: user.name, picture: user.picture } : undefined,
          };
        });
      },
    },
  };
  return { prisma, users, sessions };
}

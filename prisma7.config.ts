import 'dotenv/config';

import { defineConfig } from 'prisma/config';

// Prisma 7: a URL do CLI vem do config, nao mais do bloco datasource do schema.
// Nunca use env(): no CI o db:generate roda sem DATABASE_CONNECTION_URI e o env() lancaria erro.
export default defineConfig({
  datasource: {
    url: process.env.DATABASE_CONNECTION_URI ?? '',
  },
});

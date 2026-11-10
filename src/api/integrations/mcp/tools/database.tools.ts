import { dbActivity } from '@api/repository/db-activity';
import { getInstanceDatabases } from '@api/repository/instance-db';
import { z } from 'zod';

import { requireGlobal } from '../mcp.instance';
import { defineTool, READ_ONLY } from '../mcp.tool';
import { jsonResult } from '../mcp.util';

/** Neon project quota and what woke the main database: answered from memory, never wakes the database. */
export const getDatabaseInfo = defineTool({
  name: 'get_database_info',
  title: 'Banco de dados: cota e acordadas',
  description:
    'Mostra a cota de projetos do Neon (banco próprio por instância: limite, em uso, restantes e o modo sugerido para a próxima instância) e as últimas vezes que o banco principal "acordou" depois de 5 min parado, com as consultas que causaram cada acordada (só tabela e tipo de SQL, nunca valores). Responde da memória do servidor, sem consultar o banco. Exige a chave global.',
  input: {
    wakes: z.number().int().min(1).max(100).optional().describe('Quantas acordadas recentes listar. Padrão: 20.'),
  },
  annotations: READ_ONLY,
  run: async ({ wakes }, ctx) => {
    requireGlobal(ctx, 'As informações do banco');
    const dbs = getInstanceDatabases();
    const quota = dbs ? await dbs.quota() : { enabled: false, source: 'off' };
    return jsonResult({
      quota,
      activity: dbActivity.snapshot(wakes ?? 20),
      hint: 'Cada acordada do Neon gasta cota de CU-h; muitas acordadas de madrugada indicam algo consultando o banco sem necessidade.',
    });
  },
});

export const databaseTools = [getDatabaseInfo];

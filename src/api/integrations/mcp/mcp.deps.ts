import { openaiController, prismaRepository, sendMessageController, usageService, waMonitor } from '@api/server.module';
import { observabilityService } from '@api/services/observability.service';
import { Auth, configService, Database, Openai } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { isBotMessageId } from '@utils/botMessageRegistry';
import path from 'path';

import { McpDeps } from './mcp.types';

const logger = new Logger('MCP');

/** The real services, the same instances the REST routes use (nothing is created per request). */
export function defaultMcpDeps(): McpDeps {
  const database = configService.get<Database>('DATABASE');

  return {
    prisma: prismaRepository,
    waMonitor,
    openaiController,
    sendMessageController,
    observability: observabilityService,
    usage: usageService,
    isBotMessageId,
    logger,
    config: {
      apiKey: configService.get<Auth>('AUTHENTICATION').API_KEY.KEY,
      // Optional, only for clients that cannot send headers. Read here (not in env.config) so it needs no default
      pathToken: process.env.MCP_PATH_TOKEN || undefined,
      clientName: database.CONNECTION.CLIENT_NAME,
      dbProvider: database.PROVIDER,
      openaiGlobalKeySet: !!configService.get<Openai>('OPENAI').API_KEY_GLOBAL,
      docsDirs: [
        process.cwd(),
        path.join(process.cwd(), 'readmes'),
        path.join(process.cwd(), 'manager', 'dist', 'readmes'),
      ],
    },
  };
}

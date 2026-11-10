import { listCredentials } from '@api/services/credentials.service';

import { requireGlobal } from '../mcp.instance';
import { defineTool, READ_ONLY } from '../mcp.tool';
import { jsonResult } from '../mcp.util';

/**
 * Read-only and masked: there is deliberately no MCP tool that reveals a secret. The full value is shown only on
 * the admin page of the panel ("Chaves e credenciais"), after the admin types the global key again.
 */
export const listCredentialsTool = defineTool({
  name: 'list_credentials',
  title: 'Chaves e credenciais (mascaradas)',
  description:
    'Lista, por instância, as chaves guardadas (credenciais OpenAI, token da instância, URL do webhook, chaves de Dify/Flowise/EvoAI/N8N/Chatwoot etc.) SEMPRE mascaradas (ex.: sk-…WXYZ), e se a instância usa a chave OpenAI global. Nunca devolve o valor completo; para ver um valor, use a página "Chaves e credenciais" do painel. Exige a chave global.',
  input: {},
  annotations: READ_ONLY,
  run: async (_args, ctx) => {
    requireGlobal(ctx, 'A lista de credenciais');

    const overview = await listCredentials({
      prisma: ctx.deps.prisma,
      waMonitor: ctx.deps.waMonitor,
      clientName: ctx.deps.config.clientName,
      openaiGlobalKeySet: !!ctx.deps.config.openaiGlobalKeySet,
      logger: ctx.deps.logger,
    });

    return jsonResult(overview);
  },
});

export const credentialsTools = [listCredentialsTool];

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { registerPrompts } from './mcp.prompts';
import { registerDocResources } from './mcp.resources';
import { registerTool } from './mcp.tool';
import { McpContext } from './mcp.types';
import { allTools } from './tools';

export const MCP_SERVER_NAME = 'whatsai';
export const MCP_SERVER_VERSION = '1.0.0';

const INSTRUCTIONS = [
  'Servidor MCP do WhatsAI (Evolution API + bot OpenAI por instância).',
  'Comece por list_instances. Leitura: list_chats, get_messages, search_messages, get_media, get_bot_config, list_paused_contacts, get_instance_status, get_webhook_and_settings, get_observability, get_usage.',
  'Escrita: send_text_message envia de verdade para o cliente; pause_bot_for_contact/resume_bot_for_contact; update_bot_settings substitui valores do bot; update_limits altera o plano e os limites de respostas da IA.',
  'Antes de qualquer escrita, confirme com o usuário. Os manuais estão nos recursos whatsai://docs/*.',
].join(' ');

/** One server per request (stateless): only the tools, resources and prompts the caller may use. */
export function createMcpServer(ctx: McpContext): McpServer {
  const server = new McpServer(
    { name: MCP_SERVER_NAME, version: MCP_SERVER_VERSION },
    { capabilities: { tools: {}, resources: {}, prompts: {} }, instructions: INSTRUCTIONS },
  );

  for (const tool of allTools) registerTool(server, ctx, tool);
  registerDocResources(server, ctx);
  registerPrompts(server);

  return server;
}

/** Handles one JSON-RPC POST end to end: JSON responses (no SSE stream), no session. */
export async function handleMcpRequest(ctx: McpContext, req: any, res: any): Promise<void> {
  const server = createMcpServer(ctx);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });

  res.on('close', () => {
    void transport.close();
    void server.close();
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}

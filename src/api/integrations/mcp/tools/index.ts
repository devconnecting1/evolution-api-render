import { ToolSpec } from '../mcp.tool';
import { agendaTools } from './agenda.tools';
import { botTools } from './bot.tools';
import { chatTools } from './chat.tools';
import { credentialsTools } from './credentials.tools';
import { databaseTools } from './database.tools';
import { instanceTools } from './instance.tools';
import { leadTools } from './leads.tools';
import { openaiHealthTools } from './openai-health.tools';
import { processosTools } from './processos.tools';
import { usageTools } from './usage.tools';

/**
 * Every tool of the MCP server. Deliberately absent: deleting or logging out instances, restarting, deleting
 * messages, raw SQL, environment variables, API key management and revealing a secret (list_credentials only
 * returns masked values; the full value is only shown on the admin page of the panel).
 */
export const allTools: ToolSpec<any>[] = [
  ...instanceTools,
  ...chatTools,
  ...botTools,
  ...usageTools,
  ...leadTools,
  ...processosTools,
  ...credentialsTools,
  ...agendaTools,
  ...databaseTools,
  ...openaiHealthTools,
];

export const TOOL_NAMES = allTools.map((tool) => tool.name);

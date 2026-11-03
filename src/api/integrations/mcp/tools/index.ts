import { ToolSpec } from '../mcp.tool';
import { botTools } from './bot.tools';
import { chatTools } from './chat.tools';
import { instanceTools } from './instance.tools';

/**
 * Every tool of the MCP server. Deliberately absent: deleting or logging out instances, restarting, deleting
 * messages, raw SQL, environment variables and API key management.
 */
export const allTools: ToolSpec<any>[] = [...instanceTools, ...chatTools, ...botTools];

export const TOOL_NAMES = allTools.map((tool) => tool.name);

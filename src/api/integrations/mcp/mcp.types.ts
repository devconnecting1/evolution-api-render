/**
 * Types shared by the embedded MCP server (Model Context Protocol, Streamable HTTP, stateless).
 *
 * Everything the tools touch arrives through `McpDeps`, so the tools never import `server.module` themselves:
 * production wires the real services (mcp.deps.ts) and the tests hand in fakes.
 */

export type McpAuth =
  | { scope: 'global'; via: 'header' | 'path' }
  | { scope: 'instance'; via: 'header'; instanceName: string; instanceId: string };

export interface McpConfig {
  /** AUTHENTICATION_API_KEY: full access. */
  apiKey: string;
  /** MCP_PATH_TOKEN: enables `POST /mcp/:token` when it has 32+ characters. */
  pathToken?: string;
  /** DATABASE_CONNECTION_CLIENT_NAME: instances of this deployment (same filter as fetchInstances). */
  clientName?: string;
  /** DATABASE_PROVIDER: postgresql | mysql. */
  dbProvider: string;
  /** Whether OPENAI_API_KEY_GLOBAL is set (the value itself never reaches the MCP server). */
  openaiGlobalKeySet?: boolean;
  /** Folders searched for the Markdown manuals exposed as resources, in order of preference. */
  docsDirs: string[];
}

export interface McpLogger {
  error(message: unknown): void;
  warn(message: unknown): void;
}

export interface McpDeps {
  prisma: any;
  waMonitor: { waInstances: Record<string, any> };
  openaiController: any;
  sendMessageController: { sendText: (instance: { instanceName: string }, data: any) => Promise<any> };
  observability: { getOverview: (force?: boolean) => Promise<any> };
  /** "Plano e limites" (UsageService): the same instance the REST routes and the bot use. */
  usage: {
    getLimits: (instanceId: string) => Promise<any>;
    getSummary: (instanceId: string) => Promise<any>;
    saveLimits: (instanceId: string, input: Record<string, any>) => Promise<{ previous: any; limits: any }>;
  };
  isBotMessageId: (instanceId: string, messageId: string) => Promise<boolean>;
  config: McpConfig;
  logger: McpLogger;
}

export interface McpContext {
  auth: McpAuth;
  deps: McpDeps;
}

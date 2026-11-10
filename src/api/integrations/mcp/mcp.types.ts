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
  /** "Processos" (ProcessosService): court cases (DataJud) and DJEN publications. */
  processos?: {
    list: (instanceId: string, filters?: Record<string, any>) => Promise<any>;
    get: (instanceId: string, id: string, movementsLimit?: number) => Promise<any>;
    add: (instanceId: string, input: Record<string, any>) => Promise<any>;
    listPublications: (instanceId: string, filters?: Record<string, any>) => Promise<any>;
    manualSync: (instanceId: string, id: string) => Promise<any>;
    getSettings: (instanceId: string) => Promise<any>;
    saveSettings: (instanceId: string, input: Record<string, any>) => Promise<{ previous: any; settings: any }>;
    listOab: (instanceId: string) => Promise<any[]>;
    addOab: (instanceId: string, input: Record<string, any>) => Promise<any>;
  };
  /** "Leads (triagem)" (LeadsService): the same instance the REST routes and the bot use. */
  leads: {
    list: (instanceId: string, query: Record<string, any>, channel?: any) => Promise<any>;
    get: (instanceId: string, id: string) => Promise<any>;
    update: (
      instanceId: string,
      id: string,
      input: Record<string, any>,
    ) => Promise<{ previous: any; lead: any } | null>;
    getStoredSettings: (instanceId: string) => Promise<{ configured: boolean; settings: any }>;
    saveSettings: (instanceId: string, input: Record<string, any>) => Promise<{ previous: any; settings: any }>;
    backfill: (
      instanceId: string,
      instanceName: string,
      input: { days?: number; max?: number; dryRun?: boolean; reanalyze?: boolean },
    ) => Promise<Record<string, any>>;
    backfillStatus: (instanceId: string) => Record<string, any>;
    analyzeOne: (instanceId: string, instanceName: string, contact: string) => Promise<Record<string, any>>;
    remove: (instanceId: string, id: string) => Promise<any>;
    refreshWaiting: (instanceId: string) => Promise<{ checked: number; cleared: number; changed: number }>;
  };
  /** "Agenda" (AgendaService): the same instance the REST routes and the bot use. */
  agenda: Pick<
    import('@api/services/agenda.service').AgendaService,
    | 'getSettings'
    | 'today'
    | 'listAppointments'
    | 'freeSlots'
    | 'createAppointment'
    | 'updateAppointment'
    | 'cancelAppointment'
    | 'saveSettings'
  >;
  /** Saúde das chaves OpenAI (OpenaiHealthService). Optional: tests without it get a clear error. */
  openaiHealth?: Pick<import('@api/services/openai-health.service').OpenaiHealthService, 'overview' | 'test'>;
  isBotMessageId: (instanceId: string, messageId: string) => Promise<boolean>;
  config: McpConfig;
  logger: McpLogger;
}

export interface McpContext {
  auth: McpAuth;
  deps: McpDeps;
}

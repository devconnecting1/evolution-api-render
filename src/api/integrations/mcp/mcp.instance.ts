import { McpContext } from './mcp.types';
import { McpToolError } from './mcp.util';

export type ResolvedInstance = {
  name: string;
  id: string;
  row: any;
  /** The running channel (Baileys / Cloud API) or undefined when the instance is not loaded in memory. */
  channel: any;
};

/** Where clause of the instances visible to the caller (this deployment's clientName, the token's instance). */
export function visibleInstancesWhere(ctx: McpContext): Record<string, any> {
  const where: Record<string, any> = {};
  if (ctx.deps.config.clientName) where.clientName = ctx.deps.config.clientName;
  if (ctx.auth.scope === 'instance') where.id = ctx.auth.instanceId;
  return where;
}

export function requireGlobal(ctx: McpContext, what: string): void {
  if (ctx.auth.scope !== 'global') {
    throw new McpToolError(
      `${what} exige a chave global (AUTHENTICATION_API_KEY); o token de instância não tem acesso.`,
    );
  }
}

/**
 * The instance a tool works on. A token of an instance only reaches that instance; with the global key the name
 * may be left out when the deployment has a single instance. One small query.
 */
export async function resolveInstance(ctx: McpContext, name?: string | null): Promise<ResolvedInstance> {
  const requested = typeof name === 'string' && name.trim() ? name.trim() : null;

  if (ctx.auth.scope === 'instance' && requested && requested !== ctx.auth.instanceName) {
    throw new McpToolError(`este token só dá acesso à instância "${ctx.auth.instanceName}".`);
  }

  const where = visibleInstancesWhere(ctx);
  if (requested) where.name = requested;

  const rows = await ctx.deps.prisma.instance.findMany({ where, take: requested ? 1 : 2 });

  if (!rows?.length) {
    throw new McpToolError(
      requested
        ? `instância "${requested}" não encontrada. Use list_instances para ver os nomes.`
        : 'nenhuma instância encontrada.',
    );
  }

  if (!requested && rows.length > 1) {
    throw new McpToolError('há mais de uma instância: informe o parâmetro "instance" (veja list_instances).');
  }

  const row = rows[0];
  return { name: row.name, id: row.id, row, channel: ctx.deps.waMonitor?.waInstances?.[row.name] };
}

/** Same as resolveInstance, but the channel must be loaded (chats, messages, media and sending live there). */
export async function resolveLoadedInstance(ctx: McpContext, name?: string | null): Promise<ResolvedInstance> {
  const instance = await resolveInstance(ctx, name);

  if (!instance.channel) {
    throw new McpToolError(
      `a instância "${instance.name}" não está carregada no servidor (desconectada ou reiniciando). Tente de novo em instantes ou verifique get_instance_status.`,
    );
  }

  return instance;
}

export const connectionStateOf = (instance: ResolvedInstance): string | null =>
  instance.channel?.connectionStatus?.state ?? null;

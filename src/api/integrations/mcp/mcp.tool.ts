import { runWithInstance } from '@api/repository/instance-db/instance-context';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { AuditType, maskJid } from '@utils/audit-log';
import { z } from 'zod';

import { resolveInstance } from './mcp.instance';
import { McpContext } from './mcp.types';
import { errorMessage, errorResult, jsonResult, logMessage, McpToolError, ToolResult } from './mcp.util';

/**
 * A tool that sends to a customer or changes something hard to undo answers with a preview until it is called again
 * with `confirm: true` (the argument is added to its input by registerTool).
 */
export type ConfirmSpec = {
  /** Whether this call needs the confirmation (default: always), e.g. only when the customer is notified. */
  when?: (args: any) => boolean;
  /** What the call would do; shown instead of doing it. Must not change anything. */
  preview: (args: any, ctx: McpContext) => Promise<Record<string, unknown>>;
};

export type ToolSpec<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  /** Shown to the user by the MCP client: Brazilian Portuguese. */
  description: string;
  input: S;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<S>>, ctx: McpContext) => Promise<ToolResult>;
  confirm?: ConfirmSpec;
};

export const confirmArg = z
  .boolean()
  .optional()
  .describe(
    'true executa de verdade. Sem ele a ferramenta só devolve uma prévia do que faria (nada é enviado nem alterado): mostre a prévia ao usuário e chame de novo com confirm=true se ele concordar.',
  );

/** The arguments a write call would apply (without the instance, the bot id and the confirmation). */
export function changedArgs(args: Record<string, any>, skip: string[] = ['instance', 'bot_id', 'confirm']) {
  return Object.fromEntries(
    Object.entries(args ?? {}).filter(([key, value]) => value !== undefined && !skip.includes(key)),
  );
}

const PREVIEW_NOTE =
  'Prévia: nada foi enviado nem alterado. Mostre ao usuário e, se ele concordar, chame de novo com os mesmos argumentos e confirm=true.';

/** Area of the "Registro de ações" for a write tool of the MCP. */
export function auditTypeOf(tool: string): AuditType {
  if (/lead/.test(tool)) return 'leads';
  if (/appointment|agenda/.test(tool)) return 'agenda';
  if (/process/.test(tool)) return 'processos';
  if (/limits/.test(tool)) return 'plano';
  if (/bot/.test(tool)) return 'ia';
  if (/send|message/.test(tool)) return 'conversas';
  return 'ajustes';
}

function auditTarget(args: any): string | null {
  const who = args?.contact ?? args?.number;
  if (typeof who === 'string' && who) {
    const jid = who.includes('@') ? who : `${who.replace(/\D/g, '')}@s.whatsapp.net`;
    return maskJid(jid);
  }
  return typeof args?.id === 'string' ? args.id.slice(0, 64) : null;
}

/** The instance of a call, for the database routing and the audit log: never throws (the tool reports errors). */
async function instanceOfCall(
  ctx: McpContext,
  spec: ToolSpec<any>,
  args: any,
): Promise<{ id?: string; name?: string }> {
  if (ctx.auth.scope === 'instance') return { id: ctx.auth.instanceId, name: ctx.auth.instanceName };
  if (!('instance' in (spec.input ?? {}))) return {};
  try {
    const resolved = await resolveInstance(ctx, args?.instance);
    return { id: resolved.id, name: resolved.name };
  } catch {
    return {};
  }
}

function recordWrite(ctx: McpContext, spec: ToolSpec<any>, args: any, instanceName: string | undefined) {
  try {
    ctx.deps.audit?.record({
      actor: ctx.auth.scope === 'global' ? 'MCP (chave global)' : 'MCP (token da instância)',
      actorKind: 'mcp',
      type: auditTypeOf(spec.name),
      action: spec.title,
      instanceName: instanceName ?? null,
      target: auditTarget(args),
      method: 'MCP',
      path: `/mcp/${spec.name}`,
      status: 200,
      ip: null,
    });
  } catch {
    /* the log never affects the tool */
  }
}

export const READ_ONLY: ToolAnnotations = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function defineTool<S extends z.ZodRawShape>(spec: ToolSpec<S>): ToolSpec<S> {
  return spec;
}

/**
 * Registers a tool. Failures never escape as protocol errors: they come back as an `isError` result with a
 * message the AI can act on (and the details go only to the server log).
 */
export function registerTool(server: McpServer, ctx: McpContext, spec: ToolSpec<any>): void {
  const handler = async (rawArgs: any): Promise<ToolResult> => {
    const args = rawArgs ?? {};
    // One instance lookup per call, shared by the tool (resolveInstance) and the routing below
    const call: McpContext = { ...ctx, instanceCache: new Map() };
    const instance = await instanceOfCall(call, spec, args);

    // Inside the instance's database context, like the HTTP routes (instance.guard.ts): queries without the
    // instanceId in their arguments ($queryRaw, update by id) reach the instance's own database
    return runWithInstance(instance.id, async () => {
      try {
        if (spec.confirm && args.confirm !== true && (spec.confirm.when?.(args) ?? true)) {
          const preview = await spec.confirm.preview(args, call);
          return jsonResult({ preview: true, tool: spec.name, ...preview, note: PREVIEW_NOTE });
        }
        const result = await spec.run(args, call);
        if (spec.annotations?.readOnlyHint === false && !result?.isError) recordWrite(call, spec, args, instance.name);
        return result;
      } catch (error) {
        const message = errorMessage(error);
        if (!(error instanceof McpToolError)) {
          ctx.deps.logger.error(`MCP tool ${spec.name} failed: ${logMessage(error)}`);
        }
        return errorResult(message);
      }
    });
  };

  // The generic overloads of registerTool are very deep for the type checker; the input is validated by zod
  // at runtime by the SDK anyway
  (server.registerTool as any)(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.confirm ? { ...spec.input, confirm: confirmArg } : spec.input,
      annotations: { title: spec.title, ...spec.annotations },
    },
    handler,
  );
}

/** Common optional `instance` argument. */
export const instanceArg = z
  .string()
  .min(1)
  .max(255)
  .optional()
  .describe('Nome da instância (veja list_instances). Opcional quando há uma só instância ou com token de instância.');

export const contactArg = z
  .string()
  .min(3)
  .max(120)
  .describe('Contato: número com DDI e DDD (ex.: 5511999998888) ou JID completo (…@s.whatsapp.net, …@lid).');

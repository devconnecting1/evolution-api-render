import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { ToolAnnotations } from '@modelcontextprotocol/sdk/types.js';
import { z } from 'zod';

import { McpContext } from './mcp.types';
import { errorMessage, errorResult, logMessage, McpToolError, ToolResult } from './mcp.util';

export type ToolSpec<S extends z.ZodRawShape = z.ZodRawShape> = {
  name: string;
  title: string;
  /** Shown to the user by the MCP client: Brazilian Portuguese. */
  description: string;
  input: S;
  annotations: ToolAnnotations;
  run: (args: z.infer<z.ZodObject<S>>, ctx: McpContext) => Promise<ToolResult>;
};

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
  const handler = async (args: any): Promise<ToolResult> => {
    try {
      return await spec.run(args ?? {}, ctx);
    } catch (error) {
      const message = errorMessage(error);
      if (!(error instanceof McpToolError)) {
        ctx.deps.logger.error(`MCP tool ${spec.name} failed: ${logMessage(error)}`);
      }
      return errorResult(message);
    }
  };

  // The generic overloads of registerTool are very deep for the type checker; the input is validated by zod
  // at runtime by the SDK anyway
  (server.registerTool as any)(
    spec.name,
    {
      title: spec.title,
      description: spec.description,
      inputSchema: spec.input,
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
